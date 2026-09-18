import { existsSync } from 'node:fs';

// Imported first by both entry points. In Docker the variables come from Compose and no file
// exists; on the host this picks up the repository's .env. Existing variables always win.
for (const file of ['.env', '../../.env']) {
  if (existsSync(file)) process.loadEnvFile(file);
}
