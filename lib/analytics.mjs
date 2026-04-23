// Transforms raw WHOOP records into a rich, opinionated dashboard payload.
// Everything a dashboard or AI briefing could want is computed here once,
// so consumers just read a static JSON file.

const MS_PER_MIN = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---- helpers ----
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const stddev = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (n, d = 1) => (n == null ? null : Number(n.toFixed(d)));
const pctDelta = (cur, base) => (base ? round(((cur - base) / base) * 100, 1) : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const percentileRank = (value, sortedArr) => {
  if (!sortedArr.length || value == null) return null;
  let count = 0;
  for (const v of sortedArr) if (v <= value) count++;
  return round((count / sortedArr.length) * 100, 0);
};
const linearSlope = (ys) => {
  if (ys.length < 2) return null;
  const n = ys.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxy += i * ys[i]; sxx += i * i; }
  const den = n * sxx - sx * sx;
  return den ? round((n * sxy - sx * sy) / den, 4) : null;
};
// Gauss-Jordan matrix inverse with partial pivoting (small k only).
// Returns null on singular matrix.
const invertMatrix = (A) => {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (j === i ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let best = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[best][i])) best = k;
    }
    if (best !== i) [M[i], M[best]] = [M[best], M[i]];
    const pivot = M[i][i];
    if (Math.abs(pivot) < 1e-12) return null;
    for (let j = 0; j < 2 * n; j++) M[i][j] /= pivot;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = M[k][i];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[k][j] -= factor * M[i][j];
    }
  }
  return M.map((row) => row.slice(n));
};

// OLS multiple regression: β = (XᵀX)⁻¹ Xᵀy. Returns coefficient vector or null.
const mlRegress = (X, y) => {
  if (!X.length || X.length !== y.length) return null;
  const k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < k; j++) {
      Xty[j] += X[i][j] * y[i];
      for (let l = 0; l < k; l++) XtX[j][l] += X[i][j] * X[i][l];
    }
  }
  const inv = invertMatrix(XtX);
  if (!inv) return null;
  return inv.map((row) => row.reduce((s, v, i) => s + v * Xty[i], 0));
};

// Sample autocorrelation at a given lag. Returns null if insufficient data.
const autocorr = (xs, lag) => {
  const n = xs.length;
  if (n - lag < 10) return null;
  const m = mean(xs);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) den += (xs[i] - m) ** 2;
  for (let i = 0; i < n - lag; i++) num += (xs[i] - m) * (xs[i + lag] - m);
  return den > 0 ? round(num / den, 3) : null;
};

const pearson = (xs, ys) => {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den ? round(num / den, 3) : null;
};

const dayKey = (iso) => new Date(iso).toISOString().slice(0, 10);
const scored = (rec) => rec?.score_state === 'SCORED' && rec.score;

// ---- main compute ----
function compute({ profile, body, cycles, recoveries, sleeps, workouts }) {
  const now = new Date();
  const generatedAt = now.toISOString();

  const sortByStartDesc = (arr) => [...arr].sort((a, b) => new Date(b.start) - new Date(a.start));
  cycles = sortByStartDesc(cycles);
  recoveries = [...recoveries].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  sleeps = sortByStartDesc(sleeps);
  workouts = sortByStartDesc(workouts);

  // Index recoveries by cycle_id so each cycle can be joined with its recovery + sleep.
  const recoveryByCycle = new Map();
  for (const r of recoveries) recoveryByCycle.set(r.cycle_id, r);
  // sleeps are sorted newest-first; keep the first one we see per cycle so the
  // "main" sleep is always the most recent non-nap session tied to that cycle.
  const sleepByCycle = new Map();
  for (const s of sleeps) {
    if (s.nap) continue;
    if (!sleepByCycle.has(s.cycle_id)) sleepByCycle.set(s.cycle_id, s);
  }

  const today = buildToday({ cycles, recoveryByCycle, sleepByCycle, workouts });
  const trends = buildTrends({ cycles, recoveries, sleeps, recoveryByCycle, sleepByCycle });
  const sleep = buildSleepAnalytics(sleeps);
  const recovery = buildRecoveryAnalytics(recoveries);
  const strain = buildStrainAnalytics(cycles);
  const workout = buildWorkoutAnalytics(workouts);
  const correlations = buildCorrelations({ cycles, recoveryByCycle, sleepByCycle });
  const timeseries = buildTimeseries({ cycles, recoveryByCycle, sleepByCycle });
  const readiness = buildReadiness({ cycles, recoveryByCycle, sleepByCycle });
  const streaks = buildStreaks(recoveries);
  const dayOfWeek = buildDayOfWeek({ cycles, recoveryByCycle, sleepByCycle });
  const sleepDebtTrend = buildSleepDebtTrend(sleeps);
  const trainingLoad = buildTrainingLoad(cycles);
  const personalRecords = buildPersonalRecords({ cycles, recoveries, sleeps, recoveryByCycle, sleepByCycle });
  const vitalTrends = buildVitalTrends(recoveries);
  const percentiles = buildPercentiles({ cycles, recoveries, sleeps, recoveryByCycle, sleepByCycle, today });
  const sportImpact = buildSportImpact({ cycles, recoveryByCycle, workouts });
  const forecast = buildRecoveryForecast({ cycles, recoveryByCycle, sleepByCycle });
  const bedtimeDrift = buildBedtimeDrift(sleeps);
  const periodicity = buildPeriodicity(timeseries);
  const insights = buildInsights({
    today, trends, recovery, sleep, strain, workout: null,
    training_load: trainingLoad, sleep_debt_trend: sleepDebtTrend,
    correlations, streaks, day_of_week: dayOfWeek,
    vital_trends: vitalTrends, personal_records: personalRecords,
    timeseries,
    sport_impact: sportImpact, forecast, bedtime_drift: bedtimeDrift,
    periodicity,
  });

  return {
    generated_at: generatedAt,
    profile: profile ? {
      name: [profile.first_name, profile.last_name].filter(Boolean).join(' '),
      email: profile.email,
      user_id: profile.user_id,
    } : null,
    body: body ? {
      height_m: round(body.height_meter, 2),
      weight_kg: round(body.weight_kilogram, 1),
      weight_lb: round(body.weight_kilogram * 2.20462, 1),
      max_heart_rate: body.max_heart_rate,
    } : null,
    today,
    trends,
    sleep,
    recovery,
    strain,
    workout,
    correlations,
    timeseries,
    readiness,
    streaks,
    day_of_week: dayOfWeek,
    sleep_debt_trend: sleepDebtTrend,
    training_load: trainingLoad,
    personal_records: personalRecords,
    vital_trends: vitalTrends,
    percentiles,
    sport_impact: sportImpact,
    forecast,
    bedtime_drift: bedtimeDrift,
    periodicity,
    insights,
    counts: {
      cycles: cycles.length,
      recoveries: recoveries.length,
      sleeps: sleeps.length,
      workouts: workouts.length,
    },
  };
}

// ---- today: current snapshot ----
function buildToday({ cycles, recoveryByCycle, sleepByCycle, workouts }) {
  const latestCycle = cycles[0];
  if (!latestCycle) return null;
  const rec = recoveryByCycle.get(latestCycle.id);
  const slp = sleepByCycle.get(latestCycle.id);
  const cs = scored(latestCycle);
  const rs = scored(rec);
  const ss = scored(slp);

  // Workouts that fall inside the latest cycle window.
  const cycleStart = new Date(latestCycle.start);
  const cycleEnd = latestCycle.end ? new Date(latestCycle.end) : new Date();
  const todaysWorkouts = workouts
    .filter((w) => { const t = new Date(w.start); return t >= cycleStart && t <= cycleEnd; })
    .map(summarizeWorkout);

  return {
    cycle_id: latestCycle.id,
    cycle_start: latestCycle.start,
    cycle_end: latestCycle.end,
    cycle_in_progress: !latestCycle.end || latestCycle.score_state !== 'SCORED',
    cycle_score_state: latestCycle.score_state ?? null,
    recovery_score_state: rec?.score_state ?? null,
    sleep_score_state: slp?.score_state ?? null,
    strain: cs ? round(cs.strain, 1) : null,
    kilojoules: cs ? round(cs.kilojoule, 0) : null,
    calories: cs ? round(cs.kilojoule / 4.184, 0) : null,
    avg_hr: cs?.average_heart_rate != null ? Math.round(cs.average_heart_rate) : null,
    max_hr: cs?.max_heart_rate != null ? Math.round(cs.max_heart_rate) : null,
    recovery_score: rs?.recovery_score ?? null,
    recovery_band: rs ? recoveryBand(rs.recovery_score) : null,
    hrv_ms: rs ? round(rs.hrv_rmssd_milli, 1) : null,
    resting_hr: rs?.resting_heart_rate != null ? Math.round(rs.resting_heart_rate) : null,
    spo2_pct: rs ? round(rs.spo2_percentage, 1) : null,
    skin_temp_c: rs ? round(rs.skin_temp_celsius, 1) : null,
    sleep: ss ? summarizeSleep(slp) : null,
    workouts: todaysWorkouts,
  };
}

