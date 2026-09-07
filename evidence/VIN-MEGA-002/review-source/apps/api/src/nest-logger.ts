import type { LoggerService } from '@nestjs/common';
import type { StructuredLogger } from '@vinops/observability';

export class NestStructuredLogger implements LoggerService {
  constructor(private readonly logger: StructuredLogger) {}

  log(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.info({ optionalParameters }, String(message));
  }

  error(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.error({ optionalParameters }, String(message));
  }

  warn(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.warn({ optionalParameters }, String(message));
  }

  debug(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.debug({ optionalParameters }, String(message));
  }

  verbose(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.trace({ optionalParameters }, String(message));
  }
}
