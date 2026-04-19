// Vercel Cron hits this every 6 hours (see vercel.json).
// Vercel automatically sends a request with header:
//   Authorization: Bearer <CRON_SECRET>
// where CRON_SECRET is an env var Vercel generates — we verify it below.

import { WhoopClient } from '@/lib/whoop-client.mjs';
import { kvStore, KvRecordStore, redis } from '@/lib/store.mjs';
import { compute } from '@/lib/analytics.mjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // seconds — initial backfill can take ~30s

const OVERLAP_DAYS = 7;
const INITIAL_DAYS = 365;

async function notify(text) {
  const webhook = process.env.WHOOP_DISCORD_WEBHOOK;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
  } catch {}
}

export async function GET(request) {
  // Verify request came from Vercel Cron (or manual trigger with the secret)
  const auth = request.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const started = Date.now();
  try {
    // First-run bootstrap: if KV has no tokens but the env has a seed refresh
    // token, write it into KV so the client can use it.
    const existingTokens = await redis.get('whoop:tokens');
    const seedToken = process.env.WHOOP_INITIAL_REFRESH_TOKEN;
    if (!existingTokens && seedToken) {
      await redis.set('whoop:tokens', {
        access_token: null,
        refresh_token: seedToken,
        expires_at: 0,
        scope: null,
      });
    }

    const client = new WhoopClient({
      clientId: process.env.WHOOP_CLIENT_ID,
      clientSecret: process.env.WHOOP_CLIENT_SECRET,
      tokenStore: kvStore('whoop:tokens'),
    });

    const syncState = (await redis.get('whoop:sync-state')) || {};
    const isFirstRun = !syncState.last_success_at;
    const windowStart = isFirstRun
      ? new Date(Date.now() - INITIAL_DAYS * 24 * 3600 * 1000).toISOString()
      : new Date(Date.now() - OVERLAP_DAYS * 24 * 3600 * 1000).toISOString();

    const cyclesStore     = new KvRecordStore('whoop:cycles');
    const recoveriesStore = new KvRecordStore('whoop:recoveries');
    const sleepsStore     = new KvRecordStore('whoop:sleeps');
    const workoutsStore   = new KvRecordStore('whoop:workouts');

    const [profile, body] = await Promise.all([
      client.getProfile().catch(() => null),
      client.getBodyMeasurements().catch(() => null),
    ]);

    const newCycles     = await client.getCycles({ start: windowStart });
    const newRecoveries = await client.getRecoveries({ start: windowStart });
    const newSleeps     = await client.getSleeps({ start: windowStart });
    const newWorkouts   = await client.getWorkouts({ start: windowStart });

    const cR = await cyclesStore.upsertMany(newCycles, 'id');
    const rR = await recoveriesStore.upsertMany(newRecoveries, 'cycle_id');
    const sR = await sleepsStore.upsertMany(newSleeps, 'id');
    const wR = await workoutsStore.upsertMany(newWorkouts, 'id');

    const [allCycles, allRecoveries, allSleeps, allWorkouts] = await Promise.all([
      cyclesStore.all(), recoveriesStore.all(), sleepsStore.all(), workoutsStore.all(),
    ]);

    const dashboard = compute({
      profile, body,
      cycles: allCycles,
      recoveries: allRecoveries,
      sleeps: allSleeps,
      workouts: allWorkouts,
    });

    await redis.set('whoop:dashboard', dashboard);
    await redis.set('whoop:sync-state', {
      last_success_at: new Date().toISOString(),
      last_window_start: windowStart,
      counts: dashboard.counts,
    });

    const ms = Date.now() - started;
    const summary = {
      ok: true,
      duration_ms: ms,
      first_run: isFirstRun,
      window_start: windowStart,
      upserted: {
        cycles: cR, recoveries: rR, sleeps: sR, workouts: wR,
      },
      today: dashboard.today
        ? {
            recovery: dashboard.today.recovery_score,
            strain: dashboard.today.strain,
            hrv: dashboard.today.hrv_ms,
          }
        : null,
    };

    return Response.json(summary);
  } catch (err) {
    await notify(`\`whoop-dash\` cron failed: \`${err.message}\``);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