function recoveryBand(score) {
  if (score == null) return null;
  if (score >= 67) return 'GREEN';
  if (score >= 34) return 'YELLOW';
  return 'RED';
}

function summarizeSleep(s) {
  const sc = s.score;
  const stages = sc.stage_summary;
  const inBed = stages.total_in_bed_time_milli;
  const asleep = inBed - stages.total_awake_time_milli;
  return {
    id: s.id,
    start: s.start,
    end: s.end,
    performance_pct: sc.sleep_performance_percentage,
    consistency_pct: sc.sleep_consistency_percentage,
    efficiency_pct: round(sc.sleep_efficiency_percentage, 1),
    respiratory_rate: round(sc.respiratory_rate, 2),
    hours_in_bed: round(inBed / MS_PER_HOUR, 2),
    hours_asleep: round(asleep / MS_PER_HOUR, 2),
    hours_awake: round(stages.total_awake_time_milli / MS_PER_HOUR, 2),
    hours_light: round(stages.total_light_sleep_time_milli / MS_PER_HOUR, 2),
    hours_deep: round(stages.total_slow_wave_sleep_time_milli / MS_PER_HOUR, 2),
    hours_rem: round(stages.total_rem_sleep_time_milli / MS_PER_HOUR, 2),
    disturbances: stages.disturbance_count,
    sleep_cycles: stages.sleep_cycle_count,
    stage_pct: asleep > 0 ? {
      light: round((stages.total_light_sleep_time_milli / asleep) * 100, 1),
      deep: round((stages.total_slow_wave_sleep_time_milli / asleep) * 100, 1),
      rem: round((stages.total_rem_sleep_time_milli / asleep) * 100, 1),
    } : null,
    need_hours: round(sc.sleep_needed.baseline_milli / MS_PER_HOUR, 2),
    debt_hours: round(sc.sleep_needed.need_from_sleep_debt_milli / MS_PER_HOUR, 2),
  };
}

function summarizeWorkout(w) {
  const s = scored(w);
  if (!s) return { id: w.id, sport_name: w.sport_name, start: w.start, scored: false };
  const zones = s.zone_durations || {};
  const totalZoneMs = Object.values(zones).reduce((a, b) => a + (b || 0), 0);
  const durationMin = (new Date(w.end) - new Date(w.start)) / MS_PER_MIN;
  return {
    id: w.id,
    sport_name: w.sport_name,
    sport_id: w.sport_id,
    start: w.start,
    end: w.end,
    duration_min: round(durationMin, 1),
    strain: round(s.strain, 2),
    avg_hr: s.average_heart_rate,
    max_hr: s.max_heart_rate,
    calories: round(s.kilojoule / 4.184, 0),
    distance_m: round(s.distance_meter, 0),
    distance_km: s.distance_meter != null ? round(s.distance_meter / 1000, 2) : null,
    altitude_gain_m: round(s.altitude_gain_meter, 1),
    percent_recorded: round(s.percent_recorded, 1),
    zone_pct: totalZoneMs > 0 ? {
      z0: round((zones.zone_zero_milli / totalZoneMs) * 100, 1),
      z1: round((zones.zone_one_milli / totalZoneMs) * 100, 1),
      z2: round((zones.zone_two_milli / totalZoneMs) * 100, 1),
      z3: round((zones.zone_three_milli / totalZoneMs) * 100, 1),
      z4: round((zones.zone_four_milli / totalZoneMs) * 100, 1),
      z5: round((zones.zone_five_milli / totalZoneMs) * 100, 1),
    } : null,
    scored: true,
  };
}

// ---- trends: rolling windows and deltas ----
function buildTrends({ cycles, recoveries, sleeps, recoveryByCycle, sleepByCycle }) {
  const daily = [];
  for (const c of cycles) {
    const cs = scored(c);
    const rec = recoveryByCycle.get(c.id);
    const rs = scored(rec);
    const slp = sleepByCycle.get(c.id);
    const ss = scored(slp);
    daily.push({
      date: dayKey(c.start),
      strain: cs?.strain ?? null,
      recovery: rs?.recovery_score ?? null,
      hrv: rs?.hrv_rmssd_milli ?? null,
      rhr: rs?.resting_heart_rate ?? null,
      spo2: rs?.spo2_percentage ?? null,
      skin_temp: rs?.skin_temp_celsius ?? null,
      sleep_perf: ss?.sleep_performance_percentage ?? null,
      sleep_hours: ss ? (ss.stage_summary.total_in_bed_time_milli - ss.stage_summary.total_awake_time_milli) / MS_PER_HOUR : null,
      respiratory_rate: ss?.respiratory_rate ?? null,
    });
  }
  // Most recent first; window against the latest days.
  const windows = { last_7: 7, last_14: 14, last_30: 30, last_90: 90 };
  const out = { daily };
  for (const [label, n] of Object.entries(windows)) {
    const slice = daily.slice(0, n);
    out[label] = summarizeWindow(slice);
  }
  // Deltas: current week vs previous week, current month vs previous month.
  out.delta_week = deltaSummary(daily.slice(0, 7), daily.slice(7, 14));
  out.delta_month = deltaSummary(daily.slice(0, 30), daily.slice(30, 60));
  return out;
}

function summarizeWindow(slice) {
  const keys = ['strain', 'recovery', 'hrv', 'rhr', 'spo2', 'skin_temp', 'sleep_perf', 'sleep_hours', 'respiratory_rate'];
  const out = { n: slice.length };
  for (const k of keys) {
    const vals = slice.map((d) => d[k]).filter((v) => v != null);
    out[k] = { avg: round(mean(vals), 2), median: round(median(vals), 2), stddev: round(stddev(vals), 2), n: vals.length };
  }
  return out;
}

function deltaSummary(current, previous) {
  const keys = ['strain', 'recovery', 'hrv', 'rhr', 'sleep_perf', 'sleep_hours'];
  const out = {};
  for (const k of keys) {
    const c = mean(current.map((d) => d[k]).filter((v) => v != null));
    const p = mean(previous.map((d) => d[k]).filter((v) => v != null));
    out[k] = { current: round(c, 2), previous: round(p, 2), pct_change: pctDelta(c, p) };
  }
  return out;
}

// ---- sleep analytics ----
function buildSleepAnalytics(sleeps) {
  const scoredNights = sleeps.filter((s) => !s.nap && scored(s));
  const last30 = scoredNights.slice(0, 30);
  const naps = sleeps.filter((s) => s.nap && scored(s));

  // Bedtime / wake-time consistency over last 30 days.
  const bedtimes = last30.map((s) => timeOfDayHours(s.start));
  const waketimes = last30.map((s) => timeOfDayHours(s.end));

  const perfSeries = last30.map((s) => s.score.sleep_performance_percentage);
  const effSeries = last30.map((s) => s.score.sleep_efficiency_percentage);
  const debtSeries = last30.map((s) => s.score.sleep_needed.need_from_sleep_debt_milli / MS_PER_HOUR);

  const stages30 = last30.reduce((acc, s) => {
    const st = s.score.stage_summary;
    acc.light += st.total_light_sleep_time_milli;
    acc.deep += st.total_slow_wave_sleep_time_milli;
    acc.rem += st.total_rem_sleep_time_milli;
    acc.awake += st.total_awake_time_milli;
    acc.inBed += st.total_in_bed_time_milli;
    acc.disturbances += st.disturbance_count;
    acc.cycles += st.sleep_cycle_count;
    return acc;
  }, { light: 0, deep: 0, rem: 0, awake: 0, inBed: 0, disturbances: 0, cycles: 0 });
  const asleep30 = stages30.inBed - stages30.awake;

  return {
    last_30_nights: last30.length,
    avg_performance_pct: round(mean(perfSeries), 1),
    avg_efficiency_pct: round(mean(effSeries), 1),
    avg_debt_hours: round(mean(debtSeries), 2),
    bedtime: {
      mean_hour: round(mean(bedtimes), 2),
      stddev_hours: round(stddev(bedtimes), 2),
      consistency_rating: bedtimeRating(stddev(bedtimes)),
    },
    waketime: {
      mean_hour: round(mean(waketimes), 2),
      stddev_hours: round(stddev(waketimes), 2),
    },
    stage_distribution_30d: asleep30 > 0 ? {
      light_pct: round((stages30.light / asleep30) * 100, 1),
      deep_pct: round((stages30.deep / asleep30) * 100, 1),
      rem_pct: round((stages30.rem / asleep30) * 100, 1),
      avg_disturbances_per_night: round(stages30.disturbances / (last30.length || 1), 1),
      avg_cycles_per_night: round(stages30.cycles / (last30.length || 1), 1),
    } : null,
    naps: {
      last_30_days: naps.filter((n) => (Date.now() - new Date(n.start)) < 30 * 24 * MS_PER_HOUR).length,
      avg_duration_min: naps.length ? round(mean(naps.map((n) => (new Date(n.end) - new Date(n.start)) / MS_PER_MIN)), 1) : null,
    },
  };
}

