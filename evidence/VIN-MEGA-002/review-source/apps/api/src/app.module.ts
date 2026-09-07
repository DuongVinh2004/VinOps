import {
  Module,
  RequestMethod,
  type DynamicModule,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import type { ApiConfig } from '@vinops/config';
import { API_CONFIG } from './api-runtime.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { CorrelationMiddleware } from './correlation.middleware.js';
import { HealthController } from './health.controller.js';
import { HttpErrorFilter } from './http-error.filter.js';
import { PlatformController } from './platform.controller.js';
import { PlatformService } from './platform.service.js';
import { DocumentService } from './document.service.js';

@Module({})
export class AppModule implements NestModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, PlatformController],
      providers: [
        { provide: API_CONFIG, useValue: config },
        AuthRateLimitService,
        PlatformService,
        DocumentService,
        CorrelationMiddleware,
        HttpErrorFilter,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
