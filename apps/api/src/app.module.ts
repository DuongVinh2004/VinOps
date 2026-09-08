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
import { AiCopilotController } from './ai-copilot/ai-copilot.controller.js';
import { AiCopilotService } from './ai-copilot/ai-copilot.service.js';
import { EmbeddingService } from './ai/embedding.service.js';
import { GisController } from './gis/gis.controller.js';
import { GisService } from './gis/gis.service.js';

import { SigningController } from './pki/signing.controller.js';
import { SigningService } from './pki/signing.service.js';
import { BimController } from './bim/bim.controller.js';
import { BimService } from './bim/bim.service.js';
import { RealtimeGateway } from './realtime/realtime.gateway.js';
import { RoomDispatcher } from './realtime/room-dispatcher.js';
import { WsAuthGuard } from './realtime/guards/ws-auth.guard.js';
import { RedisSubscriberService } from './realtime/redis-subscriber.service.js';
import { DeviceAndNotificationController } from './notifications/device-and-notification.controller.js';
import { NotificationService } from './notifications/notification.service.js';
import { FcmPushService } from './notifications/fcm-push.service.js';
import { ApnsPushService } from './notifications/apns-push.service.js';

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
        AiCopilotController,
        GisController,
        SigningController,
        BimController,
        DeviceAndNotificationController,
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
        AiCopilotService,
        EmbeddingService,
        GisService,
        SigningService,
        BimService,
        RoomDispatcher,
        RedisSubscriberService,
        RealtimeGateway,
        WsAuthGuard,
        NotificationService,
        FcmPushService,
        ApnsPushService,
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
