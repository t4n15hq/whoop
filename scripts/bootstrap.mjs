#!/usr/bin/env node
// One-time OAuth bootstrap. Run locally with your WHOOP client credentials
// and the redirect URI you registered.
//
// Usage:
//   WHOOP_CLIENT_ID=xxx WHOOP_CLIENT_SECRET=yyy node scripts/bootstrap.mjs
//
// It spins up a local HTTP server on port 3000 to catch the OAuth redirect.
// Your WHOOP app's Redirect URI must be: http://localhost:3000/callback
//
// After success, it prints the tokens and also writes them to tokens.json.
// You then paste the refresh_token into Vercel as WHOOP_INITIAL_REFRESH_TOKEN.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { WhoopClient } from '../lib/whoop-client.mjs';

const CLIENT_ID = process.env.WHOOP_CLIENT_ID;
const CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET;
const REDIRECT_URI = process.env.WHOOP_REDIRECT_URI || 'http://localhost:3000/callback';
const PORT = 3000;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET env vars.');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');

// Simple in-memory token store for the bootstrap run.
let tokens = null;
const memStore = {
  async get() { return tokens; },
  async set(v) { tokens = v; },
};

const client = new WhoopClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, tokenStore: memStore });
const authUrl = WhoopClient.authUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI, state });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end('Not found');
    return;
  }
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (returnedState !== state) {
    res.writeHead(400).end('State mismatch');
    return;
  }
  try {
    const exchanged = await client.exchangeCode(code, REDIRECT_URI);
    await fs.writeFile('tokens.json', JSON.stringify(exchanged, null, 2));
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(
      '<h1 style="font-family:monospace">WHOOP connected.</h1>' +
      '<p style="font-family:monospace">Tokens written to <code>tokens.json</code>. You can close this tab.</p>'
    );
    console.log('\n✓ SUCCESS\n');
    console.log('access_token:  ' + exchanged.access_token.slice(0, 20) + '...');
    console.log('refresh_token: ' + exchanged.refresh_token);
    console.log('expires_in:    ' + exchanged.expires_in + ' seconds');
    console.log('\nNext step: copy the refresh_token above and set it as an env var on Vercel:');
    console.log('  WHOOP_INITIAL_REFRESH_TOKEN=' + exchanged.refresh_token);
    console.log('\n(Or use `vercel env add WHOOP_INITIAL_REFRESH_TOKEN`)');
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    console.error(e);
    res.writeHead(500).end('Token exchange failed: ' + e.message);
  }
});

server.listen(PORT, () => {
  console.log('\n→ Open this URL in your browser to authorize:\n');
  console.log('  ' + authUrl + '\n');
  console.log('Waiting for callback on ' + REDIRECT_URI + ' ...');
});
