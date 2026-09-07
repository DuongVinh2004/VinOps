import { Module } from '@nestjs/common';
import { PlatformService } from '../platform.service.js';
import { EmbeddingService } from '../ai/embedding.service.js';
import { AiCopilotController } from './ai-copilot.controller.js';
import { AiCopilotService } from './ai-copilot.service.js';

@Module({
  controllers: [AiCopilotController],
  providers: [PlatformService, EmbeddingService, AiCopilotService],
  exports: [AiCopilotService, EmbeddingService],
})
export class AiCopilotModule {}
