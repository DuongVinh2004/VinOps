import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import type { Socket } from 'node:net';
import type { ApiConfig } from '@vinops/config';
import {
  formatProjectRoom,
  parseProjectRoom,
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
import { RedisSubscriberService, type RedisSubscriber } from './redis-subscriber.service.js';

export interface WebSocketLike {
  id: string;
  readyState: number;
  data: Record<string, unknown>;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  ping?(): void;
}

export type { RedisSubscriber };

@Injectable()
export class RealtimeGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeGateway.name);
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly clientHeartbeats = new Map<string, number>();
  private readonly clientSockets = new Map<string, WebSocketLike>();
  private readonly processedEventIds = new Set<string>();
  private readonly eventIdQueue: string[] = [];
  private static readonly MAX_DEDUP_SIZE = 5000;

  constructor(
    @Inject(RoomDispatcher) private readonly roomDispatcher: RoomDispatcher,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Optional()
    @Inject(RedisSubscriberService)
    private readonly redisSubscriber?: RedisSubscriberService,
  ) {
    this.startHeartbeatMonitor();
  }

  async onModuleInit(): Promise<void> {
    const isProduction = process.env['NODE_ENV'] === 'production';
    if (isProduction && !this.redisSubscriber) {
      throw new Error(
        'REDIS_PUBSUB_REQUIRED: RealtimeGateway requires RedisSubscriberService in production.',
      );
    }

    if (this.redisSubscriber) {
      const prefix =
        typeof this.redisSubscriber.getKeyPrefix === 'function'
          ? this.redisSubscriber.getKeyPrefix()
          : 'vinops:';
      const pattern = `${prefix}realtime:*`;

      if (typeof this.redisSubscriber.psubscribe === 'function') {
        await this.redisSubscriber.psubscribe(pattern, (channel, message) => {
          this.handleRedisMessage(channel, message);
        });
        this.logger.log(`Subscribed to Redis realtime pattern: ${pattern}`);
      }
    }
  }

  isDuplicate(eventId?: string): boolean {
    if (!eventId) {
      return false;
    }
    if (this.processedEventIds.has(eventId)) {
      return true;
    }
    this.processedEventIds.add(eventId);
    this.eventIdQueue.push(eventId);
    if (this.eventIdQueue.length > RealtimeGateway.MAX_DEDUP_SIZE) {
      const oldest = this.eventIdQueue.shift();
      if (oldest) {
        this.processedEventIds.delete(oldest);
      }
    }
    return false;
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
    if (event.eventId) {
      this.isDuplicate(event.eventId);
    }

    const result = this.roomDispatcher.dispatch(room, event);
    this.logger.debug(
      `Broadcasted event=${event.type} to room=${room} (recipients=${result.delivered})`,
    );

    // Publish to Redis Pub/Sub for multi-instance distribution
    if (this.redisSubscriber && typeof this.redisSubscriber.publish === 'function') {
      const parsed = parseProjectRoom(room);
      if (parsed) {
        const prefix =
          typeof this.redisSubscriber.getKeyPrefix === 'function'
            ? this.redisSubscriber.getKeyPrefix()
            : 'vinops:';
        const redisChannel = `${prefix}realtime:${parsed.projectId}:${parsed.channel}`;
        this.redisSubscriber.publish(redisChannel, JSON.stringify(event)).catch((err) => {
          this.logger.warn(`Failed to publish event to Redis Pub/Sub: ${String(err)}`);
        });
      }
    }

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

  // Handle incoming Redis Pub/Sub message from other instances or worker
  handleRedisMessage(redisChannel: string, messageString: string): void {
    try {
      const event = JSON.parse(messageString) as RealtimeEvent;

      // Deduplication: drop if this event was already delivered by this instance
      if (event.eventId && this.isDuplicate(event.eventId)) {
        this.logger.debug(`Dropped duplicate realtime event: eventId=${event.eventId}`);
        return;
      }

      // Channel pattern: [prefix:]realtime:{projectId}:{channel}
      // e.g. "vinops:realtime:proj-1:issues" or "realtime:proj-1:issues"
      const parts = redisChannel.split(':');
      if (parts.length >= 3) {
        const channel = parts[parts.length - 1] as RealtimeChannel;
        const projectId = parts[parts.length - 2]!;
        const room = formatProjectRoom(projectId, channel);
        this.roomDispatcher.dispatch(room, event);
        this.logger.debug(`Dispatched Redis event=${event.type} to local room=${room}`);
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
