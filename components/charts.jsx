import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ComposedChart,
} from 'recharts';

const AXIS = { stroke: '#2a2a2a', strokeWidth: 1 };
const GRID = { stroke: '#1e1e1e', strokeDasharray: '0' };

function pickEveryN(data, n) {
  // For x-axis tick labels — show ~6 ticks max regardless of range.
  if (!data?.length) return [];
  const step = Math.max(1, Math.floor(data.length / 6));
  return data.filter((_, i) => i % step === 0).map((d) => d.date);
}

function shortDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

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
          <Tooltip
            labelFormatter={(l) => shortDate(l)}
            contentStyle={{ background: '#0f0f0f', border: '1px solid #2a2a2a' }}
          />
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
          <Tooltip labelFormatter={(l) => shortDate(l)} contentStyle={{ background: '#0f0f0f', border: '1px solid #2a2a2a' }} />
          <Line yAxisId="hrv" type="monotone" dataKey="hrv" stroke="#34d399" strokeWidth={1.5} dot={false} name="HRV (ms)" />
          <Line yAxisId="rhr" type="monotone" dataKey="rhr" stroke="#fb923c" strokeWidth={1.5} dot={false} name="RHR (bpm)" />
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
          <Tooltip labelFormatter={(l) => shortDate(l)} contentStyle={{ background: '#0f0f0f', border: '1px solid #2a2a2a' }} />
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
          <Tooltip cursor={{ strokeDasharray: '2 2' }} contentStyle={{ background: '#0f0f0f', border: '1px solid #2a2a2a' }} />
          <Scatter data={filtered} fill="#d4ff4a" fillOpacity={0.55} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