function timeOfDayHours(iso) {
  const d = new Date(iso);
  // Normalize bedtimes to a continuous axis: shift 0–12 to 24–36 so midnight-ish groups cluster.
  let h = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (h < 12) h += 24;
  return h;
}

function bedtimeRating(sd) {
  if (sd == null) return null;
  if (sd < 0.5) return 'EXCELLENT';
  if (sd < 1.0) return 'GOOD';
  if (sd < 1.5) return 'FAIR';
  return 'INCONSISTENT';
}

// ---- recovery analytics ----
function buildRecoveryAnalytics(recoveries) {
  const scoredRecs = recoveries.filter(scored);
  const last30 = scoredRecs.slice(0, 30);
  const hrvSeries = last30.map((r) => r.score.hrv_rmssd_milli);
  const rhrSeries = last30.map((r) => r.score.resting_heart_rate);
  const scores = last30.map((r) => r.score.recovery_score);

  // Band distribution.
  const bands = { GREEN: 0, YELLOW: 0, RED: 0 };
  for (const r of last30) bands[recoveryBand(r.score.recovery_score)]++;

  // HRV baseline: 60-day rolling mean as "baseline", compare to last-7 mean for current state.
  const last60 = scoredRecs.slice(0, 60);
  const hrv60Series = last60.map((r) => r.score.hrv_rmssd_milli);
  const reco60Series = last60.map((r) => r.score.recovery_score);
  const hrvBaseline = mean(hrv60Series);
  const hrvSd60 = stddev(hrv60Series);
  const hrvCur7Series = scoredRecs.slice(0, 7).map((r) => r.score.hrv_rmssd_milli);
  const hrvCurrent = mean(hrvCur7Series);
  const reco60Mean = mean(reco60Series);
  const reco60Sd = stddev(reco60Series);
  const recoCur7Series = scoredRecs.slice(0, 7).map((r) => r.score.recovery_score);
  const recoCur7 = mean(recoCur7Series);

  // z-score of the 7d mean vs the 60d distribution (standard error of mean = sd/√n).
  // Gate on ≥14 days of history so stddev is stable; gate on ≥3 days in the current window.
  const zScore = (cur, base, sd, n) =>
    (sd && sd > 0 && base != null && cur != null && last60.length >= 14 && n >= 3)
      ? round((cur - base) / (sd / Math.sqrt(n)), 2)
      : null;
  const hrvZ7d = zScore(hrvCurrent, hrvBaseline, hrvSd60, hrvCur7Series.length);
  const recoZ7d = zScore(recoCur7, reco60Mean, reco60Sd, recoCur7Series.length);

  return {
    last_30_days: last30.length,
    avg_recovery_score: round(mean(scores), 1),
    median_recovery_score: round(median(scores), 1),
    avg_hrv_ms: round(mean(hrvSeries), 1),
    avg_rhr_bpm: round(mean(rhrSeries), 1),
    hrv_baseline_60d_ms: round(hrvBaseline, 1),
    hrv_current_7d_ms: round(hrvCurrent, 1),
    hrv_vs_baseline_pct: pctDelta(hrvCurrent, hrvBaseline),
    hrv_stddev_60d_ms: round(hrvSd60, 2),
    hrv_z_7d: hrvZ7d,
    recovery_mean_60d: round(reco60Mean, 1),
    recovery_stddev_60d: round(reco60Sd, 2),
    recovery_current_7d: round(recoCur7, 1),
    recovery_z_7d: recoZ7d,
    band_distribution_30d: bands,
    band_pct_30d: last30.length ? {
      green: round((bands.GREEN / last30.length) * 100, 1),
      yellow: round((bands.YELLOW / last30.length) * 100, 1),
      red: round((bands.RED / last30.length) * 100, 1),
    } : null,
    best_day: last30.reduce((best, r) => !best || r.score.recovery_score > best.score ? { date: dayKey(r.created_at), score: r.score.recovery_score } : best, null),
    worst_day: last30.reduce((worst, r) => !worst || r.score.recovery_score < worst.score ? { date: dayKey(r.created_at), score: r.score.recovery_score } : worst, null),
  };
}

// ---- strain analytics ----
function buildStrainAnalytics(cycles) {
  const scoredCycles = cycles.filter(scored);
  const last30 = scoredCycles.slice(0, 30);
  const strains = last30.map((c) => c.score.strain);
  const kjs = last30.map((c) => c.score.kilojoule);

  // "Strain bucket" distribution — WHOOP's 0–21 scale grouped.
  const buckets = { light: 0, moderate: 0, strenuous: 0, allout: 0 };
  for (const s of strains) {
    if (s < 10) buckets.light++;
    else if (s < 14) buckets.moderate++;
    else if (s < 18) buckets.strenuous++;
    else buckets.allout++;
  }

  return {
    last_30_days: last30.length,
    avg_strain: round(mean(strains), 2),
    median_strain: round(median(strains), 2),
    max_strain: round(Math.max(...strains), 2),
    total_calories_30d: round(kjs.reduce((a, b) => a + b, 0) / 4.184, 0),
    avg_calories_per_day: round(mean(kjs) / 4.184, 0),
    bucket_distribution_30d: buckets,
  };
}

