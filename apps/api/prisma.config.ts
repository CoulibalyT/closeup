import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// The CLI runs from apps/api; the shared .env lives at the repository root.
for (const file of ['.env', '../../.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // `prisma generate` must work without a database (CI, Docker build), hence the fallback.
    url: process.env.DATABASE_URL ?? 'postgresql://closeup:closeup@localhost:5432/closeup',
  },
});
