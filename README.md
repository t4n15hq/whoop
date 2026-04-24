# whoop-dash

A personal WHOOP analytics dashboard that goes beyond raw numbers. Fifteen visual sections of telemetry on top of an auto-analysis engine that reads your own data, personalizes thresholds to you, forecasts tomorrow's recovery, and surfaces concrete recommendations — all in a dense terminal aesthetic.

**Live:** [whoop-tanishq.vercel.app](https://whoop-tanishq.vercel.app)

```
─────────────────────────────────────────────────────────────
  WHOOP · quantified self                      last sync 3m ago
─────────────────────────────────────────────────────────────

  01 TODAY ────────────────────────────── Monday, April 21
  RECOVERY         DAY STRAIN         HRV            SLEEP
  74%              13.2               48ms           7.4h
  GREEN  ▲ 8%      ▲ 4%  P64          baseline 45ms  perf 91%

  02 SIGNALS ──────────────────────── 2 watch · 4 positive
  ▌VITALS    Skin temp deviating — possible early illness signal.
             → cut training intensity 30–50% until it clarifies.
  ▌HRV       HRV +7% above baseline (z=+1.3σ) — strong adaptation.
  ▌FORECAST  Tomorrow projected ~71% (GREEN) from your 89-day history.
             → adding 1h sleep → +2.8pt recovery · biggest lever.
  ▌DRIVER    sleep duration is the strongest lift (r=0.69).
             → extend sleep by 30–45 min.
  ▌PATTERN   Sats peak recovery (78%) · Weds lowest (58%) — 20pt spread.
             → plan high-intensity on Sats, recovery/zone-2 on Weds.
  ...
```

---

## What makes it different

Most WHOOP dashboards show you today's recovery and a few charts. This one also **interprets** the data:

- **Auto-analysis.** A Signals engine reads your data on every sync and emits prioritized observations — "recovery running cold (z=-2σ)", "sleep debt accumulating +0.8h/week", "running sessions drop next-day recovery 5pt more than lifting", "deload week warranted", etc.
- **Personalized thresholds.** Not "5% HRV drop is bad." Instead: z-scored against your own 60-day distribution. A 10% dip is noise for someone volatile and a clear signal for someone stable.
- **Predictive.** A 3-predictor OLS regression fits `recovery ~ sleep_perf + sleep_hours + prev_day_strain` on your history, forecasts tomorrow's band, and names the single biggest lever you control.
- **Consensus alerts.** ≥2 of 3 pre-illness markers (skin temp, SpO₂, respiratory rate) collapse into a single high-priority warning. Deload warrants require both high ACWR *and* falling recovery — either alone is ambiguous.
- **Actionable.** Every warning carries a concrete recommendation: "cap strain <10 for 3 days", "lock a 30-min bedtime window for 2 weeks", "shift intensity to zone-2".
- **Zero AI/LLM.** All analysis is deterministic math — OLS regression, Pearson correlation, z-scores, autocorrelation, linear slopes. Your WHOOP data is the only API involved.

---

## The 15 visual sections

| # | Section | What it shows |
|---|---|---|
| 01 | **Today** | Recovery / Strain / HRV / Sleep as 4 large cells, each with week-delta + percentile |
| 02 | **Signals** | Auto-generated read-out (the engine below) |
| 03 | **Readiness** | Composite 0–100 score (35% recovery, 25% HRV vs baseline, 25% sleep perf, 15% sleep debt) + ACWR training-load zone |
| 04 | **Vitals** | Resting HR, SpO₂, skin temp — each with 30d mean/stddev and >1σ deviation flag |
| 05 | **Recovery × Strain · 180d** | Composed chart: recovery band overlaid with strain |
| 06 | **Autonomic & Sleep trendlines** | HRV/RHR timeseries with 7d rolling avg; sleep hours vs 8h target |
| 07 | **Training Load · ACWR** | Acute:Chronic Workload Ratio area chart with zones |
| 08 | **Sleep** | Last-night stage composition + 30d profile + sleep debt trajectory sparkline |
| 09 | **Recovery distribution · 30d** | GREEN/YELLOW/RED band share + current/longest streak + best/worst days |
| 10 | **Recovery calendar · 90d** | GitHub-style heatmap, hover for details |
| 11 | **Strain & Energy · 30d** | Profile, bucket distribution, strain×recovery scatter |
| 12 | **Day-of-Week Patterns · 90d** | Three weekday heatmaps (recovery, strain, sleep) + table |
| 13 | **Workouts · 30d** | HR-zone breakdown, sport table, biggest workout |
| 14 | **Personal Records** | All-time and 30-day bests with dates |
| 15 | **Correlations** | Pearson r bars: what actually drives your next-day recovery |

---

## The Signals engine

Each observation is a row with a colored edge indicator, a category tag, a one-line observation, optional supporting detail, and an optional concrete action. Sorted so alerts rise to the top.

### Alerts (red edge)

| Category | Trigger |
|---|---|
| `ILLNESS` | ≥2 of 3 pre-illness markers elevated (skin temp / SpO₂ / respiratory rate). Single composite warning replaces individual marker alerts. |
| `DELOAD` | ≥50% of 14-day window at ACWR > 1.3 **and** recovery slope < -0.3pt/day. Both signals must agree. |
| `LOAD` (danger) | ACWR > 1.5 — high injury/illness risk. |
| `VITALS` | Single-marker illness signal when composite doesn't fire. |

### Warnings (yellow edge)

| Category | Trigger |
|---|---|
| `RECOVERY` | 7d recovery mean < -1σ vs 60d baseline (z-score), or 30d red-band share ≥ 30%. |
| `HRV` | 7d HRV mean < -1σ vs 60d baseline. |
| `SLEEP` | Debt accumulating (+slope over 14 days), <6.5h avg in last 7d, or bedtime INCONSISTENT (σ > 1.5h). |
| `BEDTIME` | Drifting later > 3 min/day over 30 nights. |
| `LOAD` | ACWR < 0.8 (detraining) or 1.3–1.5 (overreaching). |
| `RESILIENCE` | ≥40% of high-strain days follow into red recovery. |
| `SPORT` | A sport drops next-day recovery ≥3pt below your baseline (n ≥ 5). |

### Positives (green edge)

`RECOVERY` running hot · `HRV` above baseline · `STREAK` current green run · `MILESTONE` new 30d PR this week · `LOAD` optimal · `SLEEP` 8h+ avg · `BEDTIME` rock-solid · `RESILIENCE` high-strain days held well · `SPORT` this activity treats you well.

### Informational (accent edge)

| Category | Trigger |
|---|---|
| `FORECAST` | OLS regression predicts tomorrow's recovery (requires ≥20 paired days). |
| `DRIVER` | Strongest correlation with next-day recovery, \|r\| ≥ 0.3 (same-day HRV excluded as tautological). |
| `PATTERN` | Day-of-week spread ≥ 12pt between best and worst weekday. |
| `RHYTHM` | Autocorrelation at lag 7 or 28 ≥ 0.3 — weekly or monthly pattern detected. |

---

## Analytics primitives

All compute lives in `lib/analytics.mjs`. Stats functions used throughout:

| Primitive | Used for |
|---|---|
| `mean`, `median`, `stddev` | Rolling windows, baselines, deviation flagging |
| `linearSlope` | Sleep debt trajectory, bedtime drift, recovery trend |
| `pearson` | Correlation analysis (what drives recovery) |
| `percentileRank` | "You're in the top X% of your own last 90 days" |
| `autocorr` | Weekly/monthly rhythm detection |
| `mlRegress` / `invertMatrix` | 3-predictor OLS for recovery forecast (Gauss-Jordan inverse) |
| Z-scores (cur − base) / (σ / √n) | Personalized thresholds on HRV and recovery vs 60d distribution |
| Proportion tests | Deload detector (highLoadPct ≥ 50%) |

No ML frameworks, no LLM calls, no external analytics services. One runtime dependency for the data pipeline: `@upstash/redis`.

---

## Data flow

```
┌──────────────┐     every 15 min      ┌──────────────┐
│   WHOOP v2   │ ◄─── OAuth refresh ── │ GitHub Action│
│   OAuth API  │                        │  (cron)      │
└──────┬───────┘                        └──────┬───────┘
       │  profile, body, cycles,               │  POST /api/cron
       │  recoveries, sleeps, workouts         ▼
       │                              ┌──────────────────┐
       └────────────────────────────► │  analytics.mjs   │
                                      │  compute()       │
                                      │                  │
                                      │  → today         │
                                      │  → trends        │
                                      │  → readiness     │
                                      │  → forecast      │
                                      │  → insights ...  │
                                      └────────┬─────────┘
                                               │ whoop:dashboard
                                               ▼
                                      ┌──────────────────┐
                                      │ Upstash Redis KV │
                                      └────────┬─────────┘
                                               │
                           auto-sync if > 15m  │
                                   stale       ▼
                                      ┌──────────────────┐
                                      │ GET /api/whoop   │
                                      │ (Next.js route)  │
                                      └────────┬─────────┘
                                               │
                                               ▼
                                      ┌──────────────────┐
                                      │ Dashboard.jsx    │
                                      │ (client render)  │
                                      └──────────────────┘
```

- **Cron:** `.github/workflows/cron.yml` hits `/api/cron` every 15 minutes with a shared secret.
- **Sync:** The cron route pulls fresh WHOOP records, runs `compute()`, and writes the full payload to Redis under one key.
- **Serve:** `/api/whoop` returns the cached JSON. If the payload is > 15 minutes old, it triggers a sync on read.
- **Render:** The dashboard fetches on mount and polls every 5 minutes.

---

## Architecture

```
whoop-dash/
├── app/
│   ├── layout.js                    # root layout, JetBrains Mono, dark
│   ├── page.js                      # dashboard entry (force-dynamic)
│   ├── globals.css                  # design system — CSS variables, hairlines
│   ├── privacy/page.js              # privacy policy
│   └── api/
│       ├── cron/route.js            # scheduled sync trigger
│       └── whoop/route.js           # public JSON endpoint
├── components/
│   ├── Dashboard.jsx                # main render (all 15 sections)
│   ├── ui.jsx                       # primitives: SectionHead, Panel, KV, Bar, Delta, fmt
│   └── charts.jsx                   # 9 Recharts visualizations
├── lib/
│   ├── analytics.mjs                # compute() + all the stats (the core)
│   ├── whoop-client.mjs             # WHOOP OAuth2 client
│   └── store.mjs                    # Upstash Redis token storage
└── scripts/
    └── bootstrap.mjs                # one-time OAuth token exchange
```

---

## Tech stack

- **Next.js 15** (App Router, force-dynamic routes)
- **React 18** (client-side dashboard)
- **Recharts 2.13** for all timeseries and scatter visualizations
- **Upstash Redis** for token + payload storage (serverless-friendly)
- **GitHub Actions** for the 15-minute cron
- **Vercel** for hosting
- **WHOOP v2 API** via OAuth2
- No ML dependencies, no LLM calls

Runtime: pure JavaScript, no TypeScript. Analytics module is `.mjs` for clean Node import in both the cron job and tests.

---

## Setup

### Prerequisites

- A WHOOP developer application (client ID + secret) at [developer.whoop.com](https://developer.whoop.com)
- An Upstash Redis database (free tier works)
- Vercel account (or any Next.js-compatible host)

### Environment variables

```bash
WHOOP_CLIENT_ID=...
WHOOP_CLIENT_SECRET=...
WHOOP_REDIRECT_URI=https://your-domain/api/callback
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
CRON_SECRET=any-long-random-string        # shared with GitHub Action
```

### One-time bootstrap

```bash
npm install
node scripts/bootstrap.mjs   # runs OAuth flow, writes tokens to Redis
```

### Deploy

```bash
# local
npm run dev

# production
npm run build && npm start
# or: vercel deploy
```

The GitHub Action at `.github/workflows/cron.yml` needs `CRON_SECRET` set as a repo secret. It calls `/api/cron` every 15 minutes.

---

## Design philosophy

Dense terminal aesthetic — JetBrains Mono throughout, hairline borders, no rounded corners, no gradients, numeric data as the visual hero. CSS variables only (`--green`, `--yellow`, `--red`, `--accent`, `--strain`, `--sleep`, `--hrv`). Responsive at 960px (grid collapse) and 560px (hero stack).

Every labeled metric uses `font-variant-numeric: tabular-nums` so digits align vertically across cells. The acid yellow-green accent (`#d4ff4a`) is reserved for data highlights and the `→` prefix on actionable recommendations.

---

## What's computed on every sync

A partial inventory of the payload stored in Redis on each cron tick:

```
today              — latest cycle snapshot (recovery, strain, HRV, RHR, SpO₂, skin temp)
trends             — 7/14/30/90 day windows + week-over-week deltas
readiness          — composite 0–100 score with 4 components
recovery           — 30d averages, HRV baseline, z-scores, band distribution
sleep              — 30d profile, bedtime consistency, stage distribution
strain             — bucket distribution, calorie totals
workout            — HR-zone minutes, sport breakdown, biggest workout
correlations       — 5 Pearson r values for recovery drivers
timeseries         — 180-day chart series with rolling 7d averages
streaks            — current/longest green runs
day_of_week        — averages by weekday
sleep_debt_trend   — 14d slope and direction
training_load      — ACWR + 90d series
personal_records   — all-time + 30d bests
vital_trends       — spo2/skin_temp/respiratory_rate with flags
percentiles        — where today sits vs last 90 days
sport_impact       — per-sport next-day recovery deltas
forecast           — OLS regression + prediction + coefficients
bedtime_drift      — linear slope on 30 nights of bedtimes
periodicity        — autocorrelation at lags 7/14/28
deload_signal      — consensus check on load + recovery slope
insights           — the Signals read-out (sorted, actionable)
```

Compute is O(n) in history length and runs in a few hundred milliseconds on typical data (~180 cycles).

---

## Privacy

All data stays between WHOOP, your Upstash Redis instance, and your browser. No third-party analytics, tracking, or LLM services. The dashboard is keyed to a single user's OAuth tokens — see `/privacy` on the deployed site.

---

## License

Personal use. Not affiliated with or endorsed by WHOOP. WHOOP® is a trademark of WHOOP, Inc.
