import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG, type ApiRuntimeConfig } from './api-runtime.js';
import { PlatformError } from './platform-error.js';

type RateBucket = { attempts: number; resetAt: number };

@Injectable()
export class AuthRateLimitService {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(@Inject(API_CONFIG) private readonly config: ApiRuntimeConfig) {}

  consume(operation: 'login' | 'password_reset', clientKey: string, now = Date.now()): void {
    const key = `${operation}:${clientKey}`;
    const windowMilliseconds = this.config.VINOPS_AUTH_RATE_LIMIT_WINDOW_SECONDS * 1_000;
    const bucket = this.buckets.get(key);
    if (bucket === undefined || bucket.resetAt <= now) {
      this.buckets.set(key, { attempts: 1, resetAt: now + windowMilliseconds });
      return;
    }
    if (bucket.attempts >= this.config.VINOPS_AUTH_RATE_LIMIT_MAX_ATTEMPTS) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
      throw new PlatformError('RATE_LIMITED', 'errors.rateLimited', 429, true, {
        retry_after_seconds: retryAfterSeconds,
      });
    }
    bucket.attempts += 1;
  }
}
