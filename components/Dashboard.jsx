'use client';
import React, { useEffect, useState } from 'react';
import { SectionHead, Panel, Bar, Delta, KV, fmt } from './ui.jsx';
import {
  RecoveryStrainChart, HRVRHRChart, SleepHoursChart, StrainRecoveryScatter,
  SleepStageAreaChart, TrainingLoadChart, RecoveryCalendarHeatmap, WeekdayHeatmap,
} from './charts.jsx';

const ENDPOINT = '/api/whoop';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }
    load();
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  if (error) return <div className="state">// error: {error}</div>;
  if (!data) return <div className="state"><span className="blink">// loading telemetry</span></div>;

  const t = data.today || {};
  const s = t.sleep;
  const dw = data.trends?.delta_week || {};
  const rec = data.recovery || {};
  const slp = data.sleep || {};
  const str = data.strain || {};
  const wk = data.workout || {};
  const corr = data.correlations || {};
  const ts = data.timeseries || [];
  const rd = data.readiness || {};
  const sk = data.streaks || {};
  const dow = data.day_of_week || [];
  const sdt = data.sleep_debt_trend || {};
  const tl = data.training_load || {};
  const pr = data.personal_records || {};
  const vt = data.vital_trends || {};
  const pct = data.percentiles || {};
  const ins = Array.isArray(data.insights) ? data.insights : [];

  const generatedAge = Math.round((Date.now() - new Date(data.generated_at).getTime()) / 60000);
  const stale = generatedAge > 8 * 60;

  const readinessBandClass = rd.band === 'OPTIMAL' ? 'band-GREEN' : rd.band === 'MODERATE' ? 'band-YELLOW' : rd.band === 'LOW' ? 'band-RED' : '';
  const acwrZoneColor = tl.zone === 'OPTIMAL' ? 'var(--green)' : tl.zone === 'DETRAINING' ? 'var(--strain)' : tl.zone === 'OVERREACHING' ? 'var(--yellow)' : tl.zone === 'DANGER' ? 'var(--red)' : 'var(--text-dim)';

  return (
    <div className="app">
      {/* ─────────── top bar ─────────── */}
      <header className="topbar">
        <div className="brand">
          <strong>WHOOP</strong><span className="slash">·</span>
          <span style={{ color: 'var(--text-faint)' }}>
            {data.profile?.name?.toLowerCase() || 'quantified self'}
          </span>
        </div>
        <div className="meta">
          <div>
            <span className={'dot ' + (stale ? 'stale' : '')} />
            last sync {generatedAge < 60 ? `${generatedAge}m ago` : `${(generatedAge / 60).toFixed(1)}h ago`}
          </div>
          <div style={{ color: 'var(--text-faint)' }}>
            {data.counts.cycles}c · {data.counts.sleeps}s · {data.counts.workouts}w
          </div>
        </div>
      </header>

      {/* ─────────── 01 today ─────────── */}
      <section className="section">
        <SectionHead num="01" title="Today" right={t.cycle_start ? (
          <span suppressHydrationWarning>
            {new Date(t.cycle_start).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {t.cycle_in_progress && <span className="pending-badge" title="WHOOP scores this cycle after you wake up — values update once the cycle closes."> · in progress</span>}
          </span>
        ) : ''} />
        <div className="hero">
          <div className={'cell band-' + (t.recovery_band || '')}>
            <div className="label">Recovery</div>
            <div className="value">
              {t.recovery_score ?? '—'}<span className="unit">%</span>
            </div>
            <div className="sub">
              <span className={'band-dot band-' + t.recovery_band} />
              <span>{t.recovery_band || '—'}</span>
              <Delta pct={dw.recovery?.pct_change} />
              {pct.recovery != null && <span className="percentile">P{pct.recovery}</span>}
            </div>
          </div>
          <div className="cell">
            <div className="label">Day Strain</div>
            <div className="value" style={{ color: 'var(--strain)' }}>{fmt(t.strain, 1)}</div>
            <div className="sub">
              <Bar pct={(t.strain ?? 0) / 21 * 100} color="strain" />
              <Delta pct={dw.strain?.pct_change} />
              {pct.strain != null && <span className="percentile">P{pct.strain}</span>}
            </div>
          </div>
          <div className="cell">
            <div className="label">HRV</div>
            <div className="value">{fmt(t.hrv_ms, 1)}<span className="unit">ms</span></div>
            <div className="sub">
              baseline {fmt(rec.hrv_baseline_60d_ms, 1)} ms
              <Delta pct={rec.hrv_vs_baseline_pct} />
              {pct.hrv != null && <span className="percentile">P{pct.hrv}</span>}
            </div>
          </div>
          <div className="cell">
            <div className="label">Sleep</div>
            <div className="value">{fmt(s?.hours_asleep, 1)}<span className="unit">h</span></div>
            <div className="sub">
              perf {fmt(s?.performance_pct, 0)}%
              <Delta pct={dw.sleep_perf?.pct_change} />
              {pct.sleep_hours != null && <span className="percentile">P{pct.sleep_hours}</span>}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────── 02 signals / auto read-out ─────────── */}
      {ins.length > 0 && (
        <section className="section">
          <SectionHead
            num="02"
            title="Signals"
            right={(() => {
              const warn = ins.filter((x) => x.kind === 'alert' || x.kind === 'warn').length;
              const good = ins.filter((x) => x.kind === 'good').length;
              const parts = [];
              if (warn) parts.push(`${warn} watch`);
              if (good) parts.push(`${good} positive`);
              return parts.join(' · ') || `${ins.length} observations`;
            })()}
          />
          <div className="insights">
            {ins.map((x, i) => (
              <div className="insight-row" key={i}>
                <span className={'insight-bar ' + x.kind} />
                <span className="insight-cat">{x.category}</span>
                <div className="insight-body">
                  <div className="insight-head">{x.headline}</div>
                  {x.detail && <div className="insight-detail">{x.detail}</div>}
                  {x.action && <div className="insight-action">{x.action}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─────────── 03 readiness ─────────── */}
      {rd.score != null && (
        <section className="section">
          <SectionHead num="03" title="Readiness" right="composite score" />
          <div className="grid-2">
            <Panel title="Daily readiness">
              <div className="readiness-hero">
                <div className={`readiness-score ${readinessBandClass}`}>{rd.score}</div>
                <div className="readiness-band" style={{ color: readinessBandClass ? undefined : 'var(--text-dim)' }}>
                  {rd.band || '—'}
                </div>
              </div>
              <div style={{ height: 16 }} />
              <KV rows={[
                ['recovery (35%)', fmt(rd.components?.recovery?.value, 0) + '%'],
                ['HRV vs baseline (25%)', fmt(rd.components?.hrv_vs_baseline?.value, 0) + '%'],
                ['sleep perf (25%)', fmt(rd.components?.sleep_performance?.value, 0) + '%'],
                ['sleep debt (15%)', fmt(rd.components?.sleep_debt?.debt_hours, 2) + 'h penalty', { dim: true }],
              ]} />
            </Panel>
            <Panel title="Training load (ACWR)" right={tl.zone || '—'}>
              <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', marginBottom: 4 }}>
                <span style={{ color: acwrZoneColor }}>{tl.acwr ?? '—'}</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 12 }}>
                acute 7d: {fmt(tl.acute_7d_strain, 2)} · chronic 28d: {fmt(tl.chronic_28d_strain, 2)}
              </div>
              <KV rows={[
                ['zone', <span key="z" style={{ color: acwrZoneColor }}>{tl.zone || '—'}</span>],
                ['< 0.8', 'detraining', { dim: true }],
                ['0.8 – 1.3', 'optimal', { dim: true }],
                ['1.3 – 1.5', 'overreaching', { dim: true }],
                ['> 1.5', 'danger', { dim: true }],
              ]} />
            </Panel>
          </div>
        </section>
      )}

      {/* ─────────── 03 vitals ─────────── */}
      <section className="section">
        <SectionHead num="04" title="Vitals" />
        <div className="grid-3">
          <Panel title="Resting HR" right="bpm">
            <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', marginBottom: 8 }}>
              {t.resting_hr ?? '—'}
            </div>
            <KV rows={[
              ['30d avg', fmt(rec.avg_rhr_bpm, 1) + ' bpm'],
              ['wk vs prev', <Delta key="d" pct={dw.rhr?.pct_change} invert />],
              ['max HR', (data.body?.max_heart_rate ?? '—') + ' bpm', { dim: true }],
              ...(pct.rhr != null ? [['percentile', 'P' + pct.rhr]] : []),
            ]} />
          </Panel>
          <Panel title="SpO₂" right="%">
            <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', marginBottom: 8 }}>
              {t.spo2_pct ?? '—'}
              {vt.spo2?.deviation_flag && <span className="deviation-flag">⚠</span>}
            </div>
            <KV rows={[
              ['status', t.spo2_pct == null ? '—' : t.spo2_pct >= 95 ? 'NORMAL' : t.spo2_pct >= 92 ? 'LOW' : 'ALERT'],
              ['30d avg', fmt(vt.spo2?.avg_30d, 2) + '%'],
              ['30d stddev', fmt(vt.spo2?.stddev_30d, 2) + '%', { dim: true }],
              ['target', '≥ 95%', { dim: true }],
            ]} />
          </Panel>
          <Panel title="Skin Temp" right="°C">
            <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', marginBottom: 8 }}>
              {t.skin_temp_c ?? '—'}
              {vt.skin_temp?.deviation_flag && <span className="deviation-flag">⚠</span>}
            </div>
            <KV rows={[
              ['30d avg', fmt(vt.skin_temp?.avg_30d, 2) + '°C'],
              ['30d stddev', fmt(vt.skin_temp?.stddev_30d, 2) + '°C', { dim: true }],
              ['respiratory rate', fmt(s?.respiratory_rate, 2) + ' bpm'],
              ['weight', fmt(data.body?.weight_kg, 1) + ' kg (' + fmt(data.body?.weight_lb, 1) + ' lb)', { dim: true }],
            ]} />
          </Panel>
        </div>
      </section>

      {/* ─────────── 04 recovery × strain timeseries ─────────── */}
      <section className="section">
        <SectionHead num="05" title="Recovery × Strain · 180d" right={`n=${ts.length}`} />
        <Panel title="recovery % overlaid with day strain" right="dashed = 67/34 recovery thresholds">
          <RecoveryStrainChart data={ts} />
        </Panel>
      </section>

      {/* ─────────── 05 HRV/RHR + sleep hours ─────────── */}
      <section className="section">
        <SectionHead num="06" title="Autonomic & Sleep trendlines" />
        <div className="grid-2">
          <Panel title="HRV (ms) · RHR (bpm) · 180d" right="dashed = 7d rolling avg">
            <HRVRHRChart data={ts} />
          </Panel>
          <Panel title="Hours asleep · 180d" right="dashed = 8h target">
            <SleepHoursChart data={ts} />
          </Panel>
        </div>
      </section>

      {/* ─────────── 06 training load ─────────── */}
      {tl.series?.length > 0 && (
        <section className="section">
          <SectionHead num="07" title="Training Load · ACWR" right={`acute:chronic = ${tl.acwr ?? '—'}`} />
          <Panel title="Acute:Chronic Workload Ratio" right="0.8 = detraining · 1.3 = optimal ceiling · 1.5 = danger">
            <TrainingLoadChart data={tl.series} />
          </Panel>
        </section>
      )}

      {/* ─────────── 07 sleep deep-dive ─────────── */}
      <section className="section">
        <SectionHead num="08" title="Sleep" right={`${slp.last_30_nights || 0} nights`} />
        <div className="grid-2">
          <Panel title="Last night · stage composition">
            {s?.stage_pct && s.hours_asleep ? (
              <>
                <div className="stage-bar">
                  <span className="s-awake" style={{ flex: s.hours_awake }}>awake</span>
                  <span className="s-light" style={{ flex: s.hours_light }}>light</span>
                  <span className="s-rem" style={{ flex: s.hours_rem }}>rem</span>
                  <span className="s-deep" style={{ flex: s.hours_deep }}>deep</span>
                </div>
                <div style={{ height: 16 }} />
                <KV rows={[
                  ['in bed', fmt(s.hours_in_bed, 2) + ' h'],
                  ['asleep', fmt(s.hours_asleep, 2) + ' h'],
                  ['awake', fmt(s.hours_awake, 2) + ' h', { dim: true }],
                  ['light', `${fmt(s.hours_light, 2)} h  (${s.stage_pct.light}%)`],
                  ['deep', `${fmt(s.hours_deep, 2)} h  (${s.stage_pct.deep}%)`],
                  ['rem', `${fmt(s.hours_rem, 2)} h  (${s.stage_pct.rem}%)`],
                  ['disturbances', s.disturbances],
                  ['cycles', s.sleep_cycles],
                  ['efficiency', fmt(s.efficiency_pct, 1) + ' %'],
                  ['debt', fmt(s.debt_hours, 2) + ' h', { dim: true }],
                ]} />
              </>
            ) : <div style={{ color: 'var(--text-dim)' }}>// no scored sleep yet</div>}
          </Panel>
          <Panel title="30d profile">
            <KV rows={[
              ['avg performance', fmt(slp.avg_performance_pct, 1) + ' %'],
              ['avg efficiency', fmt(slp.avg_efficiency_pct, 1) + ' %'],
              ['avg debt', fmt(slp.avg_debt_hours, 2) + ' h'],
              ['light (30d)', (slp.stage_distribution_30d?.light_pct ?? '—') + ' %'],
              ['deep (30d)', (slp.stage_distribution_30d?.deep_pct ?? '—') + ' %'],
              ['rem (30d)', (slp.stage_distribution_30d?.rem_pct ?? '—') + ' %'],
              ['avg disturbances', fmt(slp.stage_distribution_30d?.avg_disturbances_per_night, 1) + ' /night'],
              ['bedtime stddev', fmt(slp.bedtime?.stddev_hours, 2) + ' h'],
              ['bedtime rating', slp.bedtime?.consistency_rating],
              ['naps (30d)', slp.naps?.last_30_days],
            ]} />
          </Panel>
        </div>
        {/* Sleep stages stacked area + debt trend */}
        <div className="grid-2" style={{ marginTop: 24 }}>
          <Panel title="Sleep architecture · 30d" right="stacked deep/REM/light">
            <SleepStageAreaChart data={ts} />
          </Panel>
          {sdt.direction && (
            <Panel title="Sleep debt trend · 14d" right={sdt.direction}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span className={`debt-arrow ${sdt.direction === 'RECOVERING' ? 'good' : sdt.direction === 'ACCUMULATING' ? 'bad' : ''}`}>
                  {sdt.direction === 'RECOVERING' ? '↘' : sdt.direction === 'ACCUMULATING' ? '↗' : '→'}
                </span>
                <span style={{ fontSize: 28, fontWeight: 500 }}>{fmt(sdt.current_debt_hours, 2)}<span className="unit">h</span></span>
              </div>
              <KV rows={[
                ['direction', sdt.direction],
                ['14d ago', fmt(sdt.oldest_debt_hours, 2) + ' h'],
                ['now', fmt(sdt.current_debt_hours, 2) + ' h'],
                ['slope/day', fmt(sdt.slope_per_day, 4)],
              ]} />
              <div className="debt-sparkline">
                {sdt.series?.map((v, i) => (
                  <div key={i} className="debt-bar" style={{ height: `${Math.max(4, (v / 3) * 100)}%` }} title={`${v}h`} />
                ))}
              </div>
            </Panel>
          )}
        </div>
      </section>

      {/* ─────────── 08 recovery distribution ─────────── */}
      <section className="section">
        <SectionHead num="09" title="Recovery distribution · 30d" />
        <div className="grid-2">
          <Panel title="Band share">
            {rec.band_pct_30d ? (
              <>
                <div className="stage-bar">
                  <span style={{ flex: rec.band_pct_30d.green, background: 'var(--green)', color: '#0a0a0a' }}>{rec.band_pct_30d.green}% GREEN</span>
                  <span style={{ flex: rec.band_pct_30d.yellow, background: 'var(--yellow)', color: '#0a0a0a' }}>{rec.band_pct_30d.yellow}% YELLOW</span>
                  <span style={{ flex: rec.band_pct_30d.red, background: 'var(--red)', color: '#0a0a0a' }}>{rec.band_pct_30d.red}% RED</span>
                </div>
                <div style={{ height: 16 }} />
                <KV rows={[
                  ['avg recovery', fmt(rec.avg_recovery_score, 1) + ' %'],
                  ['median', fmt(rec.median_recovery_score, 1) + ' %'],
                  ['avg HRV', fmt(rec.avg_hrv_ms, 1) + ' ms'],
                  ['60d HRV baseline', fmt(rec.hrv_baseline_60d_ms, 1) + ' ms'],
                  ['7d HRV current', fmt(rec.hrv_current_7d_ms, 1) + ' ms'],
                  ['HRV vs baseline', <Delta key="h" pct={rec.hrv_vs_baseline_pct} />],
                ]} />
              </>
            ) : <div style={{ color: 'var(--text-dim)' }}>// not enough data</div>}
          </Panel>
          <Panel title="Streaks & best/worst">
            <div className="streak-row">
              <div className="streak-block green">
                <div className="streak-num">{sk.current_green ?? 0}</div>
                <div className="streak-label">green streak</div>
              </div>
              <div className="streak-block">
                <div className="streak-num">{sk.longest_green_90d ?? 0}</div>
                <div className="streak-label">longest (90d)</div>
              </div>
              <div className="streak-block">
                <div className="streak-num">{sk.current_above_yellow ?? 0}</div>
                <div className="streak-label">above red</div>
              </div>
            </div>
            <div style={{ height: 16 }} />
            <KV rows={[
              ['best day', rec.best_day ? `${rec.best_day.date}  ·  ${rec.best_day.score}%` : '—'],
              ['worst day', rec.worst_day ? `${rec.worst_day.date}  ·  ${rec.worst_day.score}%` : '—'],
              ['wk Δ', <Delta key="w" pct={dw.recovery?.pct_change} />],
              ['current wk avg', fmt(dw.recovery?.current, 1) + ' %', { dim: true }],
              ['prev wk avg', fmt(dw.recovery?.previous, 1) + ' %', { dim: true }],
            ]} />
          </Panel>
        </div>
      </section>

      {/* ─────────── 09 recovery calendar ─────────── */}
      <section className="section">
        <SectionHead num="10" title="Recovery calendar · 90d" right="green / yellow / red" />
        <Panel title="recovery heatmap" right="hover for details">
          <RecoveryCalendarHeatmap data={ts} />
        </Panel>
      </section>

      {/* ─────────── 10 strain / calories ─────────── */}
      <section className="section">
        <SectionHead num="11" title="Strain & Energy · 30d" />
        <div className="grid-2">
          <Panel title="Strain profile">
            <KV rows={[
              ['avg strain', fmt(str.avg_strain, 2)],
              ['median', fmt(str.median_strain, 2)],
              ['max', fmt(str.max_strain, 2)],
              ['total calories', (str.total_calories_30d ?? '—').toLocaleString() + ' kcal'],
              ['avg cal / day', (str.avg_calories_per_day ?? '—').toLocaleString() + ' kcal'],
            ]} />
            <div style={{ height: 16 }} />
            <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
              strain bucket distribution
            </div>
            {str.bucket_distribution_30d && (
              <div className="zones">
                {[
                  ['ALLOUT (18+)', str.bucket_distribution_30d.allout, 'z5'],
                  ['STRENUOUS (14-18)', str.bucket_distribution_30d.strenuous, 'z4'],
                  ['MODERATE (10-14)', str.bucket_distribution_30d.moderate, 'z3'],
                  ['LIGHT (0-10)', str.bucket_distribution_30d.light, 'z1'],
                ].map(([label, count, c]) => {
                  const total = str.last_30_days || 1;
                  const pctVal = (count / total) * 100;
                  return (
                    <div className="zone" key={label}>
                      <div className="z-label">{label.split(' ')[0]}</div>
                      <div className="z-track"><div className={'z-fill ' + c} style={{ width: pctVal + '%' }} /></div>
                      <div className="z-val">{count} · {pctVal.toFixed(0)}%</div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
          <Panel title="Strain × Recovery (same day)">
            <StrainRecoveryScatter data={ts} />
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6 }}>
              Each point = one cycle. High strain + high recovery (top-right) = resilient day.
              Low recovery + high strain (bottom-right) = dig into reserves.
            </div>
          </Panel>
        </div>
      </section>

      {/* ─────────── 11 day of week patterns ─────────── */}
      {dow.length > 0 && (
        <section className="section">
          <SectionHead num="12" title="Day-of-Week Patterns · 90d" right="avg by weekday" />
          <div className="grid-2">
            <Panel title="Avg recovery by weekday">
              <WeekdayHeatmap data={dow} metric="avg_recovery" />
              <div style={{ height: 12 }} />
              <table className="data">
                <thead><tr><th>Day</th><th className="n">Recovery</th><th className="n">Strain</th><th className="n">Sleep</th><th className="n">n</th></tr></thead>
                <tbody>
                  {dow.map((d) => (
                    <tr key={d.day}>
                      <td>{d.day}</td>
                      <td className="n">{fmt(d.avg_recovery, 1)}%</td>
                      <td className="n">{fmt(d.avg_strain, 1)}</td>
                      <td className="n">{fmt(d.avg_sleep_hours, 1)}h</td>
                      <td className="n">{d.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <Panel title="Avg strain by weekday">
              <WeekdayHeatmap data={dow} metric="avg_strain" />
              <div style={{ height: 20 }} />
              <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                avg sleep by weekday
              </div>
              <WeekdayHeatmap data={dow} metric="avg_sleep_hours" />
            </Panel>
          </div>
        </section>
      )}

      {/* ─────────── 12 workouts ─────────── */}
      <section className="section">
        <SectionHead num="13" title="Workouts · 30d" right={`n=${wk.last_30_days_count || 0}`} />
        <div className="grid-2">
          <Panel title="Heart-rate zone minutes">
            {wk.hr_zone_minutes_30d && wk.hr_zone_pct_30d ? (
              <div className="zones">
                {['z5', 'z4', 'z3', 'z2', 'z1', 'z0'].map((z) => (
                  <div className="zone" key={z}>
                    <div className="z-label">{z.toUpperCase()}</div>
                    <div className="z-track"><div className={'z-fill ' + z} style={{ width: (wk.hr_zone_pct_30d[z] || 0) + '%' }} /></div>
                    <div className="z-val">{wk.hr_zone_minutes_30d[z]}m · {wk.hr_zone_pct_30d[z]}%</div>
                  </div>
                ))}
              </div>
            ) : <div style={{ color: 'var(--text-dim)' }}>// no zone data</div>}
          </Panel>
          <Panel title="Sport breakdown">
            {wk.sport_breakdown_30d?.length ? (
              <table className="data">
                <thead>
                  <tr>
                    <th>Sport</th>
                    <th className="n">#</th>
                    <th className="n">min</th>
                    <th className="n">kcal</th>
                    <th className="n">avg HR</th>
                  </tr>
                </thead>
                <tbody>
                  {wk.sport_breakdown_30d.slice(0, 8).map((sp) => (
                    <tr key={sp.sport_name}>
                      <td>{sp.sport_name}</td>
                      <td className="n">{sp.count}</td>
                      <td className="n">{sp.total_minutes}</td>
                      <td className="n">{sp.total_calories?.toLocaleString?.() || sp.total_calories}</td>
                      <td className="n">{sp.avg_hr ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div style={{ color: 'var(--text-dim)' }}>// no workouts</div>}
          </Panel>
        </div>
        {wk.biggest_workout_30d && (
          <div style={{ marginTop: 16 }}>
            <Panel title="Biggest workout · 30d">
              <KV rows={[
                ['sport', wk.biggest_workout_30d.sport_name],
                ['date', new Date(wk.biggest_workout_30d.start).toLocaleString()],
                ['duration', wk.biggest_workout_30d.duration_min + ' min'],
                ['strain', wk.biggest_workout_30d.strain],
                ['avg HR', wk.biggest_workout_30d.avg_hr + ' bpm'],
                ['max HR', wk.biggest_workout_30d.max_hr + ' bpm'],
                ['calories', wk.biggest_workout_30d.calories + ' kcal'],
                ['distance', wk.biggest_workout_30d.distance_km ? wk.biggest_workout_30d.distance_km + ' km' : '—', { dim: true }],
              ]} />
            </Panel>
          </div>
        )}
      </section>

      {/* ─────────── 13 personal records ─────────── */}
      {pr.all_time && (
        <section className="section">
          <SectionHead num="14" title="Personal Records" />
          <div className="grid-2">
            <Panel title="All-time bests">
              <KV rows={[
                ['highest HRV', pr.all_time.highest_hrv ? `${fmt(pr.all_time.highest_hrv.val, 1)} ms · ${pr.all_time.highest_hrv.date}` : '—'],
                ['lowest RHR', pr.all_time.lowest_rhr ? `${fmt(pr.all_time.lowest_rhr.val, 0)} bpm · ${pr.all_time.lowest_rhr.date}` : '—'],
                ['best recovery', pr.all_time.highest_recovery ? `${pr.all_time.highest_recovery.val}% · ${pr.all_time.highest_recovery.date}` : '—'],
                ['max strain', pr.all_time.highest_strain ? `${fmt(pr.all_time.highest_strain.val, 2)} · ${pr.all_time.highest_strain.date}` : '—'],
                ['most sleep', pr.all_time.most_sleep ? `${fmt(pr.all_time.most_sleep.val, 2)} h · ${pr.all_time.most_sleep.date}` : '—'],
              ]} />
            </Panel>
            <Panel title="30d bests">
              <KV rows={[
                ['highest HRV', pr.last_30d?.highest_hrv ? `${fmt(pr.last_30d.highest_hrv.val, 1)} ms · ${pr.last_30d.highest_hrv.date}` : '—'],
                ['lowest RHR', pr.last_30d?.lowest_rhr ? `${fmt(pr.last_30d.lowest_rhr.val, 0)} bpm · ${pr.last_30d.lowest_rhr.date}` : '—'],
                ['best recovery', pr.last_30d?.highest_recovery ? `${pr.last_30d.highest_recovery.val}% · ${pr.last_30d.highest_recovery.date}` : '—'],
                ['max strain', pr.last_30d?.highest_strain ? `${fmt(pr.last_30d.highest_strain.val, 2)} · ${pr.last_30d.highest_strain.date}` : '—'],
              ]} />
            </Panel>
          </div>
        </section>
      )}

      {/* ─────────── 14 correlations ─────────── */}
      <section className="section">
        <SectionHead num="15" title="What drives your recovery?" right={`pearson r · n=${corr.n_pairs || 0}`} />
        <Panel title="Correlations with next-day recovery score" right="|r| > 0.3 is meaningful">
          <div>
            {corr.correlations_with_recovery && Object.entries({
              'sleep performance %': corr.correlations_with_recovery.sleep_perf__recovery,
              'hours asleep': corr.correlations_with_recovery.sleep_hours__recovery,
              'deep sleep hours': corr.correlations_with_recovery.deep_hours__recovery,
              'rem sleep hours': corr.correlations_with_recovery.rem_hours__recovery,
              'hrv (same day)': corr.correlations_with_recovery.hrv__recovery,
              "yesterday's strain": corr.correlations_with_recovery.prev_day_strain__recovery,
            }).map(([k, r]) => (
              <div className="corr-row" key={k}>
                <div className="label">{k}</div>
                <div className="viz">
                  {r != null && r >= 0 && <div className="bar-pos" style={{ width: (r * 50) + '%' }} />}
                  {r != null && r < 0 && <div className="bar-neg" style={{ width: (Math.abs(r) * 50) + '%' }} />}
                </div>
                <div className="val">{r == null ? '—' : r.toFixed(3)}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 12 }}>
            Pearson r ∈ [-1, 1]. Positive = that metric rising coincides with higher recovery.
            Interpretation hint: {corr.note}
          </div>
        </Panel>
      </section>

      <div className="footer">
        <span>whoop · v2</span>
        <span>generated {new Date(data.generated_at).toLocaleString()}</span>
      </div>
    </div>
  );
}
