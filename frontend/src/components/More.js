import React, { useEffect, useState } from 'react';
import { API, CATS, ago, catVars, fmt, http, setPasscode, withCode } from '../lib';
import { CatSeg, Icon, PhotoUpload } from './Bits';

const fmtHour = h => { const n = parseInt(h, 10); return Number.isNaN(n) ? h : fmt.hourLong(n); };
const num = (v, unit) => (v == null ? '--' : `${v}${unit ? ` ${unit}` : ''}`);

function RpSpark({ rows, k }) {
  const pts = rows.map((r, i) => [i, r[k]]).filter(p => p[1] != null);
  if (pts.length < 3) return null;
  const ys = pts.map(p => p[1]);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1, w = 90, h = 26;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p[0] / (rows.length - 1 || 1) * (w - 4) + 2).toFixed(1)} ${(h - 3 - ((p[1] - lo) / span) * (h - 6)).toFixed(1)}`).join(' ');
  return <svg className="rp-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={d} fill="none" stroke="var(--cat)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Report({ onBack, startCat, toast }) {
  const [cat, setCat] = useState(startCat || CATS[1]);
  const [days, setDays] = useState(30);
  const [r, setR] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setR(null); setErr(false);
    http.get('/report', { params: { cat, days } }).then(x => live && setR(x.data)).catch(() => live && setErr(true));
    return () => { live = false; };
  }, [cat, days]);

  const share = async () => {
    const lines = [
      `${r.cat}: ${r.period.days}-day summary (${fmt.day(r.period.start)} to ${fmt.day(r.period.end)})`,
      ...r.summary.filter(s => s.value != null).map(s => `${s.label}: ${s.value} ${s.unit} (range ${s.low} to ${s.high})`),
      ...r.findings.filter(f => f.level !== 'good').map(f => `${f.topic}: ${f.title}`),
    ].join('\n');
    try {
      if (navigator.share) await navigator.share({ title: `${r.cat} health summary`, text: lines });
      else { await navigator.clipboard.writeText(lines); toast('Summary copied'); }
    } catch {}
  };
  const p = r?.profile || {};
  const about = [p.gender, p.is_fixed ? 'fixed' : null, (p.breeds || []).join(', ') || null, p.birthday ? `born ${fmt.day(p.birthday)}, ${String(p.birthday).slice(0, 4)}` : null, p.diet ? `diet: ${p.diet}` : null].filter(Boolean).join(' · ');

  return (
    <div style={catVars(cat)}>
      <div className="no-print">
        <button className="pill-btn" onClick={onBack}><Icon name="back" />More</button>
        <h1 className="page-title" style={{ marginTop: 12 }}>Vet visit report</h1>
        <p className="page-sub">One page your vet can scan in a minute. Print it, save it as a PDF, or hand over your phone.</p>
        <CatSeg value={cat} onChange={setCat} />
        <div className="seg sm" role="group" aria-label="How far back" style={{ marginTop: 10 }}>
          {[30, 60, 90].map(n => <button key={n} aria-pressed={days === n} onClick={() => setDays(n)}>{n} days</button>)}
        </div>
        <div className="btn-row">
          <button className="btn-secondary" onClick={() => window.print()} disabled={!r}><Icon name="doc" width="18" height="18" />Print or save PDF</button>
          <button className="btn-secondary" onClick={share} disabled={!r}><Icon name="share" width="18" height="18" />Share summary</button>
        </div>
      </div>
      {err && <p className="offline" style={{ marginTop: 14 }}>Couldn't build the report. Check your connection.</p>}
      {!r && !err && <div className="skeleton" style={{ marginTop: 14 }} />}
      {r && (
        <article className="report">
          <h2>{r.cat}</h2>
          {about && <p className="muted">{about}</p>}
          <p className="muted">{r.period.start ? `${fmt.day(r.period.start)} to ${fmt.day(r.period.end)}, ${r.period.days} days of home monitoring.` : 'No data yet.'} Prepared {fmt.day(r.generated)}.</p>
          {r.status && <p style={{ marginTop: 8, fontWeight: 700 }}>{r.status}</p>}

          <h3>Daily averages</h3>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Measure</th><th className="num">Average</th><th className="num">Range</th><th className="num hide-sm">Prior period</th><th>Trend</th></tr></thead>
              <tbody>
                {r.summary.map(s => (
                  <tr key={s.key}>
                    <td>{s.label}<small>{s.unit}</small></td>
                    <td className="num"><b>{num(s.value)}</b></td>
                    <td className="num">{s.low == null ? '--' : `${s.low} to ${s.high}`}</td>
                    <td className="num hide-sm">{s.prev == null ? '--' : `${s.prev}${s.change_pct != null ? ` (${s.change_pct > 0 ? '+' : ''}${s.change_pct}%)` : ''}`}</td>
                    <td><RpSpark rows={r.daily} k={s.key} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!!r.weeks.length && <>
            <h3>Week by week</h3>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Week of</th><th className="num">Weight</th><th className="num">Pees</th><th className="num">Poops</th><th className="num">Eating</th><th className="num">Water</th></tr></thead>
                <tbody>
                  {r.weeks.map(w => (
                    <tr key={w.start}><td>{fmt.day(w.start)}</td><td className="num">{num(w.weight, 'lb')}</td><td className="num">{num(w.pee)}</td>
                      <td className="num">{num(w.poop)}</td><td className="num">{num(w.eat_min, 'min')}</td><td className="num">{num(w.water, 'mL')}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>Weight is the weekly median. Everything else is the average per day.</p>
          </>}

          <h3>What stands out</h3>
          <ul className="rp-list">
            {r.findings.filter(f => f.level !== 'good').map(f => <li key={f.topic + f.title}><b>{f.topic}: {f.title}</b><br />{f.detail}</li>)}
            {!r.findings.some(f => f.level !== 'good') && <li>Nothing outside the normal range in this period.</li>}
          </ul>

          {!!(r.observations.length + r.notes.length + r.alerts.length) && <>
            <h3>Owner's log</h3>
            <ul className="rp-list">
              {[...r.notes.map(n => ({ day: n.day, t: `${n.kind}: ${n.text}` })),
                ...r.observations.map(o => ({ day: o.day, t: `Seen in the box: ${o.label}${o.note ? `. ${o.note}` : ''}` })),
                ...r.alerts.map(a => ({ day: a.day, t: `Alert: ${a.title}` }))]
                .sort((a, b) => (a.day < b.day ? -1 : 1))
                .map((x, i) => <li key={i}><b>{fmt.day(x.day)}</b>, {x.t}</li>)}
            </ul>
          </>}

          <h3>About this data</h3>
          <ul className="rp-notes">{r.data_notes.map(n => <li key={n}>{n}</li>)}</ul>
        </article>
      )}
    </div>
  );
}

function Devices({ robot, sync, petlibro }) {
  const lvl = robot?.waste_drawer_level;
  const tone = v => (v >= 85 ? 'var(--concern)' : v >= 65 ? 'var(--watch)' : 'var(--good)');
  const feeders = (petlibro?.devices || []).filter(x => x.kind === 'feeder');
  const fountain = (petlibro?.devices || []).find(x => x.kind === 'fountain');
  const pl = sync?.petlibro;
  return (
    <div className="card">
      <h3 className="card-title">Devices</h3>
      <p className="card-sub">{robot?.is_online === 0 ? 'The litter robot is offline. Check its power and Wi-Fi.' : `Litter robot checked ${sync?.last_sync ? ago(sync.last_sync) : 'recently'}.`}
        {pl?.status === 'petlibro_error' ? ' PetLibro is not responding.' : pl?.at ? ` Feeders checked ${ago(pl.at)}.` : ''}</p>
      <div className="meter" role="img" aria-label={`Waste drawer ${lvl ?? 'unknown'} percent full`}><div style={{ width: `${lvl || 0}%`, background: lvl == null ? 'var(--line-strong)' : tone(lvl) }} /></div>
      <div className="kv"><span>Waste drawer</span><span>{lvl != null ? `${Math.round(lvl)}% full` : '--'}</span></div>
      {robot?.litter_level != null && <div className="kv"><span>Litter level</span><span>{Math.round(Number(robot.litter_level)) || robot.litter_level}%</span></div>}
      {feeders.map(f => (
        <div className="kv" key={f.sn}><span>{f.cat ? `${f.cat}'s feeder` : f.name || 'Feeder'}</span>
          <span>{!f.online ? 'Offline' : f.outlet_blocked ? 'Food outlet blocked' : f.food_low ? 'Food running low' : 'Working'}</span></div>
      ))}
      {fountain && <div className="kv"><span>Fountain water</span><span>{fountain.water_percent != null ? `${Math.round(fountain.water_percent)}%` : fountain.online ? '--' : 'Offline'}</span></div>}
      <div className="kv"><span>History saved since</span><span>{sync?.first_visit ? fmt.day(sync.first_visit) : '--'}</span></div>
    </div>
  );
}

