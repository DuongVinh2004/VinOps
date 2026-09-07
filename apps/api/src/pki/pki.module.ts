import { Module } from '@nestjs/common';
import { SigningController } from './signing.controller.js';
import { SigningService } from './signing.service.js';
import { PlatformService } from '../platform.service.js';

@Module({
  controllers: [SigningController],
  providers: [SigningService, PlatformService],
  exports: [SigningService],
})
export class PkiModule {}
