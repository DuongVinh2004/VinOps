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

import { IssueController } from './issues/issue.controller.js';
import { IssueService } from './issues/issue.service.js';
import { RfxController } from './rfx/rfx.controller.js';
import { RfxService } from './rfx/rfx.service.js';
import { QualityController } from './quality/quality.controller.js';
import { QualityService } from './quality/quality.service.js';
import { DailyLogController } from './records/daily-log.controller.js';
import { DailyLogService } from './records/daily-log.service.js';
import { OfflineSyncController } from './sync/offline-sync.controller.js';
import { OfflineSyncService } from './sync/offline-sync.service.js';

@Module({})
export class AppModule implements NestModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        PlatformController,
        IssueController,
        RfxController,
        QualityController,
        DailyLogController,
        OfflineSyncController,
      ],
      providers: [
        { provide: API_CONFIG, useValue: config },
        AuthRateLimitService,
        PlatformService,
        DocumentService,
        IssueService,
        RfxService,
        QualityService,
        DailyLogService,
        OfflineSyncService,
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
