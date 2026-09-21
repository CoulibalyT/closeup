import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { UPLOAD } from '@closeup/shared';
import { STORAGE, type StorageDriver, storageKeys } from '../media/storage.js';
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
 * address: the address is asked of Commons here, and checked before anything is downloaded.
 */
@Injectable()
export class CommonsImageService {
  constructor(
    @Inject(WIKIMEDIA) private readonly wikimedia: WikimediaApi,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly ingest: IngestService,
  ) {}

  async importImage(cardId: string, file: string): Promise<{ status: string }> {
    const info = (await this.wikimedia.files([file], RENDITION_WIDTH)).get(file);
    if (!info) throw new Error(`Commons no longer describes ${file}`);
    // The original when it fits; a picture of 20 MB comes as its 2560 px rendition instead.
    const url = info.size <= UPLOAD.maxBytes ? info.url : info.thumbUrl;
    if (!url) throw new Error(`No rendition of ${file} small enough`);
    if (!isCommonsMediaUrl(url)) throw new Error(`Commons gave an unexpected address for ${file}`);

    const incomingKey = storageKeys.incoming(randomUUID());
    await this.storage.put(incomingKey, await this.wikimedia.download(url));
    return this.ingest.ingest(cardId, incomingKey);
  }
}
