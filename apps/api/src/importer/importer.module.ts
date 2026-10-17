import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { mediaQueue } from '../pipeline/media-queue.js';
import { BulkImportController } from './bulk/bulk-import.controller.js';
import { BulkImportService } from './bulk/bulk-import.service.js';
import { CardFactory } from './card-factory.js';
import { DatasetCorrections } from './dataset/corrections.js';
import { DatasetImporter } from './dataset/dataset-importer.service.js';
import { ImporterController } from './importer.controller.js';
import { ImporterService } from './importer.service.js';
import { WIKIMEDIA, WikimediaHttpClient } from './wikimedia.client.js';

/** Searches run here; downloads and pictures are the worker's (`CommonsImageService`). */
@Module({
  imports: [mediaQueue(), AdminModule],
  controllers: [ImporterController, BulkImportController],
  providers: [
    ImporterService,
    BulkImportService,
    CardFactory,
    DatasetImporter,
    DatasetCorrections,
    { provide: WIKIMEDIA, useFactory: () => new WikimediaHttpClient() },
  ],
  exports: [DatasetImporter, DatasetCorrections],
})
export class ImporterModule {}
