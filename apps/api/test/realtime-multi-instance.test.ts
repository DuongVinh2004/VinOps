import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApiConfig } from '@vinops/config';
import type { RealtimeEvent } from '@vinops/domain';
import { RoomDispatcher } from '../src/realtime/room-dispatcher.js';
import { RealtimeGateway, type WebSocketLike } from '../src/realtime/realtime.gateway.js';
import {
  RedisSubscriberService,
  type RedisClientContract,
} from '../src/realtime/redis-subscriber.service.js';

class MockRedisBus extends EventEmitter {
  private readonly subscribers = new Set<MockRedisClient>();

  register(client: MockRedisClient): void {
    this.subscribers.add(client);
  }

  unregister(client: MockRedisClient): void {
    this.subscribers.delete(client);
  }

  dispatchMessage(source: MockRedisClient, channel: string, message: string): void {
    for (const client of this.subscribers) {
      client.handleIncoming(channel, message);
    }
  }
}

class MockRedisClient extends EventEmitter implements RedisClientContract {
  status = 'ready';
  private readonly bus: MockRedisBus;
  private readonly subscribedChannels = new Set<string>();
  private readonly subscribedPatterns = new Set<string>();

  constructor(bus: MockRedisBus) {
    super();
    this.bus = bus;
    this.bus.register(this);
  }

  connect(): Promise<void> {
    this.status = 'ready';
    this.emit('connect');
    this.emit('ready');
    return Promise.resolve();
  }

  disconnect(): void {
    this.status = 'end';
    this.emit('close');
    this.bus.unregister(this);
  }

  quit(): Promise<string> {
    this.disconnect();
    return Promise.resolve('OK');
  }

  ping(): Promise<string> {
    return Promise.resolve('PONG');
  }

  publish(channel: string, message: string): Promise<number> {
    this.bus.dispatchMessage(this, channel, message);
    return Promise.resolve(1);
  }

  subscribe(...channels: string[]): Promise<unknown> {
    for (const ch of channels) {
      this.subscribedChannels.add(ch);
    }
    return Promise.resolve('OK');
  }

  unsubscribe(...channels: string[]): Promise<unknown> {
    for (const ch of channels) {
      this.subscribedChannels.delete(ch);
    }
    return Promise.resolve('OK');
  }

  psubscribe(...patterns: string[]): Promise<unknown> {
    for (const p of patterns) {
      this.subscribedPatterns.add(p);
    }
    return Promise.resolve('OK');
  }

  punsubscribe(...patterns: string[]): Promise<unknown> {
    for (const p of patterns) {
      this.subscribedPatterns.delete(p);
    }
    return Promise.resolve('OK');
  }

  handleIncoming(channel: string, message: string): void {
    if (this.subscribedChannels.has(channel)) {
      this.emit('message', channel, message);
    }
    for (const pattern of this.subscribedPatterns) {
      // Simple pattern matching for '*'
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      if (regex.test(channel)) {
        this.emit('pmessage', pattern, channel, message);
      }
    }
  }

  simulateDisconnect(): void {
    this.status = 'reconnecting';
    this.emit('close');
    this.emit('reconnecting', 50);
  }

  simulateReconnect(): void {
    this.status = 'ready';
    this.emit('connect');
    this.emit('ready');
  }
}

function createMockSocket(id: string): WebSocketLike & { sent: string[] } {
  const sent: string[] = [];
  return {
    id,
    readyState: 1, // OPEN
    data: {},
    sent,
    send(data: string) {
      sent.push(data);
    },
    close() {},
    on() {},
  };
}

