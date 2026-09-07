import type { LoggerService } from '@nestjs/common';
import type { Logger } from 'pino';

export class NestStructuredLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.info({ message, optionalParameters }, 'Nest log');
  }

  error(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.error({ message, optionalParameters }, 'Nest error');
  }

  warn(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.warn({ message, optionalParameters }, 'Nest warning');
  }

  debug(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.debug({ message, optionalParameters }, 'Nest debug');
  }

  verbose(message: unknown, ...optionalParameters: unknown[]): void {
    this.logger.trace({ message, optionalParameters }, 'Nest verbose');
  }
}
