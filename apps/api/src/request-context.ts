import type { Request } from 'express';

export type CorrelatedRequest = Request & { vinopsCorrelationId: string };

export function attachCorrelationId(request: Request, correlationId: string): CorrelatedRequest {
  const correlated = request as CorrelatedRequest;
  correlated.vinopsCorrelationId = correlationId;
  return correlated;
}

export function correlationIdOf(request: Request): string {
  return (request as CorrelatedRequest).vinopsCorrelationId;
}
