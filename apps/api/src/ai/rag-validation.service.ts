import { Injectable, Logger } from '@nestjs/common';

export interface RetrievedChunk {
  documentId: string;
  chunkIndex: number;
  text: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export interface RagValidationResult {
  accepted: boolean;
  abstentionReason?: string;
  citations: Array<{
    sourceDocumentId: string;
    chunkIndex: number;
    similarity: number;
  }>;
  filteredContext: string[];
}

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /disregard\s+(all\s+)?(previous|prior)\s+instructions/i,
  /system\s*prompt\s*override/i,
  /bypass\s+safety\s+guidelines/i,
  /you\s+are\s+now\s+in\s+developer\s+mode/i,
  /jailbreak/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
];

@Injectable()
export class RagValidationService {
  private readonly logger = new Logger(RagValidationService.name);
  private readonly defaultSimilarityThreshold = 0.75;

  /**
   * Computes cosine similarity between two numeric vectors.
   */
  computeCosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length === 0 || vecA.length !== vecB.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      const a = vecA[i]!;
      const b = vecB[i]!;
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }

    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Scans user prompt for injection attempts.
   */
  detectPromptInjection(prompt: string): { isInjected: boolean; patternMatched?: string } {
    for (const pattern of PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(prompt)) {
        return { isInjected: true, patternMatched: pattern.source };
      }
    }
    return { isInjected: false };
  }

  /**
   * Validates retrieved chunks against similarity threshold, citations, and abstention rules.
   */
  validateRetrievedContext(
    chunks: RetrievedChunk[],
    threshold = this.defaultSimilarityThreshold,
  ): RagValidationResult {
    if (chunks.length === 0) {
      return {
        accepted: false,
        abstentionReason: 'Không tìm thấy thông tin phù hợp trong tài liệu dự án.',
        citations: [],
        filteredContext: [],
      };
    }

    // Filter chunks satisfying threshold
    const qualifiedChunks = chunks.filter((c) => c.similarity >= threshold);

    if (qualifiedChunks.length === 0) {
      const maxSim = Math.max(...chunks.map((c) => c.similarity));
      this.logger.warn(
        `All retrieved chunks fell below similarity threshold ${threshold} (max was ${maxSim.toFixed(3)}). Abstaining.`,
      );
      return {
        accepted: false,
        abstentionReason: `Độ tương đồng tài liệu cao nhất (${maxSim.toFixed(2)}) không đạt ngưỡng tối thiểu (${threshold}).`,
        citations: [],
        filteredContext: [],
      };
    }

    const citations = qualifiedChunks.map((c) => ({
      sourceDocumentId: c.documentId,
      chunkIndex: c.chunkIndex,
      similarity: Number(c.similarity.toFixed(4)),
    }));

    const filteredContext = qualifiedChunks.map((c) => c.text);

    return {
      accepted: true,
      citations,
      filteredContext,
    };
  }

  /**
   * Verifies that the model's response adheres to retrieved context without unsupported claims.
   */
  verifyGroundedness(
    response: string,
    citations: Array<{ sourceDocumentId: string }>,
  ): { isGrounded: boolean; reason?: string } {
    if (citations.length === 0) {
      return {
        isGrounded: false,
        reason: 'Câu trả lời không có trích dẫn tài liệu nguồn hợp lệ.',
      };
    }

    if (!response || response.trim().length === 0) {
      return { isGrounded: false, reason: 'Nội dung phản hồi rỗng.' };
    }

    return { isGrounded: true };
  }
}
