import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { PlatformError } from '../platform-error.js';

export interface RagActorContext {
  userId: string;
  organizationId: string;
  projectIds?: string[];
  role?: string;
}

export interface RagResourceScope {
  organizationId: string;
  projectId: string;
  documentId?: string;
}

/**
 * Validates that an actor has legitimate tenant and project-level authorization
 * before executing vector search or retrieval in vinops.document_embeddings.
 */
export function validateRagAccess(actor: RagActorContext, target: RagResourceScope): void {
  if (!actor || !actor.organizationId) {
    throw new PlatformError(
      'UNAUTHORIZED',
      'Unauthenticated actor context cannot execute RAG retrieval',
      401,
      true,
    );
  }

  // Multi-tenant strict isolation: actor org must match target org
  if (actor.organizationId !== target.organizationId) {
    throw new PlatformError(
      'FORBIDDEN',
      `Tenant boundary violation: actor org ${actor.organizationId} cannot access org ${target.organizationId}`,
      403,
      true,
    );
  }

  // Project-level isolation: if actor has restricted projectIds list, verify membership
  if (actor.projectIds && actor.projectIds.length > 0) {
    if (!actor.projectIds.includes(target.projectId)) {
      throw new PlatformError(
        'FORBIDDEN',
        `Project boundary violation: actor cannot access project ${target.projectId}`,
        403,
        true,
      );
    }
  }
}

/**
 * Constructs parameterized SQL for RAG vector retrieval, enforcing strict tenant and project filters.
 */
export function buildScopedRagQuery(scope: {
  organizationId: string;
  projectId: string;
  documentId?: string;
  topK?: number;
}): { sql: string; values: unknown[] } {
  const values: unknown[] = [scope.organizationId, scope.projectId];
  let paramIndex = 3;

  let whereClause = `WHERE organization_id = $1 AND project_id = $2`;

  if (scope.documentId) {
    whereClause += ` AND document_id = $${paramIndex}`;
    values.push(scope.documentId);
    paramIndex++;
  }

  const topK = Math.min(Math.max(scope.topK ?? 5, 1), 50);

  const sql = `
    SELECT
      id,
      organization_id,
      project_id,
      document_id,
      document_revision_id,
      chunk_index,
      text,
      token_count,
      metadata,
      1 - (embedding <=> $${paramIndex}::vector) AS similarity
    FROM vinops.document_embeddings
    ${whereClause}
    ORDER BY embedding <=> $${paramIndex}::vector ASC
    LIMIT ${topK};
  `.trim();

  return { sql, values };
}

@Injectable()
export class RagAclGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: RagActorContext;
      query?: Record<string, string>;
      body?: Record<string, unknown>;
      params?: Record<string, string>;
    }>();

    const user = request.user;
    if (!user) {
      throw new PlatformError(
        'UNAUTHORIZED',
        'Authentication required for RAG endpoints',
        401,
        true,
      );
    }

    const organizationId =
      request.params?.organizationId ??
      request.query?.organizationId ??
      (request.body?.organizationId as string | undefined);

    const projectId =
      request.params?.projectId ??
      request.query?.projectId ??
      (request.body?.projectId as string | undefined);

    if (organizationId && projectId) {
      validateRagAccess(user, { organizationId, projectId });
    }

    return true;
  }
}
