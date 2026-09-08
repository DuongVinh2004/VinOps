import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { API_CONFIG, type ApiRuntimeConfig } from '../api-runtime.js';
import { PlatformError } from '../platform-error.js';

export type StoreChunksInput = {
  organizationId: string;
  projectId: string;
  documentId: string;
  documentRevisionId: string;
  chunks: Array<{
    chunkIndex: number;
    text: string;
    tokenCount: number;
    metadata?: Record<string, unknown>;
  }>;
};

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly openaiApiKey: string | undefined;
  private readonly embeddingModel: string;
  private readonly isProduction: boolean;

  constructor(@Inject(API_CONFIG) config: ApiRuntimeConfig) {
    this.openaiApiKey = (config as unknown as Record<string, string>)['OPENAI_API_KEY'];
    this.embeddingModel = 'text-embedding-3-small';
    this.isProduction = config.NODE_ENV === 'production';
  }

  /**
   * Generates a 1536-dimensional vector for a single text chunk.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const results = await this.generateEmbeddingsBatch([text]);
    const vector = results[0];
    if (!vector) {
      if (this.isProduction) {
        throw new PlatformError(
          'EMBEDDING_FAILED',
          'Failed to generate embedding vector in production.',
          500,
          true,
        );
      }
      return this.generateSimulatedEmbedding(text);
    }
    return vector;
  }

  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private readonly maxFailuresBeforeOpen = 5;
  private readonly openDurationMs = 60_000;

  getCircuitBreakerStatus(): { isOpen: boolean; failures: number } {
    const isOpen =
      this.consecutiveFailures >= this.maxFailuresBeforeOpen && Date.now() < this.circuitOpenUntil;
    return { isOpen, failures: this.consecutiveFailures };
  }

  resetCircuitBreaker(): void {
    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  recordFailureForTest(): void {
    this.recordFailure();
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.maxFailuresBeforeOpen) {
      this.circuitOpenUntil = Date.now() + this.openDurationMs;
      this.logger.error(
        `OpenAI embedding circuit breaker TRIP OPEN for ${this.openDurationMs / 1000}s after ${this.consecutiveFailures} consecutive failures.`,
      );
    }
  }

  /**
   * Batch generates embeddings in chunks of up to 50 items.
   */
  async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const batchSize = 50;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);

      if (this.openaiApiKey) {
        const now = Date.now();
        if (this.consecutiveFailures >= this.maxFailuresBeforeOpen && now < this.circuitOpenUntil) {
          throw new PlatformError(
            'EMBEDDING_PROVIDER_UNAVAILABLE',
            `OpenAI embedding circuit breaker is OPEN until ${new Date(this.circuitOpenUntil).toISOString()}`,
            503,
            true,
          );
        }

        let batchSuccess = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const response = await fetch('https://api.openai.com/v1/embeddings', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.openaiApiKey}`,
              },
              body: JSON.stringify({
                input: batch,
                model: this.embeddingModel,
                dimensions: 1536,
              }),
            });

            if (response.ok) {
              this.consecutiveFailures = 0;
              const data = (await response.json()) as {
                data: Array<{ embedding: number[] }>;
              };
              for (const item of data.data) {
                allEmbeddings.push(item.embedding);
              }
              batchSuccess = true;
              break;
            }

            const isTransient = [429, 500, 502, 503, 504].includes(response.status);
            if (!isTransient || attempt === 3) {
              this.recordFailure();
              if (this.isProduction) {
                throw new PlatformError(
                  'EMBEDDING_PROVIDER_UNAVAILABLE',
                  `OpenAI embedding API failed with status ${response.status}`,
                  503,
                  true,
                );
              }
              this.logger.warn(`OpenAI embedding API failed with status ${response.status}`);
              break;
            }

            const delay = Math.min(100 * Math.pow(2, attempt - 1), 2000);
            this.logger.warn(
              `OpenAI embedding failed with ${response.status}. Retrying attempt ${attempt}/3 after ${delay}ms...`,
            );
            await new Promise((r) => setTimeout(r, delay));
          } catch (err) {
            if (err instanceof PlatformError) {
              throw err;
            }
            if (attempt === 3) {
              this.recordFailure();
              if (this.isProduction) {
                throw new PlatformError(
                  'EMBEDDING_PROVIDER_UNAVAILABLE',
                  `OpenAI embedding fetch error: ${String(err)}`,
                  503,
                  true,
                );
              }
              this.logger.warn(`OpenAI embedding fetch error: ${String(err)}`);
              break;
            }
            const delay = Math.min(100 * Math.pow(2, attempt - 1), 2000);
            await new Promise((r) => setTimeout(r, delay));
          }
        }

        if (batchSuccess) {
          continue;
        }
      } else if (this.isProduction) {
        throw new PlatformError(
          'EMBEDDING_PROVIDER_UNAVAILABLE',
          'OpenAI API key is missing in production; simulated embeddings are strictly prohibited.',
          503,
          true,
        );
      }

      // Fallback: deterministic simulated dense embedding (1536 dimensions) in dev/test only
      for (const text of batch) {
        allEmbeddings.push(this.generateSimulatedEmbedding(text));
      }
    }

    return allEmbeddings;
  }

  /**
   * Persists chunks and their embeddings into vinops.document_embeddings.
   */
  async storeDocumentChunks(client: PoolClient, input: StoreChunksInput): Promise<number> {
    if (input.chunks.length === 0) return 0;

    const texts = input.chunks.map((c) => c.text);
    const embeddings = await this.generateEmbeddingsBatch(texts);

    for (let i = 0; i < input.chunks.length; i++) {
      const chunk = input.chunks[i]!;
      const embedding = embeddings[i]!;
      const vectorLiteral = `[${embedding.join(',')}]`;

      await client.query(
        `INSERT INTO vinops.document_embeddings (
          id, organization_id, project_id,
          document_id, document_revision_id,
          chunk_index, chunk_text, embedding, token_count, metadata, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid,
          $4::uuid, $5::uuid,
          $6, $7, $8::vector, $9, $10::jsonb, now()
        )
        ON CONFLICT (document_revision_id, chunk_index) DO UPDATE
          SET chunk_text = EXCLUDED.chunk_text,
              embedding = EXCLUDED.embedding,
              token_count = EXCLUDED.token_count,
              metadata = EXCLUDED.metadata`,
        [
          randomUUID(),
          input.organizationId,
          input.projectId,
          input.documentId,
          input.documentRevisionId,
          chunk.chunkIndex,
          chunk.text,
          vectorLiteral,
          chunk.tokenCount,
          JSON.stringify(chunk.metadata ?? {}),
        ],
      );
    }

    return input.chunks.length;
  }

  /**
   * Deterministic 1536-dimensional unit vector from text for testing/offline scenarios.
   */
  generateSimulatedEmbedding(text: string): number[] {
    const vector = new Array<number>(1536).fill(0);
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
      seed = (seed * 31 + text.charCodeAt(i)) & 0xffffffff;
    }

    let sumSquares = 0;
    for (let i = 0; i < 1536; i++) {
      // pseudo-random generation based on seed and dimension
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      const val = (seed / 0xffffffff) * 2 - 1;
      vector[i] = val;
      sumSquares += val * val;
    }

    // Normalize to unit length for cosine similarity
    const norm = Math.sqrt(sumSquares) || 1;
    return vector.map((v) => Number((v / norm).toFixed(6)));
  }
}
