import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway.js';
import { RoomDispatcher } from './room-dispatcher.js';
import { WsAuthGuard } from './guards/ws-auth.guard.js';
import { RedisSubscriberService } from './redis-subscriber.service.js';

@Module({
  providers: [RoomDispatcher, RedisSubscriberService, RealtimeGateway, WsAuthGuard],
  exports: [RoomDispatcher, RedisSubscriberService, RealtimeGateway, WsAuthGuard],
})
export class RealtimeModule {}
