import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { PlatformError } from '../platform-error.js';
import { PlatformService, type RequestIdentity } from '../platform.service.js';
import type { CorrelatedRequest } from '../request-context.js';
import {
  NotificationService,
  type NotificationPreferenceItem,
  type RegisterDeviceDto,
} from './notification.service.js';

type Request = CorrelatedRequest;

function bodyRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return body as Record<string, unknown>;
}

@Controller('api/v1')
export class DeviceAndNotificationController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(NotificationService) private readonly notificationService: NotificationService,
  ) {}

  @Post('users/me/devices')
  @HttpCode(201)
  async registerDevice(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const platform = input['platform'] as 'android_fcm' | 'ios_apns' | 'web_push' | undefined;
    const deviceToken = input['deviceToken'] as string | undefined;

    if (!platform || !['android_fcm', 'ios_apns', 'web_push'].includes(platform)) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.invalidPlatform', 422, false);
    }
    if (!deviceToken || typeof deviceToken !== 'string' || deviceToken.trim().length < 10) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.invalidDeviceToken', 422, false);
    }

    const identity = await this.identity(request);
    const organizationId = await this.resolveUserOrganization(
      identity,
      request.vinopsCorrelationId,
    );

    const dto: RegisterDeviceDto = {
      platform,
      deviceToken: deviceToken.trim(),
      deviceName: typeof input['deviceName'] === 'string' ? input['deviceName'].trim() : undefined,
      deviceModel:
        typeof input['deviceModel'] === 'string' ? input['deviceModel'].trim() : undefined,
      appVersion: typeof input['appVersion'] === 'string' ? input['appVersion'].trim() : undefined,
      osVersion: typeof input['osVersion'] === 'string' ? input['osVersion'].trim() : undefined,
    };

    const device = await this.notificationService.registerDevice(
      identity.userId,
      organizationId,
      dto,
      request.vinopsCorrelationId,
    );

    return {
      success: true,
      data: {
        id: device.id,
        platform: device.platform,
        deviceName: device.deviceName,
        status: device.status,
        registeredAt: device.createdAt,
      },
    };
  }

  @Delete('users/me/devices/:deviceId')
  async revokeDevice(
    @Param('deviceId') deviceId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    const result = await this.notificationService.revokeDevice(
      identity.userId,
      deviceId,
      request.vinopsCorrelationId,
    );

    return {
      success: true,
      data: {
        id: result.id,
        status: result.status,
        revokedAt: result.revokedAt,
      },
    };
  }

  @Get('users/me/devices')
  async listDevices(@Req() request: Request): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    const devices = await this.notificationService.listUserDevices(
      identity.userId,
      request.vinopsCorrelationId,
    );

    return {
      success: true,
      data: devices.map((d) => ({
        id: d.id,
        platform: d.platform,
        deviceName: d.deviceName,
        lastActiveAt: d.lastActiveAt,
        status: d.status,
      })),
    };
  }

  @Put('projects/:projectId/notifications/preferences')
  async updatePreferences(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const rawPrefs = input['preferences'];
    if (!Array.isArray(rawPrefs)) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }

    const identity = await this.identity(request);
    const organizationId = await this.resolveUserOrganization(
      identity,
      request.vinopsCorrelationId,
    );

    const preferences: NotificationPreferenceItem[] = rawPrefs.map((item) => {
      const rec = bodyRecord(item);
      return {
        eventCategory: rec['eventCategory'] as NotificationPreferenceItem['eventCategory'],
        channelWeb: Boolean(rec['channelWeb']),
        channelPush: Boolean(rec['channelPush']),
        channelEmail: Boolean(rec['channelEmail']),
        quietHoursStart:
          typeof rec['quietHoursStart'] === 'string' ? rec['quietHoursStart'] : undefined,
        quietHoursEnd: typeof rec['quietHoursEnd'] === 'string' ? rec['quietHoursEnd'] : undefined,
      };
    });

    const result = await this.notificationService.updateNotificationPreferences(
      identity.userId,
      organizationId,
      projectId,
      preferences,
      request.vinopsCorrelationId,
    );

    return {
      success: true,
      data: result,
    };
  }

  @Get('projects/:projectId/notifications/preferences')
  async getPreferences(
    @Param('projectId') projectId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    const items = await this.notificationService.getNotificationPreferences(
      identity.userId,
      projectId,
      request.vinopsCorrelationId,
    );

    return {
      success: true,
      data: items,
    };
  }

  @Get('projects/:projectId/events/stream')
  async eventStream(
    @Param('projectId') projectId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.identity(request);

    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    response.write(
      `data: {"type":"connected","projectId":"${projectId}","serverTime":"${new Date().toISOString()}"}\n\n`,
    );

    // Keep connection alive with heartbeat comment every 15 seconds
    const interval = setInterval(() => {
      response.write(': keepalive\n\n');
    }, 15_000);

    request.on('close', () => {
      clearInterval(interval);
    });
  }

  private async identity(request: Request): Promise<RequestIdentity> {
    return this.platform.authenticate(request.header('authorization'), request.vinopsCorrelationId);
  }

  private async resolveUserOrganization(
    identity: RequestIdentity,
    correlationId: string,
  ): Promise<string> {
    return this.notificationService.resolveUserOrganization(identity.userId, correlationId);
  }
}
