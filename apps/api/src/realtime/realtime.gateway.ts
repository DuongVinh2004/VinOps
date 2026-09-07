import { Inject, Injectable, Logger, type OnModuleDestroy, Optional } from '@nestjs/common';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import type { ApiConfig } from '@vinops/config';
import {
  formatProjectRoom,
  realtimeChannels,
  type RealtimeChannel,
  type RealtimeEvent,
} from '@vinops/domain';
import { API_CONFIG } from '../api-runtime.js';
import { RoomDispatcher } from './room-dispatcher.js';
import {
  extractWsToken,
  verifyWsHandshake,
  WsUnauthorizedException,
  type WsClientIdentity,
} from './guards/ws-auth.guard.js';

export interface WebSocketLike {
  id: string;
  readyState: number;
  data: Record<string, unknown>;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  ping?(): void;
}

export interface RedisSubscriber {
  subscribe(channel: string, callback: (message: string) => void): Promise<void> | void;
  unsubscribe(channel: string): Promise<void> | void;
}

@Injectable()
export class RealtimeGateway implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly clientHeartbeats = new Map<string, number>();
  private readonly clientSockets = new Map<string, WebSocketLike>();

  constructor(
    @Inject(RoomDispatcher) private readonly roomDispatcher: RoomDispatcher,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Optional() private readonly redisSubscriber?: RedisSubscriber,
  ) {
    this.startHeartbeatMonitor();
  }

  onModuleDestroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const client of this.clientSockets.values()) {
      try {
        client.close(1000, 'Server shutting down');
      } catch {
        // Ignored
      }
    }
    this.clientSockets.clear();
    this.clientHeartbeats.clear();
  }

  getRoomDispatcher(): RoomDispatcher {
    return this.roomDispatcher;
  }

  async handleConnection(socket: WebSocketLike, request: IncomingMessage): Promise<boolean> {
    const secret =
      this.config.VINOPS_AUTH_TOKEN_SECRET ??
      'vinops-dev-insecure-auth-token-secret-must-be-changed';
    const token = extractWsToken(request);

    let identity: WsClientIdentity;
    try {
      identity = await verifyWsHandshake(token, secret);
    } catch (err) {
      const code = err instanceof WsUnauthorizedException ? err.code : 4401;
      this.logger.warn(`WS connection rejected: unauthorized (${String(err)})`);
      socket.close(code, 'Unauthorized');
      return false;
    }

    const socketId = socket.id || randomUUID();
    socket.id = socketId;
    socket.data = {
      userId: identity.userId,
      organizationId: identity.organizationId,
      sessionId: identity.sessionId,
      projectIds: identity.projectIds,
    };

    this.clientSockets.set(socketId, socket);
    this.clientHeartbeats.set(socketId, Date.now());

    // Register with room dispatcher
    this.roomDispatcher.registerClient(socketId, identity.userId, identity.projectIds, (data) => {
      if (socket.readyState === 1 /* OPEN */) {
        socket.send(data);
      }
    });

    // Auto-join project rooms for all accessible projects
    const joinedRooms = this.roomDispatcher.autoJoinProjectRooms(socketId, realtimeChannels);

    this.logger.log(
      `WS client connected: user=${identity.userId} socket=${socketId} autoJoined=${joinedRooms.length} rooms`,
    );

    // Setup incoming message handler
    socket.on('message', (raw: unknown) => {
      this.handleClientMessage(socketId, raw);
    });

    socket.on('pong', () => {
      this.clientHeartbeats.set(socketId, Date.now());
    });

    socket.on('close', (code?: unknown, reason?: unknown) => {
      this.handleDisconnection(socketId, Number(code), String(reason));
    });

    socket.on('error', (error: unknown) => {
      this.logger.error(`WS error for socket=${socketId}: ${String(error)}`);
    });

    // Send connection ack
    try {
      socket.send(
        JSON.stringify({
          type: 'ack',
          status: 'connected',
          serverTime: new Date().toISOString(),
          joinedRooms,
        }),
      );
    } catch {
      // Ignored
    }

    return true;
  }

  handleDisconnection(socketId: string, code?: number, reason?: string): void {
    const client = this.clientSockets.get(socketId);
    const userId = client?.data?.['userId'] as string | undefined;

    this.roomDispatcher.unregisterClient(socketId);
    this.clientSockets.delete(socketId);
    this.clientHeartbeats.delete(socketId);

    this.logger.log(
      `WS client disconnected: user=${userId ?? 'unknown'} socket=${socketId} code=${code ?? 1000} reason=${reason ?? ''}`,
    );
  }

  handleClientMessage(socketId: string, raw: unknown): void {
    this.clientHeartbeats.set(socketId, Date.now());

    const client = this.clientSockets.get(socketId);
    if (!client) {
      return;
    }

    let payload: Record<string, unknown>;
    try {
      const text = typeof raw === 'string' ? raw : String(raw);
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }

    const action = payload.action ?? payload.type;

    if (action === 'ping') {
      try {
        client.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      } catch {
        // Ignored
      }
      return;
    }

    if (action === 'subscribe') {
      const channel = payload.channel as RealtimeChannel | undefined;
      const projectId = payload.projectId as string | undefined;

      if (channel && projectId) {
        const room = formatProjectRoom(projectId, channel);
        const joined = this.roomDispatcher.joinRoom(socketId, room);
        client.send(
          JSON.stringify({
            type: 'ack',
            action: 'subscribe',
            channel,
            projectId,
            room,
            status: joined ? 'subscribed' : 'forbidden',
          }),
        );
      }
      return;
    }

    if (action === 'unsubscribe') {
      const channel = payload.channel as RealtimeChannel | undefined;
      const projectId = payload.projectId as string | undefined;

      if (channel && projectId) {
        const room = formatProjectRoom(projectId, channel);
        this.roomDispatcher.leaveRoom(socketId, room);
        client.send(
          JSON.stringify({
            type: 'ack',
            action: 'unsubscribe',
            channel,
            projectId,
            room,
            status: 'unsubscribed',
          }),
        );
      }
    }
  }

  broadcastToRoom(room: string, event: RealtimeEvent): { delivered: number; recipients: string[] } {
    const result = this.roomDispatcher.dispatch(room, event);
    this.logger.debug(
      `Broadcasted event=${event.type} to room=${room} (recipients=${result.delivered})`,
    );
    return { delivered: result.delivered, recipients: result.recipientSocketIds };
  }

  broadcastToProject(
    projectId: string,
    channel: RealtimeChannel,
    event: RealtimeEvent,
  ): { delivered: number; recipients: string[] } {
    const room = formatProjectRoom(projectId, channel);
    return this.broadcastToRoom(room, event);
  }

  // Handle incoming Redis Pub/Sub message from worker
  handleRedisMessage(redisChannel: string, messageString: string): void {
    try {
      const event = JSON.parse(messageString) as RealtimeEvent;
      // Channel pattern: vinops:realtime:{projectId}:{channel}
      const parts = redisChannel.split(':');
      if (parts.length >= 4) {
        const projectId = parts[2]!;
        const channel = parts[3]! as RealtimeChannel;
        this.broadcastToProject(projectId, channel, event);
      }
    } catch (error) {
      this.logger.error(
        `Failed to dispatch Redis message from channel ${redisChannel}: ${String(error)}`,
      );
    }
  }

  private startHeartbeatMonitor(): void {
    // 30 seconds interval per RFC 6455 & ADR-016 Section 5.1
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [socketId, lastActive] of this.clientHeartbeats.entries()) {
        const client = this.clientSockets.get(socketId);
        if (!client) {
          continue;
        }

        // 60 seconds without activity -> force terminate with code 4001
        if (now - lastActive > 60_000) {
          this.logger.warn(`Closing stale WS connection: socket=${socketId} (heartbeat timeout)`);
          try {
            client.close(4001, 'Heartbeat timeout');
          } catch {
            // Ignored
          }
          this.handleDisconnection(socketId, 4001, 'Heartbeat timeout');
          continue;
        }

        // Send ping frame or ping packet
        try {
          if (typeof client.ping === 'function') {
            client.ping();
          } else {
            client.send(JSON.stringify({ type: 'ping' }));
          }
        } catch {
          // Send failed
        }
      }
    }, 30_000);

    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  // Hook into Node.js HTTP Server upgrade events
  attachHttpServer(server: HttpServer): void {
    server.on('upgrade', (request: IncomingMessage, socket: Socket) => {
      if (!request.url?.startsWith('/ws')) {
        return;
      }

      // Simple RFC 6455 handshake upgrade
      const key = request.headers['sec-websocket-key'];
      if (!key) {
        socket.destroy();
        return;
      }

      // Verify token before completing upgrade
      const secret =
        this.config.VINOPS_AUTH_TOKEN_SECRET ??
        'vinops-dev-insecure-auth-token-secret-must-be-changed';
      const token = extractWsToken(request);

      verifyWsHandshake(token, secret)
        .then(() => {
          // Token valid - complete HTTP upgrade
          const acceptKey = createHash('sha1')
            .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
            .digest('base64');

          const responseHeaders = [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${acceptKey}`,
            '\r\n',
          ];

          socket.write(responseHeaders.join('\r\n'));
        })
        .catch(() => {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
        });
    });
  }
}
