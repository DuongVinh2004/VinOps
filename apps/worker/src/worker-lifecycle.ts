import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

@Injectable()
export class WorkerLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  onApplicationBootstrap(): void {
    this.running = true;
  }

  onApplicationShutdown(): void {
    this.running = false;
  }
}
