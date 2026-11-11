import React from 'react';
import { ago, fmt, http } from '../lib';

const fmtHour = h => { const n = parseInt(h, 10); return Number.isNaN(n) ? h : fmt.hourLong(n); };

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
  const [testMsg, setTestMsg] = React.useState('');
  const sendTest = async () => {
    setTestMsg('Sending…');
    try {
      const r = await http.post('/alerts/test');
      setTestMsg(r.data.delivered?.length ? 'Sent. Check your phone.' : 'No notification app is connected yet.');
    } catch (e) {
      setTestMsg(e.response?.status === 429 ? 'Wait a minute before sending another.' : "Couldn't send. Try again shortly.");
    }
  };
  const ch = data?.channels || {};
  const on = [ch.ntfy && 'phone push', ch.sms && 'text'].filter(Boolean);
  const sev = { critical: 'concern', warning: 'watch', info: 'info' };
  return (
    <div className="panel">
      <h3 className="panel-title">Alerts</h3>
      <p className="panel-sub">{on.length ? `Sent to you by ${on.join(' and ')}.` : 'Shown here for now. Phone notifications can be turned on later.'}</p>
      {(ch.ntfy || ch.sms) && (
        <p style={{ margin: '4px 0 10px' }}>
          <button className="mini-btn" onClick={sendTest}>Send a test notification</button>
          {testMsg && <span className="vital-note" style={{ marginLeft: 6 }} role="status">{testMsg}</span>}
        </p>
      )}
      {(ch.quiet_hours || ch.digest_hour) && (
        <p className="vital-note" style={{ marginBottom: 8 }}>
          {ch.quiet_hours && `Quiet from ${fmtHour(ch.quiet_hours.split('-')[0])} to ${fmtHour(ch.quiet_hours.split('-')[1])}, except urgent alerts. `}
          {ch.digest_hour && `Daily summary at ${fmtHour(ch.digest_hour)}.`}
        </p>
      )}
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

export function PetlibroPanel({ data, status }) {
  if (!data?.configured && !data?.devices?.length) return null;
  const feeders = (data?.devices || []).filter(d => d.kind === 'feeder');
  const fountain = (data?.devices || []).find(d => d.kind === 'fountain');
  return (
    <div className="panel">
      <h3 className="panel-title">Feeders and fountain</h3>
      <p className="panel-sub">
        {status?.status === 'petlibro_error' ? `PetLibro isn't responding: ${status.message}` :
         status?.at ? `PetLibro, updated ${ago(status.at)}.` : 'Connecting to PetLibro.'}
      </p>
      {feeders.map(f => (
        <div className="kv" key={f.sn}>
          <span>{f.cat ? `${f.cat}'s feeder` : f.name || 'Feeder'}</span>
          <span>{!f.online ? 'Offline' : f.outlet_blocked ? 'Food outlet blocked' : f.food_low ? 'Food running low' : 'OK'}</span>
        </div>
      ))}
      {fountain && (
        <>
          <div className="meter" role="img" aria-label={`Fountain water ${fountain.water_percent ?? 'unknown'} percent`}>
            <div style={{ width: `${fountain.water_percent || 0}%`, background: (fountain.water_percent ?? 100) < 25 ? '#C2412D' : '#4B8FD1' }} />
          </div>
          <div className="kv"><span>Fountain water</span><span>{fountain.water_percent != null ? `${Math.round(fountain.water_percent)}%` : (fountain.online ? '--' : 'Offline')}</span></div>
        </>
      )}
    </div>
  );
}
