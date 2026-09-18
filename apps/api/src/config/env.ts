import { z } from 'zod';

const envSchema = z.object({
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
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment:\n${problems.join('\n')}`);
}
