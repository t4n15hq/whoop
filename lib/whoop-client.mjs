// WHOOP v2 API client. OAuth refresh + pagination + rate-limit handling.
// Tokens are stored in Vercel KV and rotated on every refresh.

const BASE_URL = 'https://api.prod.whoop.com';
const TOKEN_URL = `${BASE_URL}/oauth/oauth2/token`;
const API_URL = `${BASE_URL}/developer`;

export const SCOPES = [
  'offline',
  'read:profile',
  'read:body_measurement',
  'read:cycles',
  'read:recovery',
  'read:sleep',
  'read:workout',
];

export class WhoopClient {
  constructor({ clientId, clientSecret, tokenStore }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tokenStore = tokenStore; // async { get(), set(tokens) }
    this._accessToken = null;
    this._expiresAt = 0;
  }

  static authUrl({ clientId, redirectUri, state }) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPES.join(' '),
      state,
    });
    return `${BASE_URL}/oauth/oauth2/auth?${params}`;
  }

  async exchangeCode(code, redirectUri) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
    const tokens = await res.json();
    await this._persist(tokens);
    return tokens;
  }

  async _refresh() {
    const stored = await this.tokenStore.get();
    if (!stored?.refresh_token) {
      throw new Error('No refresh token stored. Run the bootstrap script first.');
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: SCOPES.join(' '),
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
    const tokens = await res.json();
    await this._persist(tokens);
    return tokens;
  }

  async _persist(tokens) {
    // WHOOP rotates refresh tokens on every refresh — always save the new one.
    this._accessToken = tokens.access_token;
    this._expiresAt = Date.now() + tokens.expires_in * 1000 - 60_000;
    await this.tokenStore.set({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: this._expiresAt,
      scope: tokens.scope,
    });
  }

  async _token() {
    if (this._accessToken && Date.now() < this._expiresAt) return this._accessToken;
    const stored = await this.tokenStore.get();
    if (stored?.access_token && Date.now() < (stored.expires_at || 0) - 60_000) {
      this._accessToken = stored.access_token;
      this._expiresAt = stored.expires_at;
      return this._accessToken;
    }
    await this._refresh();
    return this._accessToken;
  }

  async _request(path, { query } = {}) {
    const token = await this._token();
    const url = new URL(API_URL + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') || '5');
      await new Promise((r) => setTimeout(r, retry * 1000));
      return this._request(path, { query });
    }
    if (res.status === 401 && this._accessToken) {
      this._accessToken = null;
      await this._refresh();
      return this._request(path, { query });
    }
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`WHOOP ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async _paginate(path, { start, end, pageLimit = 25, maxPages = 40 } = {}) {
    const all = [];
    let nextToken;
    for (let i = 0; i < maxPages; i++) {
      const data = await this._request(path, {
        query: { limit: pageLimit, start, end, nextToken },
      });
      if (data?.records?.length) all.push(...data.records);
      if (!data?.next_token) break;
      nextToken = data.next_token;
    }
    return all;
  }

  getProfile()          { return this._request('/v2/user/profile/basic'); }
  getBodyMeasurements() { return this._request('/v2/user/measurement/body'); }
  getCycles(opts = {})  { return this._paginate('/v2/cycle', opts); }
  getRecoveries(opts = {})  { return this._paginate('/v2/recovery', opts); }
  getSleeps(opts = {})      { return this._paginate('/v2/activity/sleep', opts); }
  getWorkouts(opts = {})    { return this._paginate('/v2/activity/workout', opts); }
}
