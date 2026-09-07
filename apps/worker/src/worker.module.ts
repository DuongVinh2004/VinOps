import { Module } from '@nestjs/common';
import { WorkerLifecycle } from './worker-lifecycle.js';

@Module({ providers: [WorkerLifecycle], exports: [WorkerLifecycle] })
export class WorkerModule {}
