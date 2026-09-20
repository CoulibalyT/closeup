import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import {
  CatalogueController,
  MyPacksController,
  PlayablePacksController,
  TakedownController,
} from './packs.controller.js';
import { PacksService } from './packs.service.js';

/** Player packs reuse the back-office's card editor, behind an ownership check. */
@Module({
  imports: [AdminModule],
  controllers: [
    CatalogueController,
    MyPacksController,
    TakedownController,
    PlayablePacksController,
  ],
  providers: [PacksService],
  exports: [PacksService],
})
export class PacksModule {}
