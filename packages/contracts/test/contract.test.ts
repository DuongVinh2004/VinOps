import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

type OpenApiDocument = {
  info: {
    version: string;
    description: string;
    'x-vinops-cr-002': Record<string, unknown>;
    'x-vinops-response-invariants': Record<string, unknown>;
  };
  paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
  components: {
    headers: Record<string, unknown>;
    responses: Record<string, unknown>;
    parameters: Record<string, unknown>;
    schemas: Record<string, unknown>;
    securitySchemes: { refreshCookie: { name: string; description: string } };
  };
};

const contractPath = fileURLToPath(new URL('../openapi/vinops.openapi.yaml', import.meta.url));
const contract = parse(readFileSync(contractPath, 'utf8')) as OpenApiDocument;

describe('OpenAPI foundation plus Document Control contract', () => {
  it('identifies the implemented Document Control version and retains approved cookie policy', () => {
    expect(contract.info.version).toBe('1.1.0');
    expect(contract.info['x-vinops-cr-002']).toMatchObject({
      access_token: { default_ttl_minutes: 15, storage: 'browser-memory-only' },
      refresh_credential: { default_idle_ttl_days: 7, default_absolute_ttl_days: 30 },
    });
    expect(contract.components.securitySchemes.refreshCookie.name).toBe('vinops_refresh');
    expect(contract.components.securitySchemes.refreshCookie.description).toContain(
      'Path=/api/v1/auth',
    );
  });

  it('defines Set-Cookie, 404 and 503 components and applies them to key operations', () => {
    expect(contract.components.headers).toHaveProperty('RefreshSetCookie');
    expect(contract.components.headers).toHaveProperty('ExpiredRefreshSetCookie');
    expect(contract.components.responses).toHaveProperty('ResourceNotVisible');
    expect(contract.components.responses).toHaveProperty('DependencyUnavailable');

    const login = contract.paths['/auth/sessions']?.post?.responses;
    const revokeAll = contract.paths['/auth/sessions']?.delete?.responses;
    const refresh = contract.paths['/auth/refresh']?.post?.responses;
    const revoke = contract.paths['/auth/sessions/{sessionId}']?.delete?.responses;
    const detail = contract.paths['/documents/{documentId}']?.get?.responses;
    const download = contract.paths['/revisions/{revisionId}/download']?.get?.responses;

    expect(login).toHaveProperty('200.headers.Set-Cookie');
    expect(login).toHaveProperty('503');
    expect(refresh).toHaveProperty('200.headers.Set-Cookie');
    expect(revokeAll).toHaveProperty('204.headers.Set-Cookie');
    expect(revoke).toHaveProperty('404');
    expect(detail).toHaveProperty('404');
    expect(download).toHaveProperty('503');
  });

  it('covers the authorized Mega-001 identity, IAM, and Project Context route surface', () => {
    const expectedOperations: ReadonlyArray<readonly [string, string]> = [
      ['/auth/sessions', 'delete'],
      ['/auth/password-resets', 'post'],
      ['/auth/password-resets/confirm', 'post'],
      ['/organizations', 'get'],
      ['/organizations', 'post'],
      ['/organizations/{organizationId}/members', 'get'],
      ['/organizations/{organizationId}/members', 'post'],
      ['/projects/{projectId}', 'get'],
      ['/projects/{projectId}/context', 'get'],
      ['/projects/{projectId}/context/{kind}', 'post'],
      ['/projects/{projectId}/context-imports/preview', 'post'],
      ['/projects/{projectId}/context-imports/{importId}/commit', 'post'],
      ['/projects/{projectId}/delegations', 'post'],
      ['/projects/{projectId}/break-glass-requests', 'post'],
      ['/break-glass-requests/{requestId}/approve', 'post'],
      ['/break-glass-requests/{requestId}/sessions', 'post'],
      ['/projects/{projectId}/invitations/{invitationId}', 'delete'],
    ];

    for (const [path, method] of expectedOperations) {
      expect(contract.paths[path]).toHaveProperty(method);
    }

    expect(contract.components.parameters).toHaveProperty('IdempotencyKey');
    expect(contract.components.parameters).toHaveProperty('UploadSessionId');
    expect(contract.components.parameters).toHaveProperty('Cursor');
    expect(contract.components.headers).toHaveProperty('CorrelationId');
    const invariants = contract.info['x-vinops-response-invariants'];
    const mutationInvariant = invariants.mutation;
    const paginationInvariant = invariants.pagination;
    expect(typeof mutationInvariant).toBe('string');
    expect(typeof paginationInvariant).toBe('string');
    if (typeof mutationInvariant !== 'string' || typeof paginationInvariant !== 'string') {
      throw new Error('OpenAPI response invariants must be strings.');
    }
    expect(mutationInvariant).toContain('Idempotency-Key');
    expect(paginationInvariant).toContain('Cursor');
  });

  it('models security-sensitive lifecycle, scope, and implemented Document Control boundaries explicitly', () => {
    const schemas = contract.components.schemas as Record<
      string,
      {
        properties?: Record<string, { enum?: readonly string[] }>;
      }
    >;
    const projectTransition = schemas.ProjectTransition?.properties?.action?.enum;
    const memberScope = schemas.MemberScope?.properties?.scope_type?.enum;
    const breakGlass = schemas.BreakGlassRequest?.properties?.status?.enum;

    expect(projectTransition).toEqual(
      expect.arrayContaining(['activate', 'suspend', 'complete_archive', 'restore']),
    );
    expect(memberScope).toEqual(
      expect.arrayContaining(['project', 'location', 'work', 'discipline', 'classification']),
    );
    expect(breakGlass).toEqual(expect.arrayContaining(['Requested', 'Approved']));
    expect(contract.info.description).toContain('VIN-MEGA-002 Document Control vertical slice');
    expect(contract.info.description).toContain('explicit context pointer');
    expect(contract.paths).toHaveProperty('/projects/{projectId}/documents');
    expect(contract.paths).toHaveProperty('/documents/{documentId}/revisions');
    expect(contract.paths).toHaveProperty(
      '/upload-sessions/{uploadSessionId}/parts/{partNumber}/authorization',
    );
    expect(contract.paths).toHaveProperty('/revisions/{revisionId}/comments');
    expect(contract.paths).toHaveProperty('/review-comments/{commentId}/dispositions');
    expect(contract.paths).toHaveProperty('/revisions/{revisionId}/annotations');
    expect(contract.paths).toHaveProperty('/revisions/{revisionId}/preview');
    expect(contract.paths).toHaveProperty('/projects/{projectId}/review-inbox');
    expect(contract.paths).toHaveProperty('/projects/{projectId}/transmittals');
    expect(contract.paths).toHaveProperty('/transmittals/{transmittalId}');
    expect(contract.components.schemas).toHaveProperty('ReviewCommentDisposition');
    expect(contract.components.schemas).toHaveProperty('Transmittal');
  });
});
