# whoop-dash

Public quantified-self dashboard powered by WHOOP. One Vercel deploy,
zero servers to maintain, auto-refreshes every 6 hours.

```
┌──────────┐      ┌──────────────┐      ┌─────────────┐      ┌───────────┐
│  WHOOP   │◄─────┤  /api/cron   │─────►│  Upstash    │◄─────┤  /api/    │
│   API    │      │  (6h cron)   │      │  Redis      │      │  whoop    │
└──────────┘      └──────────────┘      └─────────────┘      └─────┬─────┘
                                                                    │
                                                                    ▼
                                                            ┌──────────────┐
                                                            │  dashboard   │
                                                            │  (public)    │
                                                            └──────────────┘
```

## What's in the box

- **`app/page.js`** — public dashboard (React + Recharts, dark terminal aesthetic)
- **`app/privacy/page.js`** — privacy policy (required for WHOOP app registration)
- **`app/api/whoop/route.js`** — public endpoint, 5-min edge cache
- **`app/api/cron/route.js`** — runs every 6h (configured in `vercel.json`)
- **`lib/whoop-client.mjs`** — OAuth-refreshing WHOOP v2 client
- **`lib/analytics.mjs`** — rolling baselines, correlations, trends, distributions
- **`lib/store.mjs`** — Upstash Redis wrappers
- **`scripts/bootstrap.mjs`** — one-time local OAuth flow

## Deployment (10 minutes, end to end)

### 1. Create a WHOOP app

Go to https://developer-dashboard.whoop.com → **New App**.

- **Name**: anything (shown in OAuth consent)
- **Redirect URL**: `http://localhost:3000/callback`
- **Scopes**: check all six
- **Privacy Policy**: use `https://YOUR-VERCEL-URL.vercel.app/privacy`
  _(you don't have this URL yet — come back and fill it in after step 5)_
- **Webhooks**: leave empty

Click **Create App**. Copy the **Client ID** and **Client Secret**.

### 2. Bootstrap OAuth locally

```bash
git clone <this repo> whoop-dash
cd whoop-dash
npm install
WHOOP_CLIENT_ID=xxx WHOOP_CLIENT_SECRET=yyy npm run bootstrap
```

Your browser opens, you authorize, and the script prints a `refresh_token`.
**Copy it.** You'll paste it into Vercel in step 5.

### 3. Push to GitHub

```bash
git init
git add .
git commit -m "initial"
# create the repo on GitHub, then:
git remote add origin git@github.com:t4n15hq/whoop-dash.git
git push -u origin main
```

### 4. Import into Vercel

- Go to https://vercel.com/new → import your GitHub repo
- Framework preset: **Next.js** (auto-detected)
- Click **Deploy** (it'll fail the first build because env vars aren't set
  yet — that's fine)

### 5. Add Upstash Redis

In your Vercel project:

- **Storage** tab → **Create Database** → **Upstash Redis** (free tier)
- Give it a name, pick a region close to you
- Click **Connect Project** — this automatically adds
  `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to your env vars

### 6. Set remaining env vars

In your Vercel project → **Settings** → **Environment Variables**, add:

| Name | Value |
|---|---|
| `WHOOP_CLIENT_ID` | from WHOOP developer dashboard |
| `WHOOP_CLIENT_SECRET` | from WHOOP developer dashboard |
| `WHOOP_INITIAL_REFRESH_TOKEN` | from step 2's bootstrap output |
| `WHOOP_DISCORD_WEBHOOK` | optional — for failure alerts |

Vercel auto-generates `CRON_SECRET` when you first deploy a cron job — you
don't need to set that one.

### 7. Redeploy

- **Deployments** tab → click the three-dot menu on the latest deployment
  → **Redeploy**

### 8. Trigger the first cron manually

Your first cron won't run until its scheduled slot (00:07, 06:07, 12:07, or
18:07 UTC). To populate data immediately:

```bash
# Grab CRON_SECRET from: Project Settings → Environment Variables
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://YOUR-URL.vercel.app/api/cron
```

This runs the 365-day initial backfill (~30s), then subsequent crons are fast
7-day incremental syncs.

### 9. Go back to WHOOP and update the Privacy URL

Now you have your Vercel URL. Go back to your WHOOP app settings and set the
Privacy Policy URL to `https://YOUR-URL.vercel.app/privacy`.

### Done

Visit `https://YOUR-URL.vercel.app/` — that's your public dashboard.

## Local development

```bash
# Create .env.local with:
#   WHOOP_CLIENT_ID=...
#   WHOOP_CLIENT_SECRET=...
#   UPSTASH_REDIS_REST_URL=...      (pull from Vercel dashboard)
#   UPSTASH_REDIS_REST_TOKEN=...

npm run dev   # http://localhost:3000
```

## Free-tier limits

- **Vercel Hobby**: unlimited deploys, serverless functions, cron jobs
- **Upstash Redis (free)**: 10k requests/day, 256 MB storage. This dashboard
  uses ~30 requests per 6h cron = ~120/day, well inside the limit. Dashboard
  payload is 50–200KB depending on history.

## Troubleshooting

**`/api/whoop` returns 503 "no data yet"** — the cron hasn't run. Trigger it
manually (step 8 above).

**`/api/cron` returns 500 with "No refresh token stored"** — you didn't set
`WHOOP_INITIAL_REFRESH_TOKEN`, or the bootstrap script produced an invalid
one. Re-run step 2 and make sure you copy the full value.

**Dashboard shows empty charts** — cron ran but WHOOP returned no data for
your account. Verify with:
```bash
curl https://YOUR-URL.vercel.app/api/whoop | jq '.counts'
```
Should show non-zero cycles/sleeps/workouts.

**Cron isn't running on schedule** — only runs on production deployments.
Check Vercel dashboard → your project → **Cron Jobs** tab for execution logs.

## Privacy note

The dashboard is public — anyone with the URL sees your stats. But raw
WHOOP API data and OAuth tokens never leave the server side. The JSON served
at `/api/whoop` is only computed metrics (recovery score, strain, sleep
hours, HRV trends, etc.).
