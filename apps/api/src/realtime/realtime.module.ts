import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway.js';
import { RoomDispatcher } from './room-dispatcher.js';
import { WsAuthGuard } from './guards/ws-auth.guard.js';

@Module({
  providers: [RoomDispatcher, RealtimeGateway, WsAuthGuard],
  exports: [RoomDispatcher, RealtimeGateway, WsAuthGuard],
})
export class RealtimeModule {}