function Alerts({ data, toast }) {
  const ch = data?.channels || {};
  const test = async () => {
    try {
      const r = await http.post('/alerts/test');
      toast(r.data.delivered?.length ? 'Sent. Check your phone.' : 'No notification app is connected.');
    } catch (e) { toast(e.response?.status === 429 ? 'Wait a minute before sending another.' : "Couldn't send. Try again."); }
  };
  const label = { critical: 'Urgent', warning: 'Heads up', info: 'FYI' };
  return (
    <div className="card">
      <h3 className="card-title">Notifications</h3>
      <p className="card-sub">
        {ch.ntfy || ch.sms ? 'Sent to your phone when something changes.' : 'Phone notifications are not connected.'}
        {ch.quiet_hours && ` Quiet from ${fmtHour(ch.quiet_hours.split('-')[0])} to ${fmtHour(ch.quiet_hours.split('-')[1])}, except urgent ones.`}
        {ch.digest_hour && ` Daily summary at ${fmtHour(ch.digest_hour)}, weekly story Sundays at 6 PM.`}
      </p>
      {!data?.alerts?.length && <p className="empty">No alerts so far.</p>}
      {data?.alerts?.slice(0, 5).map(a => (
        <div key={a.id} className="alert-item">
          <span className={`badge ${a.severity === 'critical' ? '' : 'quiet'}`} style={{ margin: '0 6px 0 0' }}>{label[a.severity] || 'FYI'}</span><b>{a.title}</b>
          <p>{a.message}</p><time>{fmt.time(a.created_at)}</time>
        </div>
      ))}
      {(ch.ntfy || ch.sms) && <div className="btn-row"><button className="btn-secondary" onClick={test}><Icon name="bell" width="18" height="18" />Send a test</button></div>}
    </div>
  );
}

