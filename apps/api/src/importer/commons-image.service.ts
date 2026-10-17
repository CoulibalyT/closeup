import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { UPLOAD } from '@closeup/shared';
import { STORAGE, type StorageDriver, storageKeys } from '../media/storage.js';
import { AutoPointsService } from '../pipeline/auto-points.service.js';
import { IngestService } from '../pipeline/ingest.service.js';
import { isCommonsMediaUrl } from './commons-download.js';
import { WIKIMEDIA, type WikimediaApi } from './wikimedia.client.js';

/**
 * Commons' largest standard rendition. Asking for 3840 px was seen to return this same file:
 * Wikimedia rounds to its own steps.
 */
const RENDITION_WIDTH = 2560;

/**
 * The worker's half of an import: the picture of one card, from Commons to the same ingestion
 * as an upload (decode, strip metadata, resize, store). The job carries a file name, never an
 * address: the address is asked of Commons here, and checked before anything is downloaded. An
 * imported card then gets its points by itself (the face for a person, the detail for the rest).
 */
@Injectable()
export class CommonsImageService {
  constructor(
    @Inject(WIKIMEDIA) private readonly wikimedia: WikimediaApi,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly ingest: IngestService,
    private readonly autoPoints: AutoPointsService,
  ) {}

  async importImage(
    cardId: string,
    file: string,
    options: { publish: boolean } = { publish: false },
  ): Promise<{ status: string }> {
    const info = (await this.wikimedia.files([file], RENDITION_WIDTH)).get(file);
    if (!info) throw new Error(`Commons no longer describes ${file}`);
    // The original when it fits; a picture of 20 MB comes as its 2560 px rendition instead.
    const url = info.size <= UPLOAD.maxBytes ? info.url : info.thumbUrl;
    if (!url) throw new Error(`No rendition of ${file} small enough`);
    if (!isCommonsMediaUrl(url)) throw new Error(`Commons gave an unexpected address for ${file}`);

    const incomingKey = storageKeys.incoming(randomUUID());
    await this.storage.put(incomingKey, await this.wikimedia.download(url));
    const ingested = await this.ingest.ingest(cardId, incomingKey);
    if (ingested.status !== 'NEEDS_POINTS') return ingested;
    return this.autoPoints.apply(cardId, options);
  }
}