// ---- workout analytics ----
function buildWorkoutAnalytics(workouts) {
  const scoredWorkouts = workouts.filter(scored);
  const last30 = scoredWorkouts.filter((w) => (Date.now() - new Date(w.start)) < 30 * 24 * MS_PER_HOUR);

  // Group by sport_name.
  const bySport = new Map();
  for (const w of last30) {
    const key = w.sport_name || `sport_${w.sport_id}`;
    const g = bySport.get(key) || { sport_name: key, count: 0, total_min: 0, total_strain: 0, total_cal: 0, total_distance_m: 0, avg_hr: [], max_hr: [] };
    const dur = (new Date(w.end) - new Date(w.start)) / MS_PER_MIN;
    g.count++;
    g.total_min += dur;
    g.total_strain += w.score.strain;
    g.total_cal += w.score.kilojoule / 4.184;
    g.total_distance_m += (w.score.distance_meter || 0);
    if (w.score.average_heart_rate) g.avg_hr.push(w.score.average_heart_rate);
    if (w.score.max_heart_rate) g.max_hr.push(w.score.max_heart_rate);
    bySport.set(key, g);
  }
  const sportBreakdown = [...bySport.values()].map((g) => ({
    sport_name: g.sport_name,
    count: g.count,
    total_minutes: round(g.total_min, 0),
    total_strain: round(g.total_strain, 1),
    total_calories: round(g.total_cal, 0),
    total_distance_km: round(g.total_distance_m / 1000, 2),
    avg_hr: round(mean(g.avg_hr), 1),
    max_hr: g.max_hr.length ? Math.max(...g.max_hr) : null,
  })).sort((a, b) => b.count - a.count);

  // Aggregate HR zone time across last 30 days.
  const zoneTotals = { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  for (const w of last30) {
    const z = w.score.zone_durations;
    if (!z) continue;
    zoneTotals.z0 += z.zone_zero_milli || 0;
    zoneTotals.z1 += z.zone_one_milli || 0;
    zoneTotals.z2 += z.zone_two_milli || 0;
    zoneTotals.z3 += z.zone_three_milli || 0;
    zoneTotals.z4 += z.zone_four_milli || 0;
    zoneTotals.z5 += z.zone_five_milli || 0;
  }
  const zoneTotalMs = Object.values(zoneTotals).reduce((a, b) => a + b, 0);
  const zonePct = zoneTotalMs > 0
    ? Object.fromEntries(Object.entries(zoneTotals).map(([k, v]) => [k, round((v / zoneTotalMs) * 100, 1)]))
    : null;
  const zoneMinutes = Object.fromEntries(Object.entries(zoneTotals).map(([k, v]) => [k, round(v / MS_PER_MIN, 0)]));

  return {
    last_30_days_count: last30.length,
    total_minutes_30d: round(last30.reduce((a, w) => a + (new Date(w.end) - new Date(w.start)) / MS_PER_MIN, 0), 0),
    total_calories_30d: round(last30.reduce((a, w) => a + w.score.kilojoule, 0) / 4.184, 0),
    sport_breakdown_30d: sportBreakdown,
    hr_zone_minutes_30d: zoneMinutes,
    hr_zone_pct_30d: zonePct,
    biggest_workout_30d: last30.length
      ? (() => { const w = last30.reduce((m, x) => x.score.strain > m.score.strain ? x : m); return summarizeWorkout(w); })()
      : null,
  };
}

// ---- correlations: what actually drives your recovery? ----
function buildCorrelations({ cycles, recoveryByCycle, sleepByCycle }) {
  const pairs = [];
  for (const c of cycles) {
    const cs = scored(c);
    const rs = scored(recoveryByCycle.get(c.id));
    const ss = scored(sleepByCycle.get(c.id));
    if (!cs || !rs) continue;
    pairs.push({
      strain: cs.strain,
      recovery: rs.recovery_score,
      hrv: rs.hrv_rmssd_milli,
      rhr: rs.resting_heart_rate,
      sleep_perf: ss?.sleep_performance_percentage ?? null,
      sleep_hours: ss ? (ss.stage_summary.total_in_bed_time_milli - ss.stage_summary.total_awake_time_milli) / MS_PER_HOUR : null,
      deep_hours: ss ? ss.stage_summary.total_slow_wave_sleep_time_milli / MS_PER_HOUR : null,
      rem_hours: ss ? ss.stage_summary.total_rem_sleep_time_milli / MS_PER_HOUR : null,
    });
  }
  // For lagged "yesterday's strain -> today's recovery": cycles are desc order, so index i+1 is the day before i.
  const lagged = [];
  for (let i = 0; i < pairs.length - 1; i++) {
    lagged.push({ prev_strain: pairs[i + 1].strain, recovery: pairs[i].recovery });
  }
  const col = (key) => pairs.map((p) => p[key]).filter((v) => v != null);
  const pairedCol = (ka, kb) => {
    const a = [], b = [];
    for (const p of pairs) if (p[ka] != null && p[kb] != null) { a.push(p[ka]); b.push(p[kb]); }
    return [a, b];
  };

  const r = {};
  for (const key of ['sleep_perf', 'sleep_hours', 'deep_hours', 'rem_hours', 'hrv']) {
    const [a, b] = pairedCol(key, 'recovery');
    r[`${key}__recovery`] = pearson(a, b);
  }
  const [ps, pr] = [lagged.map((x) => x.prev_strain), lagged.map((x) => x.recovery)];
  r.prev_day_strain__recovery = pearson(ps, pr);
  return {
    n_pairs: pairs.length,
    correlations_with_recovery: r,
    note: 'Pearson r, range -1..+1. Values |r|>0.3 suggest a meaningful relationship given typical n=30–90.',
  };
}

// ---- timeseries for charting ----
function buildTimeseries({ cycles, recoveryByCycle, sleepByCycle }) {
  const points = [];
  for (const c of cycles.slice(0, 180)) {
    const cs = scored(c);
    const rec = recoveryByCycle.get(c.id);
    const rs = scored(rec);
    const slp = sleepByCycle.get(c.id);
    const ss = scored(slp);
    const asleep = ss ? (ss.stage_summary.total_in_bed_time_milli - ss.stage_summary.total_awake_time_milli) : null;
    points.push({
      date: dayKey(c.start),
      strain: cs ? round(cs.strain, 1) : null,
      recovery: rs?.recovery_score ?? null,
      hrv: rs ? round(rs.hrv_rmssd_milli, 1) : null,
      rhr: rs?.resting_heart_rate ?? null,
      spo2: rs ? round(rs.spo2_percentage, 1) : null,
      skin_temp: rs ? round(rs.skin_temp_celsius, 1) : null,
      sleep_perf: ss?.sleep_performance_percentage ?? null,
      sleep_hours: asleep != null ? round(asleep / MS_PER_HOUR, 2) : null,
      deep_hours: ss ? round(ss.stage_summary.total_slow_wave_sleep_time_milli / MS_PER_HOUR, 2) : null,
      rem_hours: ss ? round(ss.stage_summary.total_rem_sleep_time_milli / MS_PER_HOUR, 2) : null,
      light_hours: ss ? round(ss.stage_summary.total_light_sleep_time_milli / MS_PER_HOUR, 2) : null,
      respiratory_rate: ss ? round(ss.respiratory_rate, 2) : null,
    });
  }
  // Chronological ascending for nicer charting.
  points.reverse();

  // Add 7d rolling averages for HRV and RHR.
  for (let i = 0; i < points.length; i++) {
    const window = points.slice(Math.max(0, i - 6), i + 1);
    const hrvVals = window.map((p) => p.hrv).filter((v) => v != null);
    const rhrVals = window.map((p) => p.rhr).filter((v) => v != null);
    points[i].hrv_7d_avg = hrvVals.length >= 3 ? round(mean(hrvVals), 1) : null;
    points[i].rhr_7d_avg = rhrVals.length >= 3 ? round(mean(rhrVals), 1) : null;
  }
  return points;
}

// ---- readiness: composite daily readiness score ----
function buildReadiness({ cycles, recoveryByCycle, sleepByCycle }) {
  const latest = cycles[0];
  if (!latest) return null;
  const rs = scored(recoveryByCycle.get(latest.id));
  const ss = scored(sleepByCycle.get(latest.id));
  if (!rs) return null;

  // HRV vs 60d baseline
  const scoredRecs = [];
  for (const c of cycles.slice(0, 60)) {
    const r = scored(recoveryByCycle.get(c.id));
    if (r) scoredRecs.push(r);
  }
  const hrvBaseline = mean(scoredRecs.map((r) => r.hrv_rmssd_milli));
  const hrvCurrent = rs.hrv_rmssd_milli;
  const hrvRatio = hrvBaseline ? clamp(hrvCurrent / hrvBaseline, 0.5, 1.5) : 1;

  // Component scores (each 0-100)
  const recoveryComponent = clamp(rs.recovery_score, 0, 100);
  const hrvComponent = round(clamp((hrvRatio - 0.5) * 100, 0, 100), 0);
  const sleepComponent = ss ? clamp(ss.sleep_performance_percentage, 0, 100) : 50;
  const debtPenalty = ss ? clamp(ss.sleep_needed.need_from_sleep_debt_milli / MS_PER_HOUR, 0, 3) : 0;
  const debtComponent = round(clamp(100 - debtPenalty * 25, 0, 100), 0);

  // Weighted composite
  const composite = round(
    recoveryComponent * 0.35 +
    hrvComponent * 0.25 +
    sleepComponent * 0.25 +
    debtComponent * 0.15,
    0
  );

  return {
    score: clamp(composite, 0, 100),
    band: composite >= 70 ? 'OPTIMAL' : composite >= 40 ? 'MODERATE' : 'LOW',
    components: {
      recovery: { value: rs.recovery_score, weight: 35 },
      hrv_vs_baseline: { value: round(hrvRatio * 100, 0), weight: 25 },
      sleep_performance: { value: ss?.sleep_performance_percentage ?? null, weight: 25 },
      sleep_debt: { value: debtComponent, debt_hours: round(debtPenalty, 2), weight: 15 },
    },
  };
}

// ---- streaks: consecutive green recovery ----
function buildStreaks(recoveries) {
  const scoredRecs = recoveries.filter(scored)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  let currentCounted = false;

  for (const r of scoredRecs) {
    if (r.score.recovery_score >= 67) {
      tempStreak++;
      if (!currentCounted) currentStreak = tempStreak;
    } else {
      if (!currentCounted) currentCounted = true;
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 0;
    }
  }
  longestStreak = Math.max(longestStreak, tempStreak);

  // Yellow streak (34-66)
  let yellowStreak = 0;
  for (const r of scoredRecs) {
    const s = r.score.recovery_score;
    if (s >= 34 && s < 67) yellowStreak++;
    else break;
  }

  return {
    current_green: currentStreak,
    longest_green_90d: longestStreak,
    current_above_yellow: (() => {
      let s = 0;
      for (const r of scoredRecs) {
        if (r.score.recovery_score >= 34) s++; else break;
      }
      return s;
    })(),
  };
}

// ---- day of week patterns ----
function buildDayOfWeek({ cycles, recoveryByCycle, sleepByCycle }) {
  const buckets = Array.from({ length: 7 }, () => ({
    recovery: [], strain: [], sleep_hours: [], hrv: [],
  }));

  for (const c of cycles.slice(0, 90)) {
    const dow = new Date(c.start).getDay();
    const cs = scored(c);
    const rs = scored(recoveryByCycle.get(c.id));
    const ss = scored(sleepByCycle.get(c.id));
    if (cs) buckets[dow].strain.push(cs.strain);
    if (rs) {
      buckets[dow].recovery.push(rs.recovery_score);
      buckets[dow].hrv.push(rs.hrv_rmssd_milli);
    }
    if (ss) {
      const asleep = (ss.stage_summary.total_in_bed_time_milli - ss.stage_summary.total_awake_time_milli) / MS_PER_HOUR;
      buckets[dow].sleep_hours.push(asleep);
    }
  }

  return WEEKDAYS.map((name, i) => ({
    day: name,
    avg_recovery: round(mean(buckets[i].recovery), 1),
    avg_strain: round(mean(buckets[i].strain), 1),
    avg_sleep_hours: round(mean(buckets[i].sleep_hours), 2),
    avg_hrv: round(mean(buckets[i].hrv), 1),
    n: buckets[i].recovery.length,
  }));
}

// ---- sleep debt trend: is debt growing or shrinking? ----
function buildSleepDebtTrend(sleeps) {
  const nights = sleeps.filter((s) => !s.nap && scored(s)).slice(0, 14);
  if (nights.length < 3) return null;
  const debtSeries = nights.map((s) => s.score.sleep_needed.need_from_sleep_debt_milli / MS_PER_HOUR).reverse();
  const slope = linearSlope(debtSeries);
  return {
    last_14_nights: debtSeries.length,
    current_debt_hours: round(debtSeries[debtSeries.length - 1], 2),
    oldest_debt_hours: round(debtSeries[0], 2),
    slope_per_day: slope,
    direction: slope == null ? null : slope > 0.02 ? 'ACCUMULATING' : slope < -0.02 ? 'RECOVERING' : 'STABLE',
    series: debtSeries.map((v) => round(v, 2)),
  };
}

// ---- training load: ACWR ----
function buildTrainingLoad(cycles) {
  const scoredCycles = cycles.filter(scored);
  if (scoredCycles.length < 7) return null;

  const strains = scoredCycles.map((c) => c.score.strain);
  const acute = mean(strains.slice(0, 7));
  const chronic = mean(strains.slice(0, 28));
  const acwr = chronic ? round(acute / chronic, 2) : null;

  // Build ACWR timeseries (last 90d)
  const acwrSeries = [];
  for (let i = 0; i < Math.min(scoredCycles.length - 27, 90); i++) {
    const a = mean(strains.slice(i, i + 7));
    const ch = mean(strains.slice(i, i + 28));
    acwrSeries.push({
      date: dayKey(scoredCycles[i].start),
      acwr: ch ? round(a / ch, 2) : null,
      acute_strain: round(a, 2),
      chronic_strain: round(ch, 2),
    });
  }

  let zone;
  if (acwr == null) zone = null;
  else if (acwr < 0.8) zone = 'DETRAINING';
  else if (acwr <= 1.3) zone = 'OPTIMAL';
  else if (acwr <= 1.5) zone = 'OVERREACHING';
  else zone = 'DANGER';

  return {
    acwr,
    zone,
    acute_7d_strain: round(acute, 2),
    chronic_28d_strain: round(chronic, 2),
    series: acwrSeries.reverse(),
  };
}

// ---- personal records ----
function buildPersonalRecords({ cycles, recoveries, sleeps, recoveryByCycle, sleepByCycle }) {
  const scoredRecs = recoveries.filter(scored);
  const scoredCycles = cycles.filter(scored);
  const scoredNights = sleeps.filter((s) => !s.nap && scored(s));

  const last30Recs = scoredRecs.slice(0, 30);
  const last30Cycles = scoredCycles.slice(0, 30);
  const last30Nights = scoredNights.slice(0, 30);

  const findBest = (arr, key, mode = 'max') => {
    if (!arr.length) return null;
    const reducer = mode === 'max'
      ? (best, r) => (r.val > best.val ? r : best)
      : (best, r) => (r.val < best.val ? r : best);
    return arr.reduce(reducer);
  };

  const recWithDate = (arr, accessor) => arr.map((r) => ({
    val: accessor(r),
    date: dayKey(r.created_at || r.start),
  })).filter((r) => r.val != null);

  const cycleWithDate = (arr, accessor) => arr.map((c) => ({
    val: accessor(c),
    date: dayKey(c.start),
  })).filter((r) => r.val != null);

  return {
    all_time: {
      highest_hrv: findBest(recWithDate(scoredRecs, (r) => r.score.hrv_rmssd_milli), 'hrv', 'max'),
      lowest_rhr: findBest(recWithDate(scoredRecs, (r) => r.score.resting_heart_rate), 'rhr', 'min'),
      highest_recovery: findBest(recWithDate(scoredRecs, (r) => r.score.recovery_score), 'recovery', 'max'),
      highest_strain: findBest(cycleWithDate(scoredCycles, (c) => c.score.strain), 'strain', 'max'),
      most_sleep: findBest(
        scoredNights.map((s) => ({
          val: (s.score.stage_summary.total_in_bed_time_milli - s.score.stage_summary.total_awake_time_milli) / MS_PER_HOUR,
          date: dayKey(s.start),
        })), 'sleep', 'max'),
    },
    last_30d: {
      highest_hrv: findBest(recWithDate(last30Recs, (r) => r.score.hrv_rmssd_milli), 'hrv', 'max'),
      lowest_rhr: findBest(recWithDate(last30Recs, (r) => r.score.resting_heart_rate), 'rhr', 'min'),
      highest_recovery: findBest(recWithDate(last30Recs, (r) => r.score.recovery_score), 'recovery', 'max'),
      highest_strain: findBest(cycleWithDate(last30Cycles, (c) => c.score.strain), 'strain', 'max'),
    },
  };
}

// ---- vital trends: spo2 + skin temp over time ----
function buildVitalTrends(recoveries) {
  const scoredRecs = recoveries.filter(scored);
  const last30 = scoredRecs.slice(0, 30);
  const spo2Vals = last30.map((r) => r.score.spo2_percentage).filter((v) => v != null);
  const tempVals = last30.map((r) => r.score.skin_temp_celsius).filter((v) => v != null);

  const spo2Mean = mean(spo2Vals);
  const spo2Sd = stddev(spo2Vals);
  const tempMean = mean(tempVals);
  const tempSd = stddev(tempVals);

  // Flag if latest values deviate > 1 stddev
  const latest = scoredRecs[0]?.score;
  const spo2Flag = latest?.spo2_percentage != null && spo2Sd
    ? Math.abs(latest.spo2_percentage - spo2Mean) > spo2Sd
    : false;
  const tempFlag = latest?.skin_temp_celsius != null && tempSd
    ? Math.abs(latest.skin_temp_celsius - tempMean) > tempSd
    : false;

  return {
    spo2: {
      avg_30d: round(spo2Mean, 2),
      stddev_30d: round(spo2Sd, 2),
      latest: latest?.spo2_percentage != null ? round(latest.spo2_percentage, 1) : null,
      deviation_flag: spo2Flag,
      n: spo2Vals.length,
    },
    skin_temp: {
      avg_30d: round(tempMean, 2),
      stddev_30d: round(tempSd, 2),
      latest: latest?.skin_temp_celsius != null ? round(latest.skin_temp_celsius, 1) : null,
      deviation_flag: tempFlag,
      n: tempVals.length,
    },
  };
}

// ---- percentile ranks: where does today sit vs history? ----
function buildPercentiles({ cycles, recoveries, sleeps, recoveryByCycle, sleepByCycle, today }) {
  if (!today) return null;
  const last90Recs = recoveries.filter(scored).slice(0, 90);
  const last90Cycles = cycles.filter(scored).slice(0, 90);
  const last90Nights = sleeps.filter((s) => !s.nap && scored(s)).slice(0, 90);

  const sorted = (arr) => [...arr].sort((a, b) => a - b);

  return {
    recovery: percentileRank(today.recovery_score, sorted(last90Recs.map((r) => r.score.recovery_score))),
    hrv: percentileRank(today.hrv_ms, sorted(last90Recs.map((r) => r.score.hrv_rmssd_milli))),
    strain: percentileRank(today.strain, sorted(last90Cycles.map((c) => c.score.strain))),
    rhr: today.resting_hr != null
      ? 100 - percentileRank(today.resting_hr, sorted(last90Recs.map((r) => r.score.resting_heart_rate)))
      : null,
    sleep_hours: today.sleep?.hours_asleep != null
      ? percentileRank(today.sleep.hours_asleep, sorted(last90Nights.map((s) =>
        (s.score.stage_summary.total_in_bed_time_milli - s.score.stage_summary.total_awake_time_milli) / MS_PER_HOUR
      )))
      : null,
    note: 'Percentile vs last 90 days. Higher = better (RHR is inverted: higher percentile = lower RHR).',
  };
}

// ---- per-sport impact on next-day recovery ----
// For each workout, find the recovery score of the CYCLE AFTER the workout's cycle.
// Group by sport, compare avg next-day recovery vs the overall baseline.
function buildSportImpact({ cycles, recoveryByCycle, workouts }) {
  if (!cycles.length || !workouts.length) return null;

  // Map each cycle → the next (chronologically later) cycle's recovery.
  const chrono = [...cycles].sort((a, b) => new Date(a.start) - new Date(b.start));
  const nextRecoveryByCycleId = new Map();
  for (let i = 0; i < chrono.length - 1; i++) {
    const nextRec = recoveryByCycle.get(chrono[i + 1].id);
    if (scored(nextRec)) nextRecoveryByCycleId.set(chrono[i].id, nextRec.score.recovery_score);
  }

  // Which cycle does each workout belong to? Match by the cycle window the workout falls in.
  const cyclesAsc = chrono;
  const workoutCycleId = (w) => {
    const t = new Date(w.start).getTime();
    for (const c of cyclesAsc) {
      const s = new Date(c.start).getTime();
      const e = c.end ? new Date(c.end).getTime() : Date.now();
      if (t >= s && t <= e) return c.id;
    }
    return null;
  };

  const bySport = new Map();
  const allNextReco = [];
  const seenCyclesPerSport = new Map(); // dedupe when two workouts of same sport fall in one cycle
  for (const w of workouts) {
    if (!scored(w)) continue;
    const cid = workoutCycleId(w);
    if (cid == null) continue;
    const next = nextRecoveryByCycleId.get(cid);
    if (next == null) continue;
    const sport = w.sport_name || `sport_${w.sport_id}`;
    if (!seenCyclesPerSport.has(sport)) seenCyclesPerSport.set(sport, new Set());
    const seen = seenCyclesPerSport.get(sport);
    if (seen.has(cid)) continue;
    seen.add(cid);
    if (!bySport.has(sport)) bySport.set(sport, []);
    bySport.get(sport).push(next);
    allNextReco.push(next);
  }
  if (!allNextReco.length) return null;

  const baseline = mean(allNextReco);
  const impacts = [];
  for (const [sport, recos] of bySport.entries()) {
    if (recos.length < 5) continue;
    const avg = mean(recos);
    impacts.push({
      sport,
      n: recos.length,
      next_day_recovery_avg: round(avg, 1),
      delta_vs_baseline: round(avg - baseline, 1),
    });
  }
  impacts.sort((a, b) => Math.abs(b.delta_vs_baseline) - Math.abs(a.delta_vs_baseline));
  return {
    baseline_next_day_recovery: round(baseline, 1),
    n_total: allNextReco.length,
    impacts,
  };
}

// ---- recovery forecast: OLS regression on sleep + prev-day strain ----
// Fits recovery ~ β0 + β1·sleep_perf + β2·sleep_hours + β3·prev_strain over
// the last ≤90 days, then predicts tomorrow's recovery given typical inputs.
function buildRecoveryForecast({ cycles, recoveryByCycle, sleepByCycle }) {
  // Pair each cycle's recovery with the prior cycle's strain + that cycle's sleep.
  // cycles are sorted newest-first; i is today, i+1 is yesterday.
  const pairs = [];
  for (let i = 0; i < Math.min(cycles.length - 1, 90); i++) {
    const today = cycles[i];
    const yest = cycles[i + 1];
    const rs = scored(recoveryByCycle.get(today.id));
    if (!rs) continue;
    const ss = scored(sleepByCycle.get(today.id));
    if (!ss) continue;
    const prevStrain = scored(yest)?.strain;
    if (prevStrain == null) continue;
    const sleepHours =
      (ss.stage_summary.total_in_bed_time_milli - ss.stage_summary.total_awake_time_milli) / MS_PER_HOUR;
    pairs.push({
      recovery: rs.recovery_score,
      sleep_perf: ss.sleep_performance_percentage,
      sleep_hours: sleepHours,
      prev_strain: prevStrain,
    });
  }
  if (pairs.length < 20) return null;

  const X = pairs.map((p) => [1, p.sleep_perf, p.sleep_hours, p.prev_strain]);
  const y = pairs.map((p) => p.recovery);
  const beta = mlRegress(X, y);
  if (!beta) return null;

  // In-sample RMSE + R² (quality of the fit).
  const predictions = X.map((row) => row.reduce((s, v, i) => s + v * beta[i], 0));
  const residuals = y.map((actual, i) => actual - predictions[i]);
  const rmse = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);
  const yMean = mean(y);
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : null;

  // Forecast tomorrow: assume tonight's sleep matches last-7 average,
  // and "today's strain" is either the current (in-progress) cycle or the 7-day mean.
  const recent7 = pairs.slice(0, 7);
  const typSleepPerf = mean(recent7.map((p) => p.sleep_perf));
  const typSleepHours = mean(recent7.map((p) => p.sleep_hours));
  const todayCycleStrain = scored(cycles[0])?.strain;
  const assumedStrain = todayCycleStrain != null ? todayCycleStrain : mean(recent7.map((p) => p.prev_strain));
  const predicted = beta[0] + beta[1] * typSleepPerf + beta[2] * typSleepHours + beta[3] * assumedStrain;
  const clamped = Math.max(0, Math.min(100, predicted));

  return {
    n: pairs.length,
    predicted_recovery: round(clamped, 0),
    predicted_band: recoveryBand(clamped),
    rmse: round(rmse, 1),
    r_squared: round(r2, 2),
    // Per-unit coefficients — "levers" the user can act on.
    per_hour_sleep: round(beta[2], 1),      // Δrecovery per +1h sleep
    per_pct_sleep_perf: round(beta[1], 2),  // Δrecovery per +1% sleep performance
    per_strain_point: round(beta[3], 2),    // Δrecovery per +1 strain today
    assumed_sleep_hours: round(typSleepHours, 1),
    assumed_sleep_perf: round(typSleepPerf, 0),
    assumed_today_strain: round(assumedStrain, 1),
    today_strain_is_actual: todayCycleStrain != null,
  };
}

