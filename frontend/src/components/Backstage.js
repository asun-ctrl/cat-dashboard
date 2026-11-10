import React from 'react';
import { ago, fmt } from '../lib';

export function RobotPanel({ robot, sync }) {
  const lvl = robot?.waste_drawer_level;
  const color = lvl == null ? '#C9CED9' : lvl >= 85 ? '#C2412D' : lvl >= 65 ? '#E0A526' : '#2E8B57';
  return (
    <div className="panel">
      <h3 className="panel-title">Litter-Robot</h3>
      <p className="panel-sub">{robot?.is_online === 0 ? 'Offline. Check its power and Wi-Fi.' : 'Online and reporting.'}</p>
      <div className="meter" role="img" aria-label={`Waste drawer ${lvl ?? 'unknown'} percent full`}>
        <div style={{ width: `${lvl || 0}%`, background: color }} />
      </div>
      <div className="kv"><span>Waste drawer</span><span>{lvl != null ? `${Math.round(lvl)}% full` : '--'}</span></div>
      {robot?.litter_level && <div className="kv"><span>Litter level</span><span>{Math.round(Number(robot.litter_level)) || robot.litter_level}%</span></div>}
      <div className="kv"><span>Last update</span><span>{sync?.last_sync ? ago(sync.last_sync) : '--'}</span></div>
      <div className="kv"><span>History saved since</span><span>{sync?.first_visit ? fmt.day(sync.first_visit) : '--'}</span></div>
    </div>
  );
}

export function AlertsPanel({ data }) {
  const ch = data?.channels || {};
  const on = [ch.ntfy && 'phone push', ch.sms && 'text'].filter(Boolean);
  const sev = { critical: 'concern', warning: 'watch', info: 'info' };
  return (
    <div className="panel">
      <h3 className="panel-title">Alerts</h3>
      <p className="panel-sub">{on.length ? `Sent to you by ${on.join(' and ')}.` : 'Shown here for now. Phone notifications can be turned on later.'}</p>
      {!data?.alerts?.length && <p className="empty">Nothing needs your attention.</p>}
      {data?.alerts?.slice(0, 4).map(a => (
        <div key={a.id} className="alert-item">
          <span className={`badge ${sev[a.severity] === 'concern' ? '' : 'quiet'}`}>{a.severity === 'critical' ? 'Urgent' : a.severity === 'warning' ? 'Heads up' : 'FYI'}</span>
          <b>{a.title}</b>
          <p>{a.message}</p>
          <time>{fmt.time(a.created_at)}</time>
        </div>
      ))}
    </div>
  );
}

export function QualityPanel({ q }) {
  return (
    <div className="panel">
      <h3 className="panel-title">How we cleaned the data</h3>
      <p className="panel-sub">Last 30 days. Nothing is deleted. Odd readings are set aside so they don't skew the charts.</p>
      {q && <>
        <div className="kv"><span>Visits recorded</span><span>{q.visits}</span></div>
        <div className="kv"><span>Odd weight readings set aside</span><span>{q.weight_outliers}</span></div>
        <div className="kv"><span>Tagged as the wrong cat</span><span>{q.mislabeled}</span></div>
        <div className="kv"><span>Untagged, matched by weight</span><span>{q.inferred}</span></div>
        <div className="kv"><span>Untagged, couldn't match</span><span>{Math.max(0, q.unidentified - q.inferred)}</span></div>
        <div className="kv"><span>Your corrections</span><span>{q.manual}</span></div>
      </>}
    </div>
  );
}
