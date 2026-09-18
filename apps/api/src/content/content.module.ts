import { Module } from '@nestjs/common';
import { DeckService } from './deck.service.js';

@Module({ providers: [DeckService], exports: [DeckService] })
export class ContentModule {}