export default function More({ d, reload, toast, openReport }) {
  const q = d.quality;
  const lock = () => { setPasscode(''); window.dispatchEvent(new Event('lg-locked')); };
  return (
    <>
      <h1 className="page-title">More</h1>
      <div className="card" style={{ marginTop: 14 }}>
        <button className="row-link" onClick={openReport}>
          <span className="row-ico"><Icon name="doc" /></span>
          <div><b>Vet visit report</b><span>A one-page summary to print or share</span></div><Icon name="chev" />
        </button>
        <a className="row-link" href={withCode(`${API}/export.csv`)}>
          <span className="row-ico"><Icon name="download" /></span>
          <div><b>Download all visits</b><span>A spreadsheet file of every litter box trip</span></div><Icon name="chev" />
        </a>
        <button className="row-link" onClick={lock}>
          <span className="row-ico"><Icon name="lock" /></span>
          <div><b>Lock this device</b><span>Ask for the passcode again next time</span></div><Icon name="chev" />
        </button>
      </div>

      <div className="card-grid" style={{ marginTop: 14 }}>
        <Devices robot={d.robot} sync={d.sync} petlibro={d.petlibro} />
        <Alerts data={d.alerts} toast={toast} />
      </div>

      <div className="card-grid" style={{ marginTop: 14 }}>
        <div className="card">
          <h3 className="card-title">Photos</h3>
          <p className="card-sub">Shown on the home screen and the weekly story.</p>
          <div className="btn-row">{CATS.map(c => <PhotoUpload key={c} cat={c} onDone={reload} toast={toast} />)}</div>
        </div>
        <div className="card">
          <h3 className="card-title">How the data is cleaned</h3>
          <p className="card-sub">Last 30 days. Nothing is deleted. Odd readings are set aside so they don't skew the charts.</p>
          {q && <>
            <div className="kv"><span>Visits recorded</span><span>{q.visits}</span></div>
            <div className="kv"><span>Odd weight readings set aside</span><span>{q.weight_outliers}</span></div>
            <div className="kv"><span>Tagged as the wrong cat</span><span>{q.mislabeled}</span></div>
            <div className="kv"><span>Untagged, matched by weight</span><span>{q.inferred}</span></div>
            <div className="kv"><span>Untagged, couldn't match</span><span>{Math.max(0, q.unidentified - q.inferred)}</span></div>
            <div className="kv"><span>Your corrections</span><span>{q.manual}</span></div>
          </>}
        </div>
      </div>

      <details className="card emergency" style={{ marginTop: 14 }}>
        <summary style={{ fontWeight: 700, cursor: 'pointer' }}>When to call a vet right away</summary>
        <ul>{(d.insights.emergency || []).map(e => <li key={e}>{e}</li>)}</ul>
      </details>
    </>
  );
}
