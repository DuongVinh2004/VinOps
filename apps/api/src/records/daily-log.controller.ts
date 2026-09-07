import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { PlatformError } from '../platform-error.js';
import { PlatformService, type RequestIdentity } from '../platform.service.js';
import type { CorrelatedRequest } from '../request-context.js';
import { DailyLogService } from './daily-log.service.js';

type Request = CorrelatedRequest;

function bodyRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return body as Record<string, unknown>;
}

@Controller('api/v1')
export class DailyLogController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(DailyLogService) private readonly dailyLogs: DailyLogService,
  ) {}

  private async identity(request: Request): Promise<RequestIdentity> {
    return this.platform.authenticate(request.header('authorization'), request.vinopsCorrelationId);
  }

  @Post('projects/:projectId/daily-logs')
  @HttpCode(201)
  async createDailyLog(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.dailyLogs.createDailyLog(
      await this.identity(request),
      projectId,
      input as unknown as Parameters<DailyLogService['createDailyLog']>[2],
      request.vinopsCorrelationId,
    );
  }

  @Get('projects/:projectId/daily-logs')
  async listDailyLogs(
    @Param('projectId') projectId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.dailyLogs.listDailyLogs(
      await this.identity(request),
      projectId,
      request.vinopsCorrelationId,
    );
  }

  @Get('daily-logs/:dailyLogId')
  async getDailyLog(@Param('dailyLogId') logId: string, @Req() request: Request): Promise<unknown> {
    return this.dailyLogs.getDailyLog(
      await this.identity(request),
      logId,
      request.vinopsCorrelationId,
    );
  }

  @Put('daily-logs/:dailyLogId')
  async updateDailyLog(
    @Param('dailyLogId') logId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.dailyLogs.updateDailyLog(
      await this.identity(request),
      logId,
      {
        ...(typeof input['work_summary'] === 'string'
          ? { work_summary: input['work_summary'] }
          : {}),
        ...(typeof input['notes'] === 'string' ? { notes: input['notes'] } : {}),
        ...(typeof input['author_unit'] === 'string' ? { author_unit: input['author_unit'] } : {}),
      },
      request.vinopsCorrelationId,
    );
  }

  @Post('daily-logs/:dailyLogId/manpower')
  async saveManpower(
    @Param('dailyLogId') logId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    const items = (input['items'] as Parameters<DailyLogService['saveManpower']>[2]) ?? [];
    return this.dailyLogs.saveManpower(
      await this.identity(request),
      logId,
      items,
      request.vinopsCorrelationId,
    );
  }

  @Post('daily-logs/:dailyLogId/equipment')
  async saveEquipment(
    @Param('dailyLogId') logId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    const items = (input['items'] as Parameters<DailyLogService['saveEquipment']>[2]) ?? [];
    return this.dailyLogs.saveEquipment(
      await this.identity(request),
      logId,
      items,
      request.vinopsCorrelationId,
    );
  }

  @Post('daily-logs/:dailyLogId/weather')
  async saveWeather(
    @Param('dailyLogId') logId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    const items = (input['items'] as Parameters<DailyLogService['saveWeather']>[2]) ?? [];
    return this.dailyLogs.saveWeather(
      await this.identity(request),
      logId,
      items,
      request.vinopsCorrelationId,
    );
  }

  @Post('daily-logs/:dailyLogId/crawl-weather')
  async crawlWeather(
    @Param('dailyLogId') logId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    let gps: { lat: number; lng: number } | undefined;
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      if (typeof b.gps_lat === 'number' && typeof b.gps_lng === 'number') {
        gps = { lat: b.gps_lat, lng: b.gps_lng };
      }
    }
    return this.dailyLogs.crawlWeatherByGps(
      await this.identity(request),
      logId,
      gps,
      request.vinopsCorrelationId,
    );
  }

  @Post('daily-logs/:dailyLogId/sign-site-manager')
  async signSiteManager(
    @Param('dailyLogId') logId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.dailyLogs.signSiteManager(
      await this.identity(request),
      logId,
      input.signature_data as string,
      request.vinopsCorrelationId,
    );
  }

  @Post('daily-logs/:dailyLogId/sign-supervisor')
  async signSupervisor(
    @Param('dailyLogId') logId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.dailyLogs.signSupervisor(
      await this.identity(request),
      logId,
      input.signature_data as string,
      request.vinopsCorrelationId,
    );
  }
}
