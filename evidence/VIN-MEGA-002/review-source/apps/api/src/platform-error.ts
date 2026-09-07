import { DomainError } from '@vinops/domain';

export type ErrorDetails = Record<string, string | number | boolean | null>;

export class PlatformError extends Error {
  constructor(
    readonly code: string,
    readonly messageKey: string,
    readonly httpStatus: number,
    readonly retryable = false,
    readonly details?: ErrorDetails,
  ) {
    super(messageKey);
    this.name = 'PlatformError';
  }
}

function isPlatformErrorLike(value: unknown): value is {
  code: string;
  messageKey: string;
  httpStatus: number;
  retryable: boolean;
  details?: ErrorDetails | undefined;
} {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.messageKey === 'string' &&
    typeof candidate.httpStatus === 'number' &&
    typeof candidate.retryable === 'boolean'
  );
}

const domainStatus: Record<string, number> = {
  INVALID_PROJECT_TRANSITION: 409,
  PROJECT_ACTIVATION_PREREQUISITES_MISSING: 422,
  PROJECT_NOT_MUTABLE: 409,
  INVALID_EMAIL: 422,
  MEMBERSHIP_NOT_EFFECTIVE: 403,
  SELF_ESCALATION_FORBIDDEN: 403,
  RESOURCE_SCOPE_DENIED: 403,
  DELEGATION_NOT_EFFECTIVE: 403,
  BREAK_GLASS_NOT_EFFECTIVE: 403,
  TREE_CYCLE: 422,
  DUPLICATE_SIBLING_CODE: 409,
  EXPECTED_VERSION_REQUIRED: 422,
};

export function asPlatformError(error: unknown): PlatformError {
  if (error instanceof PlatformError) {
    return error;
  }
  if (isPlatformErrorLike(error)) {
    return new PlatformError(
      error.code,
      error.messageKey,
      error.httpStatus,
      error.retryable,
      error.details,
    );
  }
  if (error instanceof DomainError) {
    return new PlatformError(
      error.code,
      `errors.${error.code.toLocaleLowerCase('en-US')}`,
      domainStatus[error.code] ?? 422,
      error.retryable,
    );
  }
  return new PlatformError('INTERNAL_ERROR', 'errors.internal', 500, false);
}
