// Upstash Redis-backed storage. Keys:
//   whoop:tokens            — OAuth tokens (refresh token rotates)
//   whoop:cycles            — { [cycle_id]: record }
//   whoop:recoveries        — { [cycle_id]: record }
//   whoop:sleeps            — { [sleep_id]: record }
//   whoop:workouts          — { [workout_id]: record }
//   whoop:sync-state        — last successful sync info
//   whoop:dashboard         — computed dashboard JSON (served by /api/whoop)
//
// Redis.fromEnv() reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN,
// which Vercel auto-populates when you install the Upstash integration.

import { Redis } from '@upstash/redis';

export const redis = Redis.fromEnv();

export function kvStore(key) {
  return {
    async get()  { return await redis.get(key); },
    async set(v) { return await redis.set(key, v); },
  };
}

export class KvRecordStore {
  constructor(key) {
    this.key = key;
    this._cache = null;
  }
  async _load() {
    if (this._cache) return this._cache;
    this._cache = (await redis.get(this.key)) || {};
    return this._cache;
  }
  async upsertMany(records, idKey = 'id') {
    const cache = await this._load();
    let added = 0, updated = 0;
    for (const r of records) {
      const id = r[idKey];
      if (id == null) continue;
      if (cache[id]) updated++;
      else added++;
      cache[id] = r;
    }
    await redis.set(this.key, cache);
    return { added, updated, total: Object.keys(cache).length };
  }
  async all() {
    const cache = await this._load();
    return Object.values(cache);
  }
}
