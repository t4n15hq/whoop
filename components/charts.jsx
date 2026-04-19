import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ComposedChart,
} from 'recharts';

const AXIS = { stroke: '#2a2a2a', strokeWidth: 1 };
const GRID = { stroke: '#1e1e1e', strokeDasharray: '0' };
const TIP = { background: '#0f0f0f', border: '1px solid #2a2a2a' };

function pickEveryN(data, n) {
  if (!data?.length) return [];
  const step = Math.max(1, Math.floor(data.length / 6));
  return data.filter((_, i) => i % step === 0).map((d) => d.date);
}

function shortDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// ---- original charts ----

export function RecoveryStrainChart({ data }) {
  const ticks = pickEveryN(data);
  return (
    <div className="chart-wrap tall">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="date" ticks={ticks} tickFormatter={shortDate} {...AXIS} tickLine={false} />
          <YAxis yAxisId="rec" domain={[0, 100]} {...AXIS} tickLine={false} width={32} />
          <YAxis yAxisId="strain" orientation="right" domain={[0, 21]} {...AXIS} tickLine={false} width={32} />
          <Tooltip labelFormatter={(l) => shortDate(l)} contentStyle={TIP} />
          <ReferenceLine yAxisId="rec" y={67} stroke="#4ade80" strokeDasharray="2 4" strokeWidth={1} />
          <ReferenceLine yAxisId="rec" y={34} stroke="#f87171" strokeDasharray="2 4" strokeWidth={1} />
          <Area yAxisId="rec" type="monotone" dataKey="recovery" stroke="#d4ff4a" fill="rgba(212,255,74,0.10)" strokeWidth={1.5} dot={false} name="recovery %" />
          <Line yAxisId="strain" type="monotone" dataKey="strain" stroke="#60a5fa" strokeWidth={1.5} dot={false} name="strain" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HRVRHRChart({ data }) {
  const ticks = pickEveryN(data);
  return (
    <div className="chart-wrap">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="date" ticks={ticks} tickFormatter={shortDate} {...AXIS} tickLine={false} />
          <YAxis yAxisId="hrv" {...AXIS} tickLine={false} width={32} />
          <YAxis yAxisId="rhr" orientation="right" {...AXIS} tickLine={false} width={32} />
          <Tooltip labelFormatter={(l) => shortDate(l)} contentStyle={TIP} />
          <Line yAxisId="hrv" type="monotone" dataKey="hrv" stroke="#34d399" strokeWidth={1.5} dot={false} name="HRV (ms)" />
          <Line yAxisId="hrv" type="monotone" dataKey="hrv_7d_avg" stroke="#34d399" strokeWidth={1} dot={false} name="HRV 7d avg" strokeDasharray="4 3" />
          <Line yAxisId="rhr" type="monotone" dataKey="rhr" stroke="#fb923c" strokeWidth={1.5} dot={false} name="RHR (bpm)" />
          <Line yAxisId="rhr" type="monotone" dataKey="rhr_7d_avg" stroke="#fb923c" strokeWidth={1} dot={false} name="RHR 7d avg" strokeDasharray="4 3" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SleepHoursChart({ data }) {
  const ticks = pickEveryN(data);
  return (
    <div className="chart-wrap">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="date" ticks={ticks} tickFormatter={shortDate} {...AXIS} tickLine={false} />
          <YAxis {...AXIS} tickLine={false} width={32} />
          <Tooltip labelFormatter={(l) => shortDate(l)} contentStyle={TIP} />
          <ReferenceLine y={8} stroke="#4a4a4a" strokeDasharray="2 4" strokeWidth={1} />
          <Bar dataKey="sleep_hours" fill="#a78bfa" opacity={0.85} name="hours asleep" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StrainRecoveryScatter({ data }) {
  const filtered = data.filter((d) => d.strain != null && d.recovery != null);
  return (
    <div className="chart-wrap">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 10, right: 12, left: 0, bottom: 12 }}>
          <CartesianGrid {...GRID} />
          <XAxis type="number" dataKey="strain" name="strain" domain={[0, 21]} {...AXIS} tickLine={false}
            label={{ value: 'strain', position: 'insideBottom', offset: -4, fill: '#7a7a7a', fontSize: 10 }} />
          <YAxis type="number" dataKey="recovery" name="recovery" domain={[0, 100]} {...AXIS} tickLine={false} width={32} />
          <Tooltip cursor={{ strokeDasharray: '2 2' }} contentStyle={TIP} />
          <Scatter data={filtered} fill="#d4ff4a" fillOpacity={0.55} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---- new charts ----

export function SleepStageAreaChart({ data }) {
  const last30 = data.slice(-30);
  const hasStageData = last30.some((d) => d.deep_hours != null || d.rem_hours != null || d.light_hours != null);
  if (!hasStageData) return <div style={{ color: '#4a4a4a', padding: '20px 0' }}>// awaiting sync — sleep stage data will appear after next cron run</div>;
  const ticks = pickEveryN(last30);
  return (
    <div className="chart-wrap">
      <ResponsiveContainer>
        <AreaChart data={last30} margin={{ top: 10, right: 12, left: 0, bottom: 0 }} stackOffset="none">
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="date" ticks={ticks} tickFormatter={shortDate} {...AXIS} tickLine={false} />
          <YAxis {...AXIS} tickLine={false} width={32} />
          <Tooltip labelFormatter={(l) => shortDate(l)} contentStyle={TIP} />
          <Area type="monotone" dataKey="deep_hours" stackId="1" stroke="#1e3a8a" fill="#1e3a8a" fillOpacity={0.85} name="deep (h)" />
          <Area type="monotone" dataKey="rem_hours" stackId="1" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.75} name="REM (h)" />
          <Area type="monotone" dataKey="light_hours" stackId="1" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.5} name="light (h)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrainingLoadChart({ data }) {
  if (!data?.length) return <div style={{ color: '#4a4a4a' }}>// not enough data</div>;
  const ticks = pickEveryN(data);
  return (
    <div className="chart-wrap">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="date" ticks={ticks} tickFormatter={shortDate} {...AXIS} tickLine={false} />
          <YAxis domain={[0, 2]} {...AXIS} tickLine={false} width={32} />
          <Tooltip labelFormatter={(l) => shortDate(l)} contentStyle={TIP} />
          {/* Zone bands */}
          <ReferenceLine y={0.8} stroke="#60a5fa" strokeDasharray="2 4" strokeWidth={1} />
          <ReferenceLine y={1.3} stroke="#4ade80" strokeDasharray="2 4" strokeWidth={1} />
          <ReferenceLine y={1.5} stroke="#f87171" strokeDasharray="2 4" strokeWidth={1} />
          <Area type="monotone" dataKey="acwr" stroke="#d4ff4a" fill="rgba(212,255,74,0.08)" strokeWidth={1.5} dot={false} name="ACWR" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RecoveryCalendarHeatmap({ data }) {
  // data = timeseries array [{date, recovery, ...}]
  // Show last 90 days in a 7-row (Sun-Sat) × ~13 columns grid
  const last90 = data.slice(-90);
  if (!last90.length) return <div style={{ color: '#4a4a4a' }}>// not enough data</div>;

  // Build a date→recovery map
  const map = {};
  for (const p of last90) if (p.recovery != null) map[p.date] = p.recovery;

  // Find the start date and pad to Sunday
  const startDate = new Date(last90[0].date + 'T00:00:00');
  const startDay = startDate.getDay();
  const gridStart = new Date(startDate);
  gridStart.setDate(gridStart.getDate() - startDay);

  const cells = [];
  const d = new Date(gridStart);
  const endDate = new Date(last90[last90.length - 1].date + 'T00:00:00');
  endDate.setDate(endDate.getDate() + 1);

  while (d <= endDate) {
    const key = d.toISOString().slice(0, 10);
    const val = map[key] ?? null;
    cells.push({ date: key, recovery: val, dow: d.getDay() });
    d.setDate(d.getDate() + 1);
  }

  // Group into weeks (columns)
  const weeks = [];
  let week = [];
  for (const c of cells) {
    week.push(c);
    if (c.dow === 6) { weeks.push(week); week = []; }
  }
  if (week.length) weeks.push(week);

  const cellColor = (r) => {
    if (r == null) return '#1a1a1a';
    if (r >= 67) return '#166534';
    if (r >= 34) return '#854d0e';
    return '#991b1b';
  };

  const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="calendar-heatmap">
      <div className="cal-labels">
        {DAYS.map((d, i) => <div key={i} className="cal-label">{d}</div>)}
      </div>
      <div className="cal-grid">
        {weeks.map((w, wi) => (
          <div key={wi} className="cal-col">
            {w.map((c, ci) => (
              <div
                key={ci}
                className="cal-cell"
                style={{ background: cellColor(c.recovery) }}
                data-tooltip={`${shortDate(c.date)}  ${c.recovery != null ? c.recovery + '%' : '—'}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function WeekdayHeatmap({ data, metric = 'avg_recovery' }) {
  // data = [{day, avg_recovery, avg_strain, avg_sleep_hours, avg_hrv, n}]
  if (!data?.length) return null;

  const vals = data.map((d) => d[metric]).filter((v) => v != null);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const intensity = (v) => {
    if (v == null) return 0.1;
    return 0.15 + ((v - min) / range) * 0.85;
  };

  const colorForMetric = {
    avg_recovery: '#4ade80',
    avg_strain: '#60a5fa',
    avg_sleep_hours: '#a78bfa',
    avg_hrv: '#34d399',
  };
  const color = colorForMetric[metric] || '#d4ff4a';

  return (
    <div className="weekday-heatmap">
      {data.map((d) => (
        <div key={d.day} className="wd-cell" style={{ background: color, opacity: intensity(d[metric]) }}>
          <div className="wd-day">{d.day}</div>
          <div className="wd-val">{d[metric] ?? '—'}</div>
        </div>
      ))}
    </div>
  );
}
