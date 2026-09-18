import { Module } from '@nestjs/common';
import { GameGateway } from './gateway/game.gateway.js';

@Module({ providers: [GameGateway] })
export class GameModule {}
