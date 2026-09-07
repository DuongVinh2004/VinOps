import { Module } from '@nestjs/common';
import { IssueController } from './issue.controller.js';
import { IssueService } from './issue.service.js';
import { PlatformService } from '../platform.service.js';

@Module({
  controllers: [IssueController],
  providers: [IssueService, PlatformService],
  exports: [IssueService],
})
export class IssueModule {}
