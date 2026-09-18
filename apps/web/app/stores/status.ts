import {
  ackSchema,
  ClientEvent,
  type ClockSample,
  estimateClockOffset,
  readinessSchema,
  sampleFromPing,
  TIME_SYNC,
  timePongSchema,
  workerHealthSchema,
} from '@closeup/shared';
import { defineStore } from 'pinia';
import type { Socket } from 'socket.io-client';

export type Light = 'unknown' | 'up' | 'down';

const pongAck = ackSchema(timePongSchema);

export const useStatusStore = defineStore('status', () => {
  const api = ref<Light>('unknown');
  const postgres = ref<Light>('unknown');
  const redis = ref<Light>('unknown');
  const worker = ref<Light>('unknown');
  const workerLatencyMs = ref<number | null>(null);
  const realtime = ref<Light>('unknown');
  const clock = ref<ClockSample | null>(null);

  const { apiBase } = useRuntimeConfig().public;

  /** fetch(), not $fetch(): a 503 still carries the body that says which dependency is down. */
  async function refreshServices(): Promise<void> {
    try {
      const response = await fetch(`${apiBase}/api/health/ready`);
      const body = readinessSchema.parse(await response.json());
      api.value = 'up';
      postgres.value = body.details.postgres?.status ?? 'unknown';
      redis.value = body.details.redis?.status ?? 'unknown';
    } catch {
      api.value = 'down';
      postgres.value = redis.value = 'unknown';
    }

    try {
      const response = await fetch(`${apiBase}/api/health/worker`);
      const body = workerHealthSchema.parse(await response.json());
      worker.value = body.status;
      workerLatencyMs.value = body.latencyMs ?? null;
    } catch {
      worker.value = api.value === 'up' ? 'down' : 'unknown';
      workerLatencyMs.value = null;
    }
  }

  async function syncClock(socket: Socket): Promise<void> {
    const samples: ClockSample[] = [];
    for (let i = 0; i < TIME_SYNC.samples; i++) {
      const t0 = Date.now();
      const ack = pongAck.parse(
        await socket.timeout(2_000).emitWithAck(ClientEvent.timePing, { t0 }),
      );
      if (ack.ok) samples.push(sampleFromPing({ t0, t1: ack.data.t1, t2: Date.now() }));
    }
    clock.value = estimateClockOffset(samples);
  }

  function watchRealtime(socket: Socket): void {
    const onConnect = () => {
      realtime.value = 'up';
      // Every (re)connection may be a different network path: measure again.
      void syncClock(socket).catch(() => {
        clock.value = null;
      });
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', () => {
      realtime.value = 'down';
    });
    socket.on('connect_error', () => {
      realtime.value = 'down';
    });
    if (socket.connected) onConnect();
  }

  return {
    api,
    postgres,
    redis,
    worker,
    workerLatencyMs,
    realtime,
    clock,
    refreshServices,
    watchRealtime,
  };
});
