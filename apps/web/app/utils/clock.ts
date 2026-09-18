import {
  ackSchema,
  ClientEvent,
  type ClockSample,
  estimateClockOffset,
  sampleFromPing,
  TIME_SYNC,
  timePongSchema,
} from '@closeup/shared';
import type { Socket } from 'socket.io-client';

const pongAck = ackSchema(timePongSchema);

/** A few round trips; the fastest ones give the offset to add to Date.now() for server time. */
export async function measureClock(socket: Socket): Promise<ClockSample | null> {
  const samples: ClockSample[] = [];
  for (let i = 0; i < TIME_SYNC.samples; i++) {
    const t0 = Date.now();
    const ack = pongAck.parse(
      await socket.timeout(2_000).emitWithAck(ClientEvent.timePing, { t0 }),
    );
    if (ack.ok) samples.push(sampleFromPing({ t0, t1: ack.data.t1, t2: Date.now() }));
  }
  return estimateClockOffset(samples);
}
