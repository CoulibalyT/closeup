import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module.js';
import { GameGateway } from './gateway/game.gateway.js';
import { RoomService } from './rooms/room.service.js';
import { RoomsController } from './rooms/rooms.controller.js';

@Module({
  imports: [ContentModule],
  controllers: [RoomsController],
  providers: [RoomService, GameGateway],
})
export class GameModule {}
