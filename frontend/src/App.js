import React, { useCallback, useEffect, useState } from 'react';
import './styles.css';
import { CATS, catVars, fmt, http } from './lib';
import Hero from './components/Hero';
import Findings from './components/Findings';
import { DurationChart, EatingBlock, RhythmChart, TripsChart, WeightChart } from './components/Charts';
import CheckIn from './components/CheckIn';
import { AlertsPanel, PetlibroPanel, QualityPanel, RobotPanel } from './components/Backstage';
import VisitLog from './components/VisitLog';

export default function App() {
  const [insights, setInsights] = useState(null);
  const [summary, setSummary] = useState(null);
  const [pets, setPets] = useState({});
  const [robot, setRobot] = useState(null);
  const [sync, setSync] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [quality, setQuality] = useState(null);
  const [observations, setObservations] = useState([]);
  const [petlibro, setPetlibro] = useState(null);
  const [selected, setSelected] = useState(CATS[1]);
  const [offline, setOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const [ins, sum, pt, rs, st, al, q, ob] = await Promise.all([
        http.get('/insights'), http.get('/litter/summary'), http.get('/pets'), http.get('/robot/status'),
        http.get('/sync/status'), http.get('/alerts', { params: { limit: 6 } }), http.get('/quality'),
        http.get('/observations', { params: { days: 30 } }),
      ]);
      http.get('/petlibro').then(r => setPetlibro(r.data)).catch(() => {});
      setInsights(ins.data); setSummary(sum.data); setPets(pt.data); setRobot(rs.data);
      setSync(st.data); setAlerts(al.data); setQuality(q.data); setObservations(ob.data);
      setOffline(false);
      setRefreshKey(k => k + 1);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 120000);
    return () => clearInterval(t);
  }, [load]);

  const refresh = async () => {
    setSyncing(true);
    try { await http.post('/sync'); } catch {}
    await load();
    setSyncing(false);
  };

  const byCat = Object.fromEntries((insights?.cats || []).map(c => [c.cat, c]));
  const cur = byCat[selected];
  const s = summary?.[selected];

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">Lychee <span className="amp">&amp;</span> Guava</div>
        <div className="topbar-right">
          {offline ? <span className="offline">Can't reach the dashboard server.</span>
                   : sync?.last_sync && <span>Updated {fmt.clock(sync.last_sync)}</span>}
          <button className="btn" onClick={refresh} disabled={syncing}>{syncing ? 'Checking the robot…' : 'Check for new visits'}</button>
        </div>
      </header>

      {!insights ? (
        <div className="heroes"><div className="skeleton" /><div className="skeleton" /></div>
      ) : (
        <div className="heroes">
          {CATS.map(cat => byCat[cat] && (
            <Hero key={cat} data={byCat[cat]} profile={pets[cat]} active={selected === cat}
                  onSelect={c => { setSelected(c); }} onPhoto={load} />
          ))}
        </div>
      )}

      {insights && (
        <details className="emergency">
          <summary>
            <span>When to call a vet right away</span>
            <span style={{ color: 'var(--ink-2)', fontWeight: 400 }}>Show</span>
          </summary>
          <ul>{insights.emergency.map(e => <li key={e}>{e}</li>)}</ul>
        </details>
      )}

      {cur && (
        <section style={catVars(selected)}>
          <div className="section-head">
            <div>
              <h2 className="section-title">A closer look at {selected}</h2>
              <p className="section-sub">What the robot's numbers mean, in plain terms. Switch cats here or by tapping a photo above.</p>
            </div>
            <div className="cat-tabs" role="tablist" aria-label="Choose a cat">
              {CATS.map(c => (
                <button key={c} role="tab" className="cat-tab" aria-selected={selected === c} style={catVars(c)} onClick={() => setSelected(c)}>
                  <span className="dot" />{c}
                </button>
              ))}
            </div>
          </div>

          <div className="detail">
            <div>
              <Findings cat={selected} findings={cur.findings} sources={insights.sources} />
              <CheckIn cat={selected} observations={observations} onChange={load} />
            </div>
            <div className="panel">
              <WeightChart cat={selected} trend={s?.weight_trend} vital={cur.vitals?.weight} />
              <EatingBlock cat={selected} data={petlibro?.cats?.[selected]} />
              <TripsChart cat={selected} week={s?.week_trend} month={s?.month_trend} year={s?.year_trend} />
              <RhythmChart cat={selected} hours={s?.hour_pattern} daysTracked={s?.averages?.days_tracked}
                           feedingTimes={insights.meal_times?.[selected] || insights.feeding_times} afterMeal={cur.vitals?.after_meal} />
              <DurationChart cat={selected} trend={s?.duration_trend} vital={cur.vitals?.duration} />
            </div>
          </div>
        </section>
      )}

      {insights && (
        <>
          <div className="section-head">
            <div>
              <h2 className="section-title">Behind the scenes</h2>
              <p className="section-sub">The robot, alerts, and how odd readings were handled.</p>
            </div>
          </div>
          <div className="backstage">
            <RobotPanel robot={robot} sync={sync} />
            <PetlibroPanel data={petlibro} status={sync?.petlibro} />
            <AlertsPanel data={alerts} />
            <QualityPanel q={quality} />
          </div>
          <div style={{ marginTop: 20 }}>
            <VisitLog refreshKey={refreshKey} onChanged={load} />
          </div>

          <footer className="footer">
            <p>{insights.disclaimer}</p>
            <ul>
              {Object.values(insights.sources).map(src => (
                <li key={src.url}><a href={src.url} target="_blank" rel="noreferrer">{src.label}</a></li>
              ))}
            </ul>
          </footer>
        </>
      )}
    </div>
  );
}
