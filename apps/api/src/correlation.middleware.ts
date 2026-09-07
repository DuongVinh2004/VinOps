import { Injectable, type NestMiddleware } from '@nestjs/common';
import { normalizeCorrelationId, runWithCorrelation } from '@vinops/observability';
import type { NextFunction, Request, Response } from 'express';
import { attachCorrelationId } from './request-context.js';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const correlationId = normalizeCorrelationId(request.header('x-correlation-id'));
    attachCorrelationId(request, correlationId);
    response.setHeader('x-correlation-id', correlationId);
    runWithCorrelation(correlationId, next);
  }
}
