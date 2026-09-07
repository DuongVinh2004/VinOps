import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadApiConfig, parseAllowedOrigins, type ApiConfig } from '@vinops/config';
import { createLogger } from '@vinops/observability';
import { AppModule } from './app.module.js';
import { HttpErrorFilter } from './http-error.filter.js';
import { NestStructuredLogger } from './nest-logger.js';

export type ApiApplication = {
  app: INestApplication;
  config: ApiConfig;
};

export async function createApiApplication(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ApiApplication> {
  const config = loadApiConfig(environment);
  const logger = createLogger('vinops-api', config.VINOPS_LOG_LEVEL);
  const app = await NestFactory.create(AppModule.register(config), {
    bufferLogs: false,
    logger: new NestStructuredLogger(logger),
    abortOnError: false,
  });
  const allowedOrigins = parseAllowedOrigins(config.VINOPS_ALLOWED_ORIGINS);
  app.enableCors({
    credentials: true,
    allowedHeaders: [
      'authorization',
      'content-type',
      'idempotency-key',
      'if-match',
      'x-correlation-id',
      'x-csrf-token',
    ],
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (origin === undefined || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new ForbiddenException('CORS_ORIGIN_DENIED'));
    },
  });
  app.useGlobalFilters(app.get(HttpErrorFilter));
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  return { app, config };
}

export function enableGracefulShutdown(
  application: Pick<INestApplication, 'enableShutdownHooks'>,
): void {
  application.enableShutdownHooks(['SIGINT', 'SIGTERM']);
}
