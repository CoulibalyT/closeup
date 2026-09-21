import { describe, expect, it, vi } from 'vitest';
import type { StorageDriver } from '../media/storage.js';
import type { IngestService } from '../pipeline/ingest.service.js';
import { CommonsImageService } from './commons-image.service.js';
import type { CommonsFile, WikimediaApi } from './wikimedia.client.js';

const ORIGINAL = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Elephant.jpg';
const RENDITION =
  'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Elephant.jpg/2560px-Elephant.jpg';

function setUp(file: Partial<CommonsFile> | null) {
  const wikimedia = {
    files: vi.fn(async () =>
      file
        ? new Map([
            [
              'Elephant.jpg',
              { url: ORIGINAL, thumbUrl: RENDITION, size: 1, ...file } as CommonsFile,
            ],
          ])
        : new Map(),
    ),
    download: vi.fn(async () => Buffer.from('bytes')),
  };
  const storage = { put: vi.fn(async () => undefined) };
  const ingest = { ingest: vi.fn(async () => ({ status: 'NEEDS_POINTS' })) };
  const service = new CommonsImageService(
    wikimedia as unknown as WikimediaApi,
    storage as unknown as StorageDriver,
    ingest as unknown as IngestService,
  );
  return { service, wikimedia, storage, ingest };
}

describe('CommonsImageService', () => {
  it('downloads the original when it fits, then ingests it like an upload', async () => {
    const { service, wikimedia, storage, ingest } = setUp({ size: 4_000_000 });
    expect(await service.importImage('card-1', 'Elephant.jpg')).toEqual({ status: 'NEEDS_POINTS' });
    expect(wikimedia.download).toHaveBeenCalledWith(ORIGINAL);
    const [key] = storage.put.mock.calls[0] as unknown as [string];
    expect(ingest.ingest).toHaveBeenCalledWith('card-1', key);
  });

  it('takes the 2560 px rendition of an original over the size limit', async () => {
    const { service, wikimedia } = setUp({ size: 21_000_000 });
    await service.importImage('card-1', 'Elephant.jpg');
    expect(wikimedia.files).toHaveBeenCalledWith(['Elephant.jpg'], 2560);
    expect(wikimedia.download).toHaveBeenCalledWith(RENDITION);
  });

  it('downloads nothing from an address outside Commons, whatever the API said', async () => {
    const { service, wikimedia, ingest } = setUp({ url: 'https://10.0.0.1/internal', size: 1 });
    await expect(service.importImage('card-1', 'Elephant.jpg')).rejects.toThrow(
      'unexpected address',
    );
    expect(wikimedia.download).not.toHaveBeenCalled();
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it('fails the job when the file is gone, so that it is tried again and then given up', async () => {
    const { service } = setUp(null);
    await expect(service.importImage('card-1', 'Elephant.jpg')).rejects.toThrow('no longer');
  });
});
