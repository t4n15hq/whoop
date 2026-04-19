// Public endpoint — serves the precomputed dashboard JSON from KV.
// No auth: this is the "public quantified-self flex" endpoint.
// Cached at the edge for 5 minutes; stale-while-revalidate for faster perceived
// loads even after the cache expires.

import { redis } from '@/lib/store.mjs';

export const revalidate = 300;

export async function GET(request) {
  let data = await redis.get('whoop:dashboard');

  // Auto-sync if data is older than 60 minutes
  if (data?.generated_at) {
    const ageMinutes = (Date.now() - new Date(data.generated_at).getTime()) / 60000;

    if (ageMinutes > 60) {
      try {
        const host = request.headers.get('host');
        const protocol = request.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
        const url = `${protocol}://${host}/api/cron`;

        // Wait for the sync to complete (~1-3 seconds for incremental sync)
        await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET || ''}` }
        });

        // Refetch the freshly generated data
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
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
    },
  });
}
