import { z } from 'zod';

const DEV_MEDIA_SECRET = 'dev-only-media-secret-never-use-this-in-production';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    /** Comma-separated. Empty in production, where the web app and the API share an origin. */
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((csv) =>
        csv
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    /** Where originals, reveal renditions and crops live. A Docker volume in Compose. */
    MEDIA_DIR: z.string().min(1).default('../../data/media'),
    /** Key of the encrypted media URLs. */
    MEDIA_SECRET: z.string().min(32).default(DEV_MEDIA_SECRET),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.MEDIA_SECRET !== DEV_MEDIA_SECRET, {
    path: ['MEDIA_SECRET'],
    message: 'must be set to a private value in production',
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment:\n${problems.join('\n')}`);
}
