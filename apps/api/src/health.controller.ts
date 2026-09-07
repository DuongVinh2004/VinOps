import { Controller, Get } from '@nestjs/common';

type HealthResponse = {
  status: 'live' | 'ready';
};

@Controller('health')
export class HealthController {
  @Get('live')
  liveness(): HealthResponse {
    return { status: 'live' };
  }

  @Get('ready')
  readiness(): HealthResponse {
    return { status: 'ready' };
  }
}
