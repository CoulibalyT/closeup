import { Global, Module } from '@nestjs/common';
import { HistoryService } from './history.service.js';

@Global()
@Module({ providers: [HistoryService], exports: [HistoryService] })
export class HistoryModule {}
