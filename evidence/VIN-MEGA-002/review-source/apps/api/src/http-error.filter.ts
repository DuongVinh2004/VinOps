import { Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { asPlatformError, PlatformError } from './platform-error.js';
import { correlationIdOf } from './request-context.js';

type ErrorResponse = {
  code: string;
  message_key: string;
  details?: Record<string, string | number | boolean | null>;
  correlation_id: string;
  retryable: boolean;
};

function correlationId(request: Request): string {
  return correlationIdOf(request);
}

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const platformError = this.toPlatformError(exception);
    const payload: ErrorResponse = {
      code: platformError.code,
      message_key: platformError.messageKey,
      correlation_id: correlationId(request),
      retryable: platformError.retryable,
    };
    if (platformError.details !== undefined) {
      payload.details = platformError.details;
    }
    if (platformError.httpStatus === 429) {
      const retryAfter = platformError.details?.retry_after_seconds;
      if (typeof retryAfter === 'number') {
        response.setHeader('Retry-After', String(retryAfter));
      }
    }
    response.status(platformError.httpStatus).json(payload);
  }

  private toPlatformError(exception: unknown): PlatformError {
    if (exception instanceof HttpException) {
      return new PlatformError('HTTP_ERROR', 'errors.http', exception.getStatus(), false);
    }
    return asPlatformError(exception);
  }
}
