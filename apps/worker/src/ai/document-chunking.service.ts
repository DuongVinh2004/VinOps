export type DocumentChunk = {
  chunkIndex: number;
  text: string;
  tokenCount: number;
  heading?: string | undefined;
};

export type ChunkingOptions = {
  maxTokens?: number;
  overlapTokens?: number;
};

export class DocumentChunkingService {
  private readonly defaultMaxTokens: number;
  private readonly defaultOverlapTokens: number;

  constructor(options?: ChunkingOptions) {
    this.defaultMaxTokens = options?.maxTokens ?? 500;
    this.defaultOverlapTokens = options?.overlapTokens ?? 100;
  }

  /**
   * Approximate token count for Vietnamese/English technical text.
   * On average in multilingual/Vietnamese technical text, 1 token ~ 3.5 characters.
   */
  estimateTokenCount(text: string): number {
    return Math.max(1, Math.ceil(text.trim().length / 3.5));
  }

  /**
   * Splits document text into chunks respecting section headings and sentence boundaries.
   */
  chunkText(fullText: string, options?: ChunkingOptions): DocumentChunk[] {
    const maxTokens = options?.maxTokens ?? this.defaultMaxTokens;
    const overlapTokens = options?.overlapTokens ?? this.defaultOverlapTokens;

    if (!fullText || fullText.trim().length === 0) {
      return [];
    }

    // Split text into paragraphs or section lines
    const rawParagraphs = fullText
      .split(/\n\s*\n/u)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const chunks: DocumentChunk[] = [];
    let currentChunkText = '';
    let currentHeading = '';
    let chunkIndex = 0;

    const headingRegex =
      /^(?:Điều\s+\d+|Mục\s+[\d.]+|Chương\s+[IVXLCDM]+|Section\s+[\d.]+|PHẦN\s+[\dIVXLCDM]+|TCVN\s+\d+)/iu;

    for (const paragraph of rawParagraphs) {
      if (headingRegex.test(paragraph)) {
        currentHeading = paragraph.slice(0, 120);
      }

      const prospectiveText = currentChunkText
        ? `${currentChunkText}\n\n${paragraph}`
        : currentHeading
          ? `[${currentHeading}]\n${paragraph}`
          : paragraph;

      const prospectiveTokens = this.estimateTokenCount(prospectiveText);

      if (prospectiveTokens <= maxTokens) {
        currentChunkText = prospectiveText;
      } else {
        // Current chunk is full, push it
        if (currentChunkText.length > 0) {
          chunks.push({
            chunkIndex,
            text: currentChunkText,
            tokenCount: this.estimateTokenCount(currentChunkText),
            heading: currentHeading || undefined,
          });
          chunkIndex++;

          // Form overlap from the end of current chunk
          const sentences = currentChunkText.split(/(?<=[.!?])\s+/u);
          let overlapText = '';
          for (let i = sentences.length - 1; i >= 0; i--) {
            const candidate = sentences.slice(i).join(' ');
            if (this.estimateTokenCount(candidate) <= overlapTokens) {
              overlapText = candidate;
            } else {
              break;
            }
          }

          currentChunkText = overlapText ? `${overlapText}\n\n${paragraph}` : paragraph;
        } else {
          // Paragraph itself exceeds maxTokens: hard split by sentences
          const sentences = paragraph.split(/(?<=[.!?])\s+/u);
          for (const sentence of sentences) {
            const testText = currentChunkText ? `${currentChunkText} ${sentence}` : sentence;
            if (this.estimateTokenCount(testText) > maxTokens && currentChunkText) {
              chunks.push({
                chunkIndex,
                text: currentChunkText,
                tokenCount: this.estimateTokenCount(currentChunkText),
                heading: currentHeading || undefined,
              });
              chunkIndex++;
              currentChunkText = sentence;
            } else {
              currentChunkText = testText;
            }
          }
        }
      }
    }

    if (currentChunkText.trim().length > 0) {
      chunks.push({
        chunkIndex,
        text: currentChunkText,
        tokenCount: this.estimateTokenCount(currentChunkText),
        heading: currentHeading || undefined,
      });
    }

    return chunks;
  }
}
