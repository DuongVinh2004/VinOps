import { isRealtimeEventType, mapEventTypeToChannel, type RealtimeEvent } from '@vinops/domain';
import type { OutboxEvent } from './outbox-publisher.js';

export interface RedisPublishClient {
  publish(channel: string, message: string): Promise<number>;
}

export class InMemoryRedisClient implements RedisPublishClient {
  readonly publishedMessages: { channel: string; message: string; timestamp: number }[] = [];

  publish(channel: string, message: string): Promise<number> {
    this.publishedMessages.push({
      channel,
      message,
      timestamp: Date.now(),
    });
    return Promise.resolve(1);
  }

  clear(): void {
    this.publishedMessages.length = 0;
  }
}

export interface PublishResult {
  published: boolean;
  channel?: string | undefined;
  durationMs: number;
}

export class RealtimeEventPublisher {
  constructor(
    private readonly redisClient: RedisPublishClient,
    private readonly keyPrefix = 'vinops:realtime',
  ) {}

  async handleOutboxEvent(event: Readonly<OutboxEvent>): Promise<PublishResult> {
    const startTime = performance.now();

    if (!isRealtimeEventType(event.eventType)) {
      return {
        published: false,
        durationMs: performance.now() - startTime,
      };
    }

    const channel = mapEventTypeToChannel(event.eventType);
    const projectId =
      event.tenant.projectId ??
      (typeof event.payload['projectId'] === 'string' ? event.payload['projectId'] : 'global');

    const action = event.eventType.includes('.') ? event.eventType.split('.')[1]! : 'updated';

    const realtimeEvent: RealtimeEvent = {
      type: event.eventType,
      channel,
      action,
      data: event.payload,
      eventId: event.id,
      timestamp: new Date().toISOString(),
    };

    const redisChannel = `${this.keyPrefix}:${projectId}:${channel}`;
    const payloadString = JSON.stringify(realtimeEvent);

    await this.redisClient.publish(redisChannel, payloadString);

    const durationMs = performance.now() - startTime;
    return {
      published: true,
      channel: redisChannel,
      durationMs,
    };
  }
}
