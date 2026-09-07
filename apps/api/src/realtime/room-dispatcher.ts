import { Injectable } from '@nestjs/common';
import { parseProjectRoom, type RealtimeChannel } from '@vinops/domain';

export type SocketSender = (data: string) => void;

export interface SocketClientInfo {
  socketId: string;
  userId: string;
  projectIds: Set<string>;
  send?: SocketSender | undefined;
}

@Injectable()
export class RoomDispatcher {
  // room -> Set of socketIds
  private readonly roomSubscribers = new Map<string, Set<string>>();
  // socketId -> Set of rooms
  private readonly socketRooms = new Map<string, Set<string>>();
  // socketId -> client info
  private readonly clients = new Map<string, SocketClientInfo>();
  // userId -> Set of socketIds
  private readonly userSockets = new Map<string, Set<string>>();

  registerClient(
    socketId: string,
    userId: string,
    projectIds: readonly string[] = [],
    send?: SocketSender,
  ): void {
    const info: SocketClientInfo = {
      socketId,
      userId,
      projectIds: new Set(projectIds),
    };
    if (send !== undefined) {
      info.send = send;
    }
    this.clients.set(socketId, info);

    let sockets = this.userSockets.get(userId);
    if (!sockets) {
      sockets = new Set();
      this.userSockets.set(userId, sockets);
    }
    sockets.add(socketId);

    if (!this.socketRooms.has(socketId)) {
      this.socketRooms.set(socketId, new Set());
    }
  }

  unregisterClient(socketId: string): void {
    this.leaveAllRooms(socketId);

    const info = this.clients.get(socketId);
    if (info) {
      const sockets = this.userSockets.get(info.userId);
      if (sockets) {
        sockets.delete(socketId);
        if (sockets.size === 0) {
          this.userSockets.delete(info.userId);
        }
      }
    }

    this.clients.delete(socketId);
    this.socketRooms.delete(socketId);
  }

  joinRoom(socketId: string, room: string): boolean {
    const client = this.clients.get(socketId);
    if (!client) {
      return false;
    }

    const parsed = parseProjectRoom(room);
    if (parsed) {
      // Must have access to this project
      if (!client.projectIds.has(parsed.projectId)) {
        return false;
      }
    }

    let subscribers = this.roomSubscribers.get(room);
    if (!subscribers) {
      subscribers = new Set();
      this.roomSubscribers.set(room, subscribers);
    }
    subscribers.add(socketId);

    let rooms = this.socketRooms.get(socketId);
    if (!rooms) {
      rooms = new Set();
      this.socketRooms.set(socketId, rooms);
    }
    rooms.add(room);

    return true;
  }

  leaveRoom(socketId: string, room: string): boolean {
    const subscribers = this.roomSubscribers.get(room);
    if (subscribers) {
      subscribers.delete(socketId);
      if (subscribers.size === 0) {
        this.roomSubscribers.delete(room);
      }
    }

    const rooms = this.socketRooms.get(socketId);
    if (rooms) {
      rooms.delete(room);
    }

    return true;
  }

  leaveAllRooms(socketId: string): void {
    const rooms = this.socketRooms.get(socketId);
    if (!rooms) {
      return;
    }

    for (const room of [...rooms]) {
      this.leaveRoom(socketId, room);
    }
    rooms.clear();
  }

  autoJoinProjectRooms(socketId: string, channels: readonly RealtimeChannel[]): string[] {
    const client = this.clients.get(socketId);
    if (!client) {
      return [];
    }

    const joined: string[] = [];
    for (const projectId of client.projectIds) {
      for (const channel of channels) {
        const room = `project:${projectId}:${channel}`;
        if (this.joinRoom(socketId, room)) {
          joined.push(room);
        }
      }
    }
    return joined;
  }

  removeUserFromProject(userId: string, projectId: string): string[] {
    const sockets = this.userSockets.get(userId);
    if (!sockets) {
      return [];
    }

    const leftRooms: string[] = [];
    for (const socketId of sockets) {
      const client = this.clients.get(socketId);
      if (client) {
        client.projectIds.delete(projectId);
      }

      const rooms = this.socketRooms.get(socketId);
      if (rooms) {
        for (const room of [...rooms]) {
          const parsed = parseProjectRoom(room);
          if (parsed && parsed.projectId === projectId) {
            this.leaveRoom(socketId, room);
            leftRooms.push(room);
          }
        }
      }
    }

    return leftRooms;
  }

  getSubscribers(room: string): string[] {
    const subscribers = this.roomSubscribers.get(room);
    return subscribers ? [...subscribers] : [];
  }

  getSocketRooms(socketId: string): string[] {
    const rooms = this.socketRooms.get(socketId);
    return rooms ? [...rooms] : [];
  }

  dispatch(
    room: string,
    eventPayload: unknown,
  ): { delivered: number; recipientSocketIds: string[] } {
    const subscribers = this.roomSubscribers.get(room);
    if (!subscribers || subscribers.size === 0) {
      return { delivered: 0, recipientSocketIds: [] };
    }

    const message = typeof eventPayload === 'string' ? eventPayload : JSON.stringify(eventPayload);

    let delivered = 0;
    const recipientSocketIds: string[] = [];

    for (const socketId of subscribers) {
      const client = this.clients.get(socketId);
      if (client && client.send) {
        try {
          client.send(message);
          delivered += 1;
          recipientSocketIds.push(socketId);
        } catch {
          // Send failed on socket
        }
      } else {
        delivered += 1;
        recipientSocketIds.push(socketId);
      }
    }

    return { delivered, recipientSocketIds };
  }

  getClient(socketId: string): SocketClientInfo | undefined {
    return this.clients.get(socketId);
  }

  getActiveClientCount(): number {
    return this.clients.size;
  }

  getActiveRoomCount(): number {
    return this.roomSubscribers.size;
  }
}
