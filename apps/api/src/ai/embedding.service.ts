import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { API_CONFIG, type ApiRuntimeConfig } from '../api-runtime.js';

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

  constructor(@Inject(API_CONFIG) config: ApiRuntimeConfig) {
    this.openaiApiKey = (config as unknown as Record<string, string>)['OPENAI_API_KEY'];
    this.embeddingModel = 'text-embedding-3-small';
  }

  /**
   * Generates a 1536-dimensional vector for a single text chunk.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const results = await this.generateEmbeddingsBatch([text]);
    return results[0] ?? this.generateSimulatedEmbedding(text);
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
            const data = (await response.json()) as {
              data: Array<{ embedding: number[] }>;
            };
            for (const item of data.data) {
              allEmbeddings.push(item.embedding);
            }
            continue;
          }
          this.logger.warn(`OpenAI embedding API failed with status ${response.status}`);
        } catch (err) {
          this.logger.warn(`OpenAI embedding fetch error: ${String(err)}`);
        }
      }

      // Fallback: deterministic simulated dense embedding (1536 dimensions)
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
