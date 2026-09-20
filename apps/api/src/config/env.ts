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
    /**
     * Behind a reverse proxy: trust `X-Forwarded-For` so that the per-IP limits count the
     * visitor, not Caddy. Never set it when the API is reachable directly — a header anybody
     * can write would then decide who is rate limited.
     */
    TRUST_PROXY: z
      .string()
      .default('')
      .transform((value) => value === '1' || value.toLowerCase() === 'true'),
    /** e.g. smtp://user:password@mail.example.org:587. Empty: no e-mail leaves (see MailService). */
    SMTP_URL: z.string().default(''),
    MAIL_FROM: z.string().min(3).default('closeup <no-reply@localhost>'),
    /** Where the web app lives, for the links written in e-mails. No trailing slash. */
    PUBLIC_WEB_URL: z.url().default('http://localhost:3000'),
    /**
     * Namespace of the job queue in Redis. Two stacks on one Redis (the tests next to a running
     * Compose stack) must not take each other's image jobs.
     */
    QUEUE_PREFIX: z.string().min(1).default('bull'),
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
