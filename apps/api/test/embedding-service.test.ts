import { describe, expect, it } from 'vitest';
import { EmbeddingService } from '../src/ai/embedding.service.js';
import { PlatformError } from '../src/platform-error.js';
import type { ApiRuntimeConfig } from '../src/api-runtime.js';

describe('AI Embedding Service Security & Production Guards', () => {
  it('allows simulated embedding fallback when NODE_ENV is test or dev', async () => {
    const devConfig = {
      NODE_ENV: 'test',
    } as unknown as ApiRuntimeConfig;

    const service = new EmbeddingService(devConfig);
    const vector = await service.generateEmbedding('test construction query');
    expect(vector).toHaveLength(1536);
  });

  it('strictly throws 503 EMBEDDING_PROVIDER_UNAVAILABLE in production when OPENAI_API_KEY is missing', async () => {
    const prodConfig = {
      NODE_ENV: 'production',
    } as unknown as ApiRuntimeConfig;

    const service = new EmbeddingService(prodConfig);
    await expect(service.generateEmbedding('production query')).rejects.toThrow(PlatformError);
    await expect(service.generateEmbedding('production query')).rejects.toMatchObject({
      code: 'EMBEDDING_PROVIDER_UNAVAILABLE',
      httpStatus: 503,
    });
  });
});
