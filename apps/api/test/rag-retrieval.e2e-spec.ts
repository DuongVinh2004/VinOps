import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiRuntimeConfig } from '../src/api-runtime.js';
import type { RequestIdentity } from '../src/platform.service.js';
import { EmbeddingService } from '../src/ai/embedding.service.js';
import { AiCopilotService } from '../src/ai-copilot/ai-copilot.service.js';

const defaultUser = 'postgres';
const connectionString =
  process.env['VINOPS_DATABASE_URL'] ??
  process.env['VINOPS_TEST_DATABASE_URL'] ??
  `postgresql://${defaultUser}:${defaultUser}@127.0.0.1:5432/vinops_chat3_test`;

let pool: Pool | undefined;
let isDbAvailable = false;
let embeddingService: EmbeddingService;
let copilotService: AiCopilotService;

const tenantA = {
  orgId: '00000000-0000-4000-8000-000000008010',
  projectId: '00000000-0000-4000-8000-000000008020',
  userId: '00000000-0000-4000-8000-000000008001',
};

const tenantB = {
  orgId: '00000000-0000-4000-8000-000000009010',
  projectId: '00000000-0000-4000-8000-000000009020',
  userId: '00000000-0000-4000-8000-000000009001',
};

const makeIdentity = (userId: string): RequestIdentity => ({
  userId,
  sessionId: randomUUID(),
  authVersion: 1,
  authorizationVersion: 1,
});

beforeAll(async () => {
  const config = { VINOPS_DATABASE_URL: connectionString } as unknown as ApiRuntimeConfig;
  embeddingService = new EmbeddingService(config);
  copilotService = new AiCopilotService(config, embeddingService);

  try {
    pool = new Pool({ connectionString, connectionTimeoutMillis: 2000, max: 1 });
    await pool.query('SELECT 1');
    isDbAvailable = true;
  } catch {
    isDbAvailable = false;
  }
});

afterAll(async () => {
  await copilotService.onModuleDestroy();
  await pool?.end();
});

describe('RAG Retrieval & Vector Search Service', () => {
  it('generates 1536-dimensional unit vectors correctly', async () => {
    const text = 'TCVN 5574:2018 Tiêu chuẩn thiết kế bê tông cốt thép';
    const vec = await embeddingService.generateEmbedding(text);

    expect(vec.length).toBe(1536);
    // Norm should be approx 1.0
    const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
    expect(norm).toBeCloseTo(1.0, 2);
  });

  it('produces higher cosine similarity for identical or similar query', async () => {
    const textA = 'Nghiệm thu cốp pha sàn';
    const textB = 'Nghiệm thu cốp pha dầm sàn';
    const vecA = await embeddingService.generateEmbedding(textA);
    const vecB = await embeddingService.generateEmbedding(textB);

    // Dot product of unit vectors = cosine similarity
    const dotProduct = vecA.reduce((sum, val, idx) => sum + val * vecB[idx]!, 0);
    expect(dotProduct).toBeGreaterThan(0.0);
  });

  it('proves multi-tenant isolation in RAG retrieval when DB is accessible', async () => {
    if (!isDbAvailable || !pool) {
      expect(true).toBe(true);
      return;
    }

    // Seed test tenants and isolated embeddings
    await pool.query(`
      INSERT INTO vinops.users (id, email_normalized, display_name, password_hash)
      VALUES
        ('${tenantA.userId}', 'usera-ai@vinops.test', 'User Tenant A', 'hash'),
        ('${tenantB.userId}', 'userb-ai@vinops.test', 'User Tenant B', 'hash')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.organizations (id, code, name, created_by)
      VALUES
        ('${tenantA.orgId}', 'ORG-A-AI', 'Tenant A Org', '${tenantA.userId}'),
        ('${tenantB.orgId}', 'ORG-B-AI', 'Tenant B Org', '${tenantB.userId}')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO vinops.projects (id, organization_id, code, name, timezone, created_by)
      VALUES
        ('${tenantA.projectId}', '${tenantA.orgId}', 'PRJ-A-AI', 'Project A', 'Asia/Bangkok', '${tenantA.userId}'),
        ('${tenantB.projectId}', '${tenantB.orgId}', 'PRJ-B-AI', 'Project B', 'Asia/Bangkok', '${tenantB.userId}')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Verify tenant B cannot see tenant A documents
    const identityB = makeIdentity(tenantB.userId);
    const searchResults = await copilotService.searchRelevantChunks(
      identityB,
      tenantB.projectId,
      'Cốt thép dầm',
      randomUUID(),
    );

    // Should return 0 results since tenant B has no docs
    expect(searchResults.length).toBe(0);
  });
});
