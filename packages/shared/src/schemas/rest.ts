import { z } from 'zod';

const dependencySchema = z.looseObject({ status: z.enum(['up', 'down']) });

/** `GET /api/health/ready` — same body on 200 and 503. */
export const readinessSchema = z.object({
  status: z.enum(['ok', 'error', 'shutting_down']),
  details: z.record(z.string(), dependencySchema),
});
export type Readiness = z.infer<typeof readinessSchema>;

/** `GET /api/health/worker` — a `ping` job went through the queue and back. */
export const workerHealthSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().optional(),
  message: z.string().optional(),
});
export type WorkerHealth = z.infer<typeof workerHealthSchema>;
