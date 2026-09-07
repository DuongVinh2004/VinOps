import { Module } from '@nestjs/common';
import { BimController } from './bim.controller.js';
import { BimService } from './bim.service.js';

@Module({
  controllers: [BimController],
  providers: [BimService],
  exports: [BimService],
})
export class BimModule {}