// ---- bedtime drift: is the 30-night bedtime trending later/earlier/stable? ----
function buildBedtimeDrift(sleeps) {
  const nights = sleeps.filter((s) => !s.nap && scored(s)).slice(0, 30);
  if (nights.length < 14) return null;
  const chrono = [...nights].reverse();
  const bedtimes = chrono.map((s) => timeOfDayHours(s.start));
  const slope = linearSlope(bedtimes); // hours/day
  if (slope == null) return null;
  const minPerWeek = Math.round(slope * 7 * 60);
  // Threshold: ~3 min/day ≈ 20 min/week is the minimum we call "drift".
  const direction = slope > 0.05 ? 'LATER' : slope < -0.05 ? 'EARLIER' : 'STABLE';
  return {
    slope_hours_per_day: round(slope, 4),
    minutes_per_week: minPerWeek,
    direction,
    n_nights: chrono.length,
  };
}

// ---- periodicity: autocorrelation on recovery at lags 7/14/28 ----
function buildPeriodicity(timeseries) {
  const recoSeries = timeseries.map((p) => p.recovery).filter((v) => v != null);
  if (recoSeries.length < 35) return null;
  return {
    n: recoSeries.length,
    lag_7: autocorr(recoSeries, 7),
    lag_14: autocorr(recoSeries, 14),
    lag_28: recoSeries.length >= 56 ? autocorr(recoSeries, 28) : null,
  };
}

