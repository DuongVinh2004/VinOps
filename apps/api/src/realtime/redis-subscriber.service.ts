import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';
import { calculateRedisRetryDelay, loadRedisConfig, type RedisConfig } from '@vinops/config';

export interface RedisSubscriber {
  subscribe(channel: string, callback: (message: string) => void): Promise<void> | void;
  unsubscribe(channel: string): Promise<void> | void;
}

export interface RedisClientContract {
  connect(): Promise<void>;
  disconnect(reconnect?: boolean): void;
  quit(): Promise<string>;
  ping(): Promise<string>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  psubscribe(...patterns: string[]): Promise<unknown>;
  punsubscribe(...patterns: string[]): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): this;
  status: string;
}

@Injectable()
export class RedisSubscriberService implements RedisSubscriber, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisSubscriberService.name);
  private readonly subscriber: RedisClientContract;
  private readonly publisher: RedisClientContract;
  private readonly redisConfig: RedisConfig;
  private readonly channelCallbacks = new Map<string, Set<(message: string) => void>>();
  private readonly patternCallbacks = new Map<
    string,
    Set<(channel: string, message: string) => void>
  >();
  private isSubscriberReady = false;
  private isPublisherReady = false;

  constructor(
    @Optional() redisConfig?: RedisConfig,
    @Optional()
    customClients?: {
      subscriber?: RedisClientContract;
      publisher?: RedisClientContract;
    },
  ) {
    this.redisConfig = redisConfig ?? loadRedisConfig(process.env);

    if (customClients?.subscriber && customClients?.publisher) {
      this.subscriber = customClients.subscriber;
      this.publisher = customClients.publisher;
    } else {
      const primaryHost = this.redisConfig.hosts[0] ?? '127.0.0.1:6379';
      const [host, portStr] = primaryHost.split(':');
      const port = portStr ? parseInt(portStr, 10) : 6379;

      const baseOptions: RedisOptions = {
        host: host || '127.0.0.1',
        port: port || 6379,
        retryStrategy: (times: number) => {
          if (process.env['NODE_ENV'] === 'test') {
            return null;
          }
          return calculateRedisRetryDelay(times);
        },
        connectTimeout: process.env['NODE_ENV'] === 'test' ? 500 : 5000,
        lazyConnect: true,
        maxRetriesPerRequest: process.env['NODE_ENV'] === 'test' ? 1 : null,
        enableReadyCheck: true,
        ...(this.redisConfig.password ? { password: this.redisConfig.password } : {}),
        ...(this.redisConfig.tls ? { tls: {} } : {}),
      };

      const RedisCtor = Redis as unknown as new (opt: unknown) => RedisClientContract;
      this.subscriber = new RedisCtor(baseOptions);
      this.publisher = new RedisCtor(baseOptions);
    }

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.subscriber.on('connect', () => {
      this.logger.log('Redis subscriber connected.');
    });

    this.subscriber.on('ready', () => {
      this.logger.log('Redis subscriber ready.');
      this.isSubscriberReady = true;
      for (const channel of this.channelCallbacks.keys()) {
        this.subscriber.subscribe(channel).catch((err) => {
          this.logger.warn(`Failed to resubscribe channel ${channel}: ${String(err)}`);
        });
      }
      for (const pattern of this.patternCallbacks.keys()) {
        this.subscriber.psubscribe(pattern).catch((err) => {
          this.logger.warn(`Failed to resubscribe pattern ${pattern}: ${String(err)}`);
        });
      }
    });

    this.subscriber.on('reconnecting', (delay: unknown) => {
      this.logger.warn(`Redis subscriber reconnecting in ${String(delay)}ms...`);
      this.isSubscriberReady = false;
    });

    this.subscriber.on('close', () => {
      this.isSubscriberReady = false;
    });

    this.subscriber.on('error', (err: unknown) => {
      this.logger.error(`Redis subscriber error: ${String(err)}`);
    });

    this.subscriber.on('message', (...args: unknown[]) => {
      const channel = String(args[0]);
      const message = String(args[1]);
      const callbacks = this.channelCallbacks.get(channel);
      if (callbacks) {
        for (const cb of callbacks) {
          try {
            cb(message);
          } catch (err) {
            this.logger.error(
              `Error in Redis message handler for channel ${channel}: ${String(err)}`,
            );
          }
        }
      }
    });

    this.subscriber.on('pmessage', (...args: unknown[]) => {
      const pattern = String(args[0]);
      const channel = String(args[1]);
      const message = String(args[2]);
      const callbacks = this.patternCallbacks.get(pattern);
      if (callbacks) {
        for (const cb of callbacks) {
          try {
            cb(channel, message);
          } catch (err) {
            this.logger.error(
              `Error in Redis pmessage handler for pattern ${pattern}: ${String(err)}`,
            );
          }
        }
      }
    });

    this.publisher.on('ready', () => {
      this.isPublisherReady = true;
    });

    this.publisher.on('close', () => {
      this.isPublisherReady = false;
    });

    this.publisher.on('reconnecting', (delay: unknown) => {
      this.logger.warn(`Redis publisher reconnecting in ${String(delay)}ms...`);
      this.isPublisherReady = false;
    });

    this.publisher.on('error', (err: unknown) => {
      this.logger.error(`Redis publisher error: ${String(err)}`);
    });
  }

  async onModuleInit(): Promise<void> {
    const isProduction = process.env['NODE_ENV'] === 'production';
    const isTest = process.env['NODE_ENV'] === 'test';
    try {
      if (this.subscriber.status === 'wait') {
        const connectPromise = this.subscriber.connect();
        if (isTest) {
          await Promise.race([
            connectPromise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Redis connect timeout in test')), 300),
            ),
          ]);
        } else {
          await connectPromise;
        }
      }
      if (this.publisher.status === 'wait') {
        const connectPromise = this.publisher.connect();
        if (isTest) {
          await Promise.race([
            connectPromise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Redis connect timeout in test')), 300),
            ),
          ]);
        } else {
          await connectPromise;
        }
      }
      await this.publisher.ping();
      this.isPublisherReady = true;
      this.isSubscriberReady = true;
      this.logger.log('Redis Pub/Sub service initialized successfully.');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to connect Redis Pub/Sub: ${errorMsg}`);
      if (isProduction) {
        throw new Error(
          `REDIS_PUBSUB_CONNECTION_REQUIRED: Redis Pub/Sub connection failed in production (${errorMsg})`,
          { cause: error },
        );
      }
      this.subscriber.disconnect(false);
      this.publisher.disconnect(false);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.subscriber.status === 'ready') {
        await Promise.race([this.subscriber.quit(), new Promise((r) => setTimeout(r, 200))]);
      }
    } catch {
      // ignore
    } finally {
      this.subscriber.disconnect(false);
    }

    try {
      if (this.publisher.status === 'ready') {
        await Promise.race([this.publisher.quit(), new Promise((r) => setTimeout(r, 200))]);
      }
    } catch {
      // ignore
    } finally {
      this.publisher.disconnect(false);
    }
  }

  isReady(): boolean {
    return this.isSubscriberReady && this.isPublisherReady;
  }

  getKeyPrefix(): string {
    return this.redisConfig.keyPrefix;
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    let callbacks = this.channelCallbacks.get(channel);
    if (!callbacks) {
      callbacks = new Set();
      this.channelCallbacks.set(channel, callbacks);
      if (this.isSubscriberReady) {
        try {
          await this.subscriber.subscribe(channel);
        } catch (err) {
          this.logger.warn(`Failed to subscribe Redis channel ${channel}: ${String(err)}`);
        }
      }
    }
    callbacks.add(callback);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.channelCallbacks.delete(channel);
    if (this.isSubscriberReady) {
      try {
        await this.subscriber.unsubscribe(channel);
      } catch {
        // ignore
      }
    }
  }

  async psubscribe(
    pattern: string,
    callback: (channel: string, message: string) => void,
  ): Promise<void> {
    let callbacks = this.patternCallbacks.get(pattern);
    if (!callbacks) {
      callbacks = new Set();
      this.patternCallbacks.set(pattern, callbacks);
      if (this.isSubscriberReady) {
        try {
          await this.subscriber.psubscribe(pattern);
        } catch (err) {
          this.logger.warn(`Failed to psubscribe Redis pattern ${pattern}: ${String(err)}`);
        }
      }
    }
    callbacks.add(callback);
  }

  async punsubscribe(pattern: string): Promise<void> {
    this.patternCallbacks.delete(pattern);
    if (this.isSubscriberReady) {
      try {
        await this.subscriber.punsubscribe(pattern);
      } catch {
        // ignore
      }
    }
  }

  async publish(channel: string, message: string): Promise<number | void> {
    try {
      return await this.publisher.publish(channel, message);
    } catch (error) {
      this.logger.warn(`Failed to publish message to Redis channel ${channel}: ${String(error)}`);
    }
  }

  getSubscriber(): RedisClientContract {
    return this.subscriber;
  }

  getPublisher(): RedisClientContract {
    return this.publisher;
  }
}
