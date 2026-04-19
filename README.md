# whoop-dash

Personal quantified-self dashboard powered by WHOOP. Dark terminal aesthetic, 14 analytics sections, auto-refreshes every 6 hours.

## What's Tracked

### Daily Snapshot
- **Recovery score** — with percentile rank vs last 90 days
- **Day strain** (0–21 scale) — with percentile + week-over-week delta
- **HRV** (ms) — compared against your 60-day rolling baseline
- **Sleep duration** — hours asleep with performance percentage

### Readiness Score
Composite 0–100 score combining:
| Factor | Weight |
|---|---|
| Recovery score | 35% |
| HRV vs 60d baseline | 25% |
| Sleep performance | 25% |
| Sleep debt penalty | 15% |

Bands: **OPTIMAL** (70+) · **MODERATE** (40–69) · **LOW** (<40)

### Training Load (ACWR)
Acute:Chronic Workload Ratio — 7-day avg strain / 28-day avg strain.

| ACWR | Zone | Meaning |
|---|---|---|
| < 0.8 | Detraining | Not enough stimulus |
| 0.8 – 1.3 | Optimal | Sweet spot for adaptation |
| 1.3 – 1.5 | Overreaching | High risk, taper soon |
| > 1.5 | Danger | Injury risk elevated |

### Vitals
- **Resting heart rate** — today + 30d avg + week delta
- **SpO₂** — with 30d avg/stddev, flags deviations > 1σ from baseline
- **Skin temperature** — with 30d trend + deviation alerting
- **Respiratory rate**

### Sleep Analytics
- **Stage composition** — light / deep / REM / awake (hours + percentages)
- **30d stage distribution** — stacked area chart showing architecture trends
- **Sleep debt trend** — 14-day slope: ACCUMULATING / STABLE / RECOVERING
- **Bedtime consistency** — stddev of bedtime, rated EXCELLENT → INCONSISTENT
- **Sleep efficiency** — time asleep / time in bed
- **Nap tracking**

### Recovery
- **Band distribution** — % of days in GREEN / YELLOW / RED over 30 days
- **HRV baseline** — 60d rolling mean vs current 7d mean
- **Streak tracking** — current green streak, longest green streak (90d), days above red
- **Best/worst days** — with dates
- **Recovery calendar** — 90-day heatmap color-coded by recovery band

### Strain & Energy
- **Strain profile** — avg, median, max strain over 30d
- **Calorie expenditure** — total + daily average
- **Strain buckets** — light / moderate / strenuous / all-out distribution
- **Strain × Recovery scatter** — identifies resilient days vs digging into reserves

### Day-of-Week Patterns
Avg recovery, strain, sleep, and HRV broken down by weekday over 90 days. Reveals patterns like worst recovery on Mondays or heaviest training on Wednesdays.

### Workouts
- **HR zone minutes** — z0–z5 breakdown with percentages (30d)
- **Sport breakdown** — count, duration, calories, avg HR per activity type
- **Biggest workout** — highest strain session in 30 days

### Personal Records
All-time and 30-day bests for:
- Highest HRV · Lowest RHR · Best recovery · Max strain · Most sleep

### Correlations
Pearson r correlations showing what actually drives your recovery:
- Sleep performance % → recovery
- Hours asleep → recovery
- Deep sleep hours → recovery
- REM sleep hours → recovery
- HRV (same day) → recovery
- Yesterday's strain → recovery

Values |r| > 0.3 suggest meaningful relationships.

## How Factors Affect Each Other

```
                    ┌─────────────────┐
                    │   READINESS     │
                    │  (composite)    │
                    └───────┬─────────┘
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
      ┌───────────┐  ┌───────────┐   ┌───────────┐
      │ RECOVERY  │  │   SLEEP   │   │    HRV    │
      │  score    │  │   perf    │   │ vs baseline│
      └─────┬─────┘  └─────┬─────┘   └─────┬─────┘
            │               │               │
    ┌───────┴───────┐       │        ┌──────┴──────┐
    │ prev-day      │       │        │ autonomic   │
    │ strain        │       │        │ recovery    │
    │ (lagged)      │       │        │ (resting HR,│
    └───────────────┘       │        │  SpO₂)      │
                            │        └─────────────┘
                     ┌──────┴──────┐
                     │ bedtime     │
                     │ consistency │
                     │ sleep debt  │
                     │ deep/REM %  │
                     └─────────────┘
```

**Key relationships the dashboard tracks:**
- Higher sleep performance → higher next-day recovery
- More deep + REM sleep → better recovery scores
- Higher previous-day strain → can lower next-day recovery
- Consistent bedtime → better sleep efficiency
- HRV trending above baseline → body is adapting well
- ACWR in 0.8–1.3 → optimal training stimulus without overreaching
