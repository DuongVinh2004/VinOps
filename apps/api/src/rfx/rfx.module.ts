import { Module } from '@nestjs/common';
import { RfxController } from './rfx.controller.js';
import { RfxService } from './rfx.service.js';
import { PlatformService } from '../platform.service.js';

@Module({
  controllers: [RfxController],
  providers: [RfxService, PlatformService],
  exports: [RfxService],
})
export class RfxModule {}
