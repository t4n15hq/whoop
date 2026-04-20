// Public endpoint — serves the precomputed dashboard JSON from KV.
// No auth: this is the "public quantified-self flex" endpoint.
//
// Freshness model:
//   - GitHub Actions hits /api/cron every 15 minutes (see .github/workflows/sync.yml).
//   - If the cron hasn't landed recently, this route auto-syncs on read when
//     the payload is older than STALE_MINUTES.
//   - Edge cache is kept small so page loads see fresh data.

import { redis } from '@/lib/store.mjs';

const STALE_MINUTES = 15;

export const revalidate = 60;

export async function GET(request) {
  let data = await redis.get('whoop:dashboard');

  if (data?.generated_at) {
    const ageMinutes = (Date.now() - new Date(data.generated_at).getTime()) / 60000;

    if (ageMinutes > STALE_MINUTES) {
      try {
        const host = request.headers.get('host');
        const protocol = request.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
        const url = `${protocol}://${host}/api/cron`;

        await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET || ''}` },
        });

        data = await redis.get('whoop:dashboard');
      } catch (e) {
        console.error('Auto-sync failed:', e);
      }
    }
  }

  if (!data) {
    return Response.json(
      { error: 'no data yet — cron has not run, or tokens not bootstrapped' },
      { status: 503 }
    );
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