describe('Realtime Multi-Instance via Redis Pub/Sub (ADR016-TST-13 & Phase 5)', () => {
  const originalEnv = process.env['NODE_ENV'];
  let mockBus: MockRedisBus;

  beforeEach(() => {
    process.env['NODE_ENV'] = 'test';
    mockBus = new MockRedisBus();
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
  });

  function createGatewayInstance(instanceName: string) {
    const subscriber = new MockRedisClient(mockBus);
    const publisher = new MockRedisClient(mockBus);

    const redisService = new RedisSubscriberService(
      {
        hosts: ['127.0.0.1:6379'],
        tls: false,
        keyPrefix: 'vinops:',
      },
      { subscriber, publisher },
    );

    const roomDispatcher = new RoomDispatcher();
    const config = {
      NODE_ENV: 'test',
      VINOPS_LOG_LEVEL: 'silent',
      VINOPS_API_HOST: '127.0.0.1',
      VINOPS_API_PORT: 3000,
    } as unknown as ApiConfig;

    const gateway = new RealtimeGateway(roomDispatcher, config, redisService);

    return {
      instanceName,
      gateway,
      roomDispatcher,
      redisService,
      subscriber,
      publisher,
    };
  }

  it('broadcasts event from Instance A and delivers to WebSocket client on Instance B', async () => {
    const nodeA = createGatewayInstance('Node-A');
    const nodeB = createGatewayInstance('Node-B');

    await nodeA.redisService.onModuleInit();
    await nodeB.redisService.onModuleInit();
    await nodeA.gateway.onModuleInit();
    await nodeB.gateway.onModuleInit();

    // Client 1 connects to Instance A in project-alpha issues room
    const clientA = createMockSocket('sock-node-a-client');
    nodeA.roomDispatcher.registerClient(clientA.id, 'user-1', ['proj-alpha'], (data) =>
      clientA.send(data),
    );
    nodeA.roomDispatcher.joinRoom(clientA.id, 'project:proj-alpha:issues');

    // Client 2 connects to Instance B in project-alpha issues room
    const clientB = createMockSocket('sock-node-b-client');
    nodeB.roomDispatcher.registerClient(clientB.id, 'user-2', ['proj-alpha'], (data) =>
      clientB.send(data),
    );
    nodeB.roomDispatcher.joinRoom(clientB.id, 'project:proj-alpha:issues');

    // Mutation occurs on Instance A -> broadcasts to project proj-alpha
    const event: RealtimeEvent = {
      eventId: 'evt-unique-001',
      type: 'field_issue.status_changed',
      channel: 'issues',
      action: 'status_changed',
      timestamp: new Date().toISOString(),
      data: { issueId: 'iss-99', newStatus: 'Resolved' },
    };

    nodeA.gateway.broadcastToProject('proj-alpha', 'issues', event);

    // Verify client on Instance A received it immediately (local dispatch)
    expect(clientA.sent.length).toBe(1);
    expect(JSON.parse(clientA.sent[0]!)).toMatchObject({
      eventId: 'evt-unique-001',
      type: 'field_issue.status_changed',
    });

    // Verify client on Instance B received it via Redis Pub/Sub distribution
    expect(clientB.sent.length).toBe(1);
    expect(JSON.parse(clientB.sent[0]!)).toMatchObject({
      eventId: 'evt-unique-001',
      type: 'field_issue.status_changed',
    });
  });

  it('enforces event deduplication preventing double-delivery on sender echo or duplicate Redis messages', async () => {
    const nodeA = createGatewayInstance('Node-A');
    const nodeB = createGatewayInstance('Node-B');

    await nodeA.redisService.onModuleInit();
    await nodeB.redisService.onModuleInit();
    await nodeA.gateway.onModuleInit();
    await nodeB.gateway.onModuleInit();

    const clientA = createMockSocket('sock-node-a');
    nodeA.roomDispatcher.registerClient(clientA.id, 'user-a', ['proj-1'], (d) => clientA.send(d));
    nodeA.roomDispatcher.joinRoom(clientA.id, 'project:proj-1:issues');

    const clientB = createMockSocket('sock-node-b');
    nodeB.roomDispatcher.registerClient(clientB.id, 'user-b', ['proj-1'], (d) => clientB.send(d));
    nodeB.roomDispatcher.joinRoom(clientB.id, 'project:proj-1:issues');

    const event: RealtimeEvent = {
      eventId: 'evt-dedup-002',
      type: 'rfi.status_changed',
      channel: 'issues',
      action: 'status_changed',
      timestamp: new Date().toISOString(),
      data: { rfiId: 'rfi-42' },
    };

    // Node A broadcasts event
    nodeA.gateway.broadcastToProject('proj-1', 'issues', event);

    // Even though Redis bus echoed message back to Node A subscriber:
    // Node A's client MUST only have 1 message!
    expect(clientA.sent.length).toBe(1);

    // Node B's client receives 1 message
    expect(clientB.sent.length).toBe(1);

    // Now simulate duplicate delivery from Redis (e.g. at-least-once pubsub redelivery)
    nodeB.gateway.handleRedisMessage('vinops:realtime:proj-1:issues', JSON.stringify(event));

    // Verify Node B client STILL only received 1 message (duplicate was dropped)
    expect(clientB.sent.length).toBe(1);
  });

  it('retains subscriptions and resumes event delivery after Redis disconnect and reconnect', async () => {
    const nodeA = createGatewayInstance('Node-A');
    const nodeB = createGatewayInstance('Node-B');

    await nodeA.redisService.onModuleInit();
    await nodeB.redisService.onModuleInit();
    await nodeA.gateway.onModuleInit();
    await nodeB.gateway.onModuleInit();

    const clientB = createMockSocket('sock-node-b');
    nodeB.roomDispatcher.registerClient(clientB.id, 'user-b', ['proj-1'], (d) => clientB.send(d));
    nodeB.roomDispatcher.joinRoom(clientB.id, 'project:proj-1:issues');

    // Simulate Redis network disconnect on Node B
    nodeB.subscriber.simulateDisconnect();
    expect(nodeB.redisService.isReady()).toBe(false);

    // Reconnect Redis
    nodeB.subscriber.simulateReconnect();
    expect(nodeB.subscriber.status).toBe('ready');

    // Broadcast new event after reconnect
    const eventAfterReconnect: RealtimeEvent = {
      eventId: 'evt-reconnect-003',
      type: 'field_issue.assigned',
      channel: 'issues',
      action: 'assigned',
      timestamp: new Date().toISOString(),
      data: { issueId: 'iss-reconnect', assigneeId: 'user-b' },
    };

    nodeA.gateway.broadcastToProject('proj-1', 'issues', eventAfterReconnect);

    // Client on Node B successfully receives the message post-reconnect
    expect(clientB.sent.length).toBe(1);
    expect(JSON.parse(clientB.sent[0]!)).toMatchObject({
      eventId: 'evt-reconnect-003',
      type: 'field_issue.assigned',
    });
  });

  it('strictly enforces fail-closed guard in production when Redis connection fails or subscriber is missing', async () => {
    process.env['NODE_ENV'] = 'production';

    // 1. Gateway without RedisSubscriberService in production must throw
    const roomDispatcher = new RoomDispatcher();
    const config = {
      NODE_ENV: 'production',
      VINOPS_LOG_LEVEL: 'silent',
      VINOPS_API_HOST: '127.0.0.1',
      VINOPS_API_PORT: 3000,
    } as unknown as ApiConfig;

    const gatewayWithoutRedis = new RealtimeGateway(roomDispatcher, config);
    await expect(gatewayWithoutRedis.onModuleInit()).rejects.toThrow(/REDIS_PUBSUB_REQUIRED/i);

    // 2. RedisSubscriberService when connection fails in production must throw
    const brokenSubscriber = new MockRedisClient(mockBus);
    brokenSubscriber.connect = () => Promise.reject(new Error('Connection refused to redis:6379'));
    brokenSubscriber.status = 'wait';

    const failingService = new RedisSubscriberService(undefined, {
      subscriber: brokenSubscriber,
      publisher: new MockRedisClient(mockBus),
    });

    await expect(failingService.onModuleInit()).rejects.toThrow(
      /REDIS_PUBSUB_CONNECTION_REQUIRED/i,
    );
  });
});
