// Public endpoint — serves the precomputed dashboard JSON from KV.
// No auth: this is the "public quantified-self flex" endpoint.
// Cached at the edge for 5 minutes; stale-while-revalidate for faster perceived
// loads even after the cache expires.

import { redis } from '@/lib/store.mjs';

export const revalidate = 300;

export async function GET() {
  const data = await redis.get('whoop:dashboard');
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
