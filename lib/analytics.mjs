// Transforms raw WHOOP records into a rich, opinionated dashboard payload.
// Everything a dashboard or AI briefing could want is computed here once,
// so consumers just read a static JSON file.

const MS_PER_MIN = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MIN;

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
  const sleepByCycle = new Map();
  for (const s of sleeps) if (!s.nap) sleepByCycle.set(s.cycle_id, s);

  const today = buildToday({ cycles, recoveryByCycle, sleepByCycle, workouts });
  const trends = buildTrends({ cycles, recoveries, sleeps, recoveryByCycle, sleepByCycle });
  const sleep = buildSleepAnalytics(sleeps);
  const recovery = buildRecoveryAnalytics(recoveries);
  const strain = buildStrainAnalytics(cycles);
  const workout = buildWorkoutAnalytics(workouts);
  const correlations = buildCorrelations({ cycles, recoveryByCycle, sleepByCycle });
  const timeseries = buildTimeseries({ cycles, recoveryByCycle, sleepByCycle });

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
  const hrvBaseline = mean(last60.map((r) => r.score.hrv_rmssd_milli));
  const hrvCurrent = mean(scoredRecs.slice(0, 7).map((r) => r.score.hrv_rmssd_milli));

  return {
    last_30_days: last30.length,
    avg_recovery_score: round(mean(scores), 1),
    median_recovery_score: round(median(scores), 1),
    avg_hrv_ms: round(mean(hrvSeries), 1),
    avg_rhr_bpm: round(mean(rhrSeries), 1),
    hrv_baseline_60d_ms: round(hrvBaseline, 1),
    hrv_current_7d_ms: round(hrvCurrent, 1),
    hrv_vs_baseline_pct: pctDelta(hrvCurrent, hrvBaseline),
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
    const rs = scored(recoveryByCycle.get(c.id));
    const ss = scored(sleepByCycle.get(c.id));
    points.push({
      date: dayKey(c.start),
      strain: cs ? round(cs.strain, 1) : null,
      recovery: rs?.recovery_score ?? null,
      hrv: rs ? round(rs.hrv_rmssd_milli, 1) : null,
      rhr: rs?.resting_heart_rate ?? null,
      sleep_perf: ss?.sleep_performance_percentage ?? null,
      sleep_hours: ss ? round((ss.stage_summary.total_in_bed_time_milli - ss.stage_summary.total_awake_time_milli) / MS_PER_HOUR, 2) : null,
    });
  }
  // Chronological ascending for nicer charting.
  return points.reverse();
}

export { compute };
