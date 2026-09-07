import { Module } from '@nestjs/common';
import { PlatformService } from '../platform.service.js';
import { FcmPushService } from './fcm-push.service.js';
import { ApnsPushService } from './apns-push.service.js';
import { NotificationService } from './notification.service.js';
import { DeviceAndNotificationController } from './device-and-notification.controller.js';

@Module({
  controllers: [DeviceAndNotificationController],
  providers: [PlatformService, NotificationService, FcmPushService, ApnsPushService],
  exports: [NotificationService, FcmPushService, ApnsPushService],
})
export class NotificationsModule {}