// ---- insights: short narrative read-out of the data ----
// Each insight: { kind: 'alert'|'warn'|'good'|'neutral', category, headline, detail?, action? }
//   - headline: observation
//   - detail: supporting numbers (dim)
//   - action: concrete recommendation (accent, prefixed with →)
// Thresholds personalized via z-score where ≥14 days of data exist; fallback to
// fixed % thresholds for newer accounts.
function buildInsights({
  today, trends, recovery, sleep, strain, training_load,
  sleep_debt_trend, correlations, streaks, day_of_week,
  vital_trends, personal_records, timeseries,
  sport_impact, forecast, bedtime_drift, periodicity,
}) {
  const out = [];

  // --- Forecast (next-day recovery prediction from OLS regression) ---
  if (forecast?.predicted_recovery != null && forecast.n >= 20) {
    const f = forecast;
    const bandWord = f.predicted_band || 'UNKNOWN';
    const context = f.today_strain_is_actual
      ? `today's strain ${f.assumed_today_strain}`
      : `typical strain ${f.assumed_today_strain}`;
    out.push({
      kind: 'neutral',
      category: 'FORECAST',
      headline: `Tomorrow's recovery projected ~${f.predicted_recovery}% (${bandWord}) based on your ${f.n}-day history.`,
      detail: `assuming ${f.assumed_sleep_hours}h sleep · ${f.assumed_sleep_perf}% sleep perf · ${context} · ±${f.rmse}pt typical error.`,
      action: (() => {
        // Surface the biggest lever: compare a 1h sleep bump vs dialing back strain 3 points.
        const sleepLift = f.per_hour_sleep;
        const strainImpact = Math.abs(f.per_strain_point) * 3;
        if (sleepLift == null || !isFinite(sleepLift)) return null;
        if (sleepLift >= Math.abs(strainImpact)) {
          return `adding 1h sleep → +${sleepLift}pt recovery · your biggest single lever.`;
        }
        return `cutting today's strain by 3 → +${round(strainImpact, 1)}pt recovery tomorrow.`;
      })(),
    });
  }

  // --- Per-sport impact on next-day recovery ---
  if (sport_impact?.impacts?.length) {
    const worst = sport_impact.impacts.find((x) => x.delta_vs_baseline <= -3);
    const best = sport_impact.impacts.find((x) => x.delta_vs_baseline >= 3);
    if (worst) {
      out.push({
        kind: 'warn',
        category: 'SPORT',
        headline: `${worst.sport} sessions drop next-day recovery ${Math.abs(worst.delta_vs_baseline)}pt below your avg (n=${worst.n}).`,
        detail: `next-day recovery after ${worst.sport}: ${worst.next_day_recovery_avg}% vs overall ${sport_impact.baseline_next_day_recovery}%.`,
        action: `schedule ${worst.sport} on lower-priority days; avoid stacking before important events.`,
      });
    }
    if (best) {
      out.push({
        kind: 'good',
        category: 'SPORT',
        headline: `${best.sport} sessions leave you +${best.delta_vs_baseline}pt above your recovery avg (n=${best.n}).`,
        detail: `next-day recovery after ${best.sport}: ${best.next_day_recovery_avg}% vs overall ${sport_impact.baseline_next_day_recovery}%.`,
        action: null,
      });
    }
  }

  // --- Bedtime drift ---
  if (bedtime_drift?.direction === 'LATER' && bedtime_drift.minutes_per_week != null) {
    const min = Math.abs(bedtime_drift.minutes_per_week);
    out.push({
      kind: 'warn',
      category: 'BEDTIME',
      headline: `Bedtime drifting ~${min} min later per week over ${bedtime_drift.n_nights} nights.`,
      detail: `compounds into sleep debt if unchecked.`,
      action: `pick a hard bedtime cutoff and honor it for 2 weeks — arrests the drift fastest.`,
    });
  } else if (bedtime_drift?.direction === 'EARLIER' && bedtime_drift.minutes_per_week != null) {
    const min = Math.abs(bedtime_drift.minutes_per_week);
    out.push({
      kind: 'good',
      category: 'BEDTIME',
      headline: `Bedtime drifting ~${min} min earlier per week — positive pattern.`,
      detail: null,
      action: null,
    });
  }

  // --- Weekly/monthly periodicity ---
  if (periodicity) {
    const l7 = periodicity.lag_7;
    const l28 = periodicity.lag_28;
    if (l7 != null && l7 >= 0.3) {
      out.push({
        kind: 'neutral',
        category: 'RHYTHM',
        headline: `Recovery follows a ~weekly rhythm (ACF₇=${l7}).`,
        detail: `your week has a repeating high/low structure — see section 12 for weekday peaks.`,
        action: null,
      });
    }
    if (l28 != null && l28 >= 0.3) {
      out.push({
        kind: 'neutral',
        category: 'RHYTHM',
        headline: `Monthly-ish recovery pattern detected (ACF₂₈=${l28}).`,
        detail: `your 4-week rhythm is nontrivial — worth logging external factors (travel, hormonal, work cycles).`,
        action: null,
      });
    }
  }

  // --- Vital deviations (alerts — possible illness signal) ---
  if (vital_trends?.skin_temp?.deviation_flag) {
    out.push({
      kind: 'alert',
      category: 'VITALS',
      headline: 'Skin temp deviating from 30d baseline — possible early illness signal.',
      detail: `latest off by more than 1σ (${vital_trends.skin_temp.stddev_30d}°C).`,
      action: 'cut training intensity 30–50% until the trend clarifies.',
    });
  }
  if (vital_trends?.spo2?.deviation_flag) {
    out.push({
      kind: 'alert',
      category: 'VITALS',
      headline: 'SpO₂ deviating from 30d average — monitor over next few days.',
      detail: `latest off by more than 1σ (${vital_trends.spo2.stddev_30d}%).`,
      action: 're-check tomorrow morning; if sustained, take a rest day.',
    });
  }

  // --- Training load zone ---
  if (training_load?.zone) {
    const tl = training_load;
    const z = tl.zone;
    if (z === 'DANGER') {
      out.push({
        kind: 'alert',
        category: 'LOAD',
        headline: `Training load in danger zone (acwr ${tl.acwr}) — high injury/illness risk.`,
        detail: `acute 7d ${tl.acute_7d_strain} vs chronic 28d ${tl.chronic_28d_strain}.`,
        action: `drop next session · cap strain <10 for 3 days · protect sleep.`,
      });
    } else if (z === 'OVERREACHING') {
      out.push({
        kind: 'warn',
        category: 'LOAD',
        headline: `Overreaching — acute load is ${tl.acwr}× your chronic base.`,
        detail: `sustainable short-term; recovery will tell you when to back off.`,
        action: `hold volume steady · no new intensity until acwr drops under 1.3.`,
      });
    } else if (z === 'DETRAINING') {
      out.push({
        kind: 'warn',
        category: 'LOAD',
        headline: `Acute load low (acwr ${tl.acwr}) — detraining risk if prolonged.`,
        detail: null,
        action: `add one moderate session (strain 10–14) this week to hold your base.`,
      });
    } else if (z === 'OPTIMAL') {
      out.push({
        kind: 'good',
        category: 'LOAD',
        headline: `Training load in optimal zone — sustainable adaptation.`,
        detail: `acwr ${tl.acwr} · acute 7d ${tl.acute_7d_strain} vs chronic 28d ${tl.chronic_28d_strain}.`,
        action: `green light for your planned training load.`,
      });
    }
  }

  // --- Recovery momentum (7d vs 60d, personalized via z-score) ---
  const recoZ = recovery?.recovery_z_7d;
  const recoCur = recovery?.recovery_current_7d ?? trends?.delta_week?.recovery?.current;
  const reco60 = recovery?.recovery_mean_60d;
  if (recoZ != null && recoCur != null && reco60 != null) {
    // Personalized path (have ≥14 days + stable stddev)
    if (recoZ >= 1) {
      out.push({
        kind: 'good',
        category: 'RECOVERY',
        headline: `Recovery running hot — 7d avg ${recoCur}% vs your 60d norm ${reco60}% (z=+${recoZ}σ).`,
        detail: recoZ >= 2 ? 'strongly above your own baseline.' : null,
        action: 'good window for a higher-strain session if you\'ve been holding back.',
      });
    } else if (recoZ <= -1) {
      out.push({
        kind: 'warn',
        category: 'RECOVERY',
        headline: `Recovery running cold — 7d avg ${recoCur}% vs your 60d norm ${reco60}% (z=${recoZ}σ).`,
        detail: recoZ <= -2 ? 'strongly below your own baseline.' : null,
        action: 'shift the next intensity day to zone-2; protect tonight\'s sleep.',
      });
    }
  } else {
    // Fallback: fixed % threshold for new accounts
    const recWk = trends?.delta_week?.recovery;
    if (recWk?.pct_change != null && recWk.current != null) {
      const p = recWk.pct_change;
      if (p >= 5) {
        out.push({
          kind: 'good',
          category: 'RECOVERY',
          headline: `Recovery trending up +${p}% vs last week.`,
          detail: `${recWk.current}% this week · ${recWk.previous}% previous.`,
          action: 'good window for a higher-strain session if you\'ve been holding back.',
        });
      } else if (p <= -5) {
        out.push({
          kind: 'warn',
          category: 'RECOVERY',
          headline: `Recovery trending down ${p}% vs last week.`,
          detail: `${recWk.current}% this week · ${recWk.previous}% previous.`,
          action: 'shift the next intensity day to zone-2; protect tonight\'s sleep.',
        });
      }
    }
  }

  // --- HRV vs 60d baseline (personalized via z-score) ---
  const hrvZ = recovery?.hrv_z_7d;
  const hrvPct = recovery?.hrv_vs_baseline_pct;
  const hrvCur = recovery?.hrv_current_7d_ms;
  const hrvBase = recovery?.hrv_baseline_60d_ms;
  if (hrvZ != null && hrvCur && hrvBase) {
    if (hrvZ >= 1) {
      out.push({
        kind: 'good',
        category: 'HRV',
        headline: `HRV ${hrvPct >= 0 ? '+' : ''}${hrvPct}% above baseline (z=+${hrvZ}σ) — strong adaptation.`,
        detail: `7d avg ${hrvCur}ms · baseline ${hrvBase}ms.`,
        action: hrvZ >= 2 ? 'lean into it — today is a green light for harder work.' : null,
      });
    } else if (hrvZ <= -1) {
      out.push({
        kind: 'warn',
        category: 'HRV',
        headline: `HRV ${hrvPct}% below baseline (z=${hrvZ}σ) — meaningful fatigue signal.`,
        detail: `7d avg ${hrvCur}ms · baseline ${hrvBase}ms.`,
        action: 'back off intensity · favor zone-2 work · prioritize sleep tonight.',
      });
    }
  } else if (hrvPct != null && hrvCur && hrvBase) {
    // Fallback: fixed % threshold for new accounts
    if (hrvPct >= 5) {
      out.push({
        kind: 'good',
        category: 'HRV',
        headline: `HRV +${hrvPct}% above your 60-day baseline.`,
        detail: `7d avg ${hrvCur}ms · baseline ${hrvBase}ms.`,
        action: null,
      });
    } else if (hrvPct <= -5) {
      out.push({
        kind: 'warn',
        category: 'HRV',
        headline: `HRV ${Math.abs(hrvPct)}% below baseline — signs of accumulated strain.`,
        detail: `7d avg ${hrvCur}ms · baseline ${hrvBase}ms.`,
        action: 'back off intensity · favor zone-2 work · prioritize sleep tonight.',
      });
    }
  }

  // --- Sleep debt trajectory ---
  if (sleep_debt_trend?.direction) {
    const sdt = sleep_debt_trend;
    if (sdt.direction === 'ACCUMULATING' && sdt.current_debt_hours > 0) {
      const perWeek = round(sdt.slope_per_day * 7, 2);
      // Break-even math: need to add current_debt_hours back over N nights @ 30 min each
      const nightsAt30 = Math.ceil(sdt.current_debt_hours / 0.5);
      out.push({
        kind: 'warn',
        category: 'SLEEP',
        headline: `Sleep debt accumulating — now ${sdt.current_debt_hours}h (was ${sdt.oldest_debt_hours}h 14d ago).`,
        detail: perWeek != null ? `trajectory +${perWeek}h/week if unchanged.` : null,
        action: `go to bed 30 min earlier for ~${nightsAt30} nights to neutralize.`,
      });
    } else if (sdt.direction === 'RECOVERING') {
      const slope = sdt.slope_per_day;
      const daysToZero = slope != null && slope < 0 && sdt.current_debt_hours > 0
        ? Math.round(sdt.current_debt_hours / Math.abs(slope))
        : null;
      out.push({
        kind: 'good',
        category: 'SLEEP',
        headline: daysToZero != null && daysToZero < 60
          ? `Sleep debt recovering — ~${daysToZero} days to clear ${sdt.current_debt_hours}h at current pace.`
          : `Sleep debt recovering — down from ${sdt.oldest_debt_hours}h to ${sdt.current_debt_hours}h.`,
        detail: null,
        action: `stay the course — current bedtime pattern is working.`,
      });
    }
  }

  // --- Sleep duration last 7d ---
  const sleep7 = trends?.last_7?.sleep_hours?.avg;
  if (sleep7 != null) {
    if (sleep7 < 6.5) {
      const gap = (7 - sleep7).toFixed(1);
      out.push({
        kind: 'warn',
        category: 'SLEEP',
        headline: `Only ${sleep7.toFixed(1)}h avg sleep last 7 days — well below 7h floor.`,
        detail: `cumulative shortfall ~${((7 - sleep7) * 7).toFixed(1)}h this week.`,
        action: `target +${gap}h tonight — shift bedtime ${Math.round((7 - sleep7) * 60)} min earlier.`,
      });
    } else if (sleep7 >= 8) {
      out.push({
        kind: 'good',
        category: 'SLEEP',
        headline: `Hitting ${sleep7.toFixed(1)}h avg sleep last 7 days.`,
        detail: null,
        action: null,
      });
    }
  }

  // --- Bedtime consistency ---
  const rating = sleep?.bedtime?.consistency_rating;
  const sd = sleep?.bedtime?.stddev_hours;
  if (rating === 'INCONSISTENT' && sd != null) {
    out.push({
      kind: 'warn',
      category: 'SLEEP',
      headline: `Bedtime is inconsistent (±${sd}h across 30 nights).`,
      detail: `tighter windows improve deep sleep % and next-day recovery.`,
      action: `lock a 30-min bedtime window for 2 weeks — biggest single lever on recovery.`,
    });
  } else if (rating === 'EXCELLENT' && sd != null) {
    out.push({
      kind: 'good',
      category: 'SLEEP',
      headline: `Bedtime is rock-solid (±${sd}h across 30 nights).`,
      detail: null,
      action: null,
    });
  }

  // --- Recovery band share (30d) ---
  if (recovery?.band_pct_30d) {
    const { green: g, yellow: y, red: r } = recovery.band_pct_30d;
    if (r != null && r >= 30) {
      out.push({
        kind: 'warn',
        category: 'RECOVERY',
        headline: `${r}% of the last 30 days were RED — consider dialing back strain.`,
        detail: `green ${g}% · yellow ${y}% · red ${r}%.`,
        action: `schedule 2 full rest days · cut intensity 30% for the next 7 days.`,
      });
    } else if (g != null && g >= 55) {
      out.push({
        kind: 'good',
        category: 'RECOVERY',
        headline: `Adapting well — ${g}% of the last 30 days were GREEN.`,
        detail: `green ${g}% · yellow ${y}% · red ${r}%.`,
        action: null,
      });
    }
  }

  // --- Streak ---
  if (streaks?.current_green != null && streaks.current_green >= 3) {
    const cg = streaks.current_green;
    const longest = streaks.longest_green_90d;
    out.push({
      kind: 'good',
      category: 'STREAK',
      headline: `On a ${cg}-day green streak.`,
      detail: longest > cg ? `longest 90d: ${longest} days.` : `matches or beats your 90d longest.`,
      action: null,
    });
  }

  // --- Recent 30d PR (last 7 days) ---
  if (personal_records?.last_30d && timeseries?.length) {
    const last7 = timeseries.slice(-7);
    const p = personal_records.last_30d;
    const rec = p.highest_recovery?.date;
    const hrv = p.highest_hrv?.date;
    const recentDates = new Set(last7.map((d) => d.date));
    if (rec && recentDates.has(rec)) {
      out.push({
        kind: 'good',
        category: 'MILESTONE',
        headline: `New 30d recovery high of ${p.highest_recovery.val}% this week.`,
        detail: `on ${rec}.`,
        action: null,
      });
    } else if (hrv && recentDates.has(hrv)) {
      out.push({
        kind: 'good',
        category: 'MILESTONE',
        headline: `New 30d HRV high of ${p.highest_hrv.val}ms this week.`,
        detail: `on ${hrv}.`,
        action: null,
      });
    }
  }

  // --- Strain-recovery resilience (last 30d) ---
  if (timeseries?.length) {
    const last30 = timeseries.slice(-30).filter((p) => p.strain != null && p.recovery != null);
    if (last30.length >= 10) {
      const hiStrain = last30.filter((p) => p.strain >= 14);
      if (hiStrain.length >= 5) {
        const resilient = hiStrain.filter((p) => p.recovery >= 67).length;
        const dug = hiStrain.filter((p) => p.recovery < 34).length;
        const resPct = Math.round((resilient / hiStrain.length) * 100);
        const dugPct = Math.round((dug / hiStrain.length) * 100);
        if (resPct >= 40) {
          out.push({
            kind: 'good',
            category: 'RESILIENCE',
            headline: `Handled high strain with high recovery ${resPct}% of the time.`,
            detail: `${resilient} of ${hiStrain.length} high-strain days scored green — strong adaptation.`,
            action: `current load is well-matched to your capacity · hold steady.`,
          });
        } else if (dugPct >= 40) {
          out.push({
            kind: 'warn',
            category: 'RESILIENCE',
            headline: `Digging into reserves ${dugPct}% of high-strain days.`,
            detail: `${dug} of ${hiStrain.length} high-strain days followed by red recovery.`,
            action: `insert a deload week — cut volume 30% until red-after-strain drops.`,
          });
        }
      }
    }
  }

  // --- Top correlation driver ---
  if (correlations?.correlations_with_recovery) {
    const c = correlations.correlations_with_recovery;
    // Note: same-day HRV is excluded here — it's a component of the recovery
    // score itself, so correlating them is tautological, not a behavioral lever.
    const labeled = [
      ['sleep performance', c.sleep_perf__recovery],
      ['sleep duration', c.sleep_hours__recovery],
      ['deep sleep', c.deep_hours__recovery],
      ['REM sleep', c.rem_hours__recovery],
      [`yesterday's strain`, c.prev_day_strain__recovery],
    ].filter(([, v]) => v != null);
    if (labeled.length) {
      labeled.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      const [topLabel, topR] = labeled[0];
      if (Math.abs(topR) >= 0.3) {
        const actionMap = {
          'sleep performance': 'prioritize sleep quality — biggest personal lever.',
          'sleep duration': 'extend sleep by 30–45 min · biggest personal lever.',
          'deep sleep': 'bedtime consistency and a cool room drive deep sleep up.',
          'REM sleep': 'avoid alcohol near bedtime — REM is your top driver.',
          [`yesterday's strain`]: 'cap strain on hard days — overreach bleeds into next-day recovery.',
        };
        out.push({
          kind: 'neutral',
          category: 'DRIVER',
          headline: topR > 0
            ? `${topLabel} is the strongest lift on your recovery (r=${topR}).`
            : `${topLabel} is the strongest drag on your recovery (r=${topR}).`,
          detail: `across ${correlations.n_pairs} paired days.`,
          action: actionMap[topLabel] || null,
        });
      }
    }
  }

  // --- Day-of-week pattern ---
  if (day_of_week?.length) {
    const valid = day_of_week.filter((d) => d.avg_recovery != null && d.n >= 3);
    if (valid.length >= 5) {
      const sorted = [...valid].sort((a, b) => b.avg_recovery - a.avg_recovery);
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      const spread = best.avg_recovery - worst.avg_recovery;
      if (spread >= 12) {
        out.push({
          kind: 'neutral',
          category: 'PATTERN',
          headline: `${best.day}s are your peak recovery day (${best.avg_recovery}%).`,
          detail: `${worst.day}s worst at ${worst.avg_recovery}% — ${Math.round(spread)}pt spread.`,
          action: `plan high-intensity on ${best.day}s · recovery/zone-2 on ${worst.day}s.`,
        });
      }
    }
  }

  // --- Sort: alert > warn > good > neutral ---
  const rank = { alert: 0, warn: 1, good: 2, neutral: 3 };
  out.sort((a, b) => rank[a.kind] - rank[b.kind]);

  return out;
}

export { compute };
