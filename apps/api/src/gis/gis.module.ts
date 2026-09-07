import { Module } from '@nestjs/common';
import { PlatformService } from '../platform.service.js';
import { GisController } from './gis.controller.js';
import { GisService } from './gis.service.js';

@Module({
  controllers: [GisController],
  providers: [PlatformService, GisService],
  exports: [GisService],
})
export class GisModule {}
