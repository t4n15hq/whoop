import React from 'react';

export function SectionHead({ num, title, right }) {
  return (
    <div className="section-head">
      <span className="num">{num}</span>
      <span className="title">{title}</span>
      <span className="rule" />
      {right ? <span className="right">{right}</span> : null}
    </div>
  );
}

export function Panel({ title, right, children, pad = 'md' }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <strong>{title}</strong>
        <span>{right}</span>
      </div>
      <div className={'panel-body' + (pad === 'lg' ? ' pad-lg' : '')}>{children}</div>
    </div>
  );
}

export function Bar({ pct, color = '' }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <span className="bar">
      <span className="track">
        <span className={'fill ' + color} style={{ width: p + '%' }} />
      </span>
    </span>
  );
}

export function Delta({ pct, invert = false }) {
  // invert: true for metrics where DOWN is good (e.g. RHR)
  if (pct == null) return <span className="delta flat">—</span>;
  const good = invert ? pct < 0 : pct > 0;
  const bad  = invert ? pct > 0 : pct < 0;
  const cls = Math.abs(pct) < 2 ? 'flat' : good ? 'up' : bad ? 'down' : 'flat';
  const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '◆';
  return <span className={'delta ' + cls}>{arrow} {Math.abs(pct)}%</span>;
}

export function KV({ rows }) {
  return (
    <div className="kv">
      {rows.map(([k, v, opts], i) => (
        <React.Fragment key={i}>
          <div className="k">{k}</div>
          <div className={'v' + (opts?.dim ? ' dim' : '')}>{v ?? '—'}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

export function fmt(n, d = 1, suffix = '') {
  if (n == null || Number.isNaN(n)) return '—';
  const v = typeof n === 'number' ? n.toFixed(d) : n;
  return v + suffix;
}
