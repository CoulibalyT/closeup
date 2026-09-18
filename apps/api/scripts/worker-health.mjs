// Docker health check for the worker, which has no HTTP port: is its Redis heartbeat fresh?
import { Redis } from 'ioredis';

const MAX_AGE_MS = 30_000;
const redis = new Redis(process.env.REDIS_URL, {
  lazyConnect: true,
  connectTimeout: 2_000,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});
redis.on('error', () => {});

try {
  await redis.connect();
  const beat = Number(await redis.get('closeup:worker:heartbeat'));
  process.exitCode = beat && Date.now() - beat < MAX_AGE_MS ? 0 : 1;
} catch {
  process.exitCode = 1;
} finally {
  redis.disconnect();
}
