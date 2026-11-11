import React, { useCallback, useEffect, useRef, useState } from 'react';
import './styles.css';
import { CATS, getPasscode, http, setPasscode } from './lib';
import { Icon, Sheet } from './components/Bits';
import Today from './components/Today';
import Trends from './components/Trends';
import Week from './components/Week';
import Journal, { LogForm } from './components/Journal';
import More, { Report } from './components/More';

function PasscodeScreen({ onUnlock }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await http.post('/auth/check', null, { headers: { 'X-Passcode': code } });
      setPasscode(code);
      onUnlock();
    } catch (ex) {
      setErr(ex.response?.data?.detail || "Can't reach the dashboard. Check your connection.");
    }
    setBusy(false);
  };
  return (
    <div className="lock">
      <form className="lock-card" onSubmit={submit}>
        <div className="brand">Lychee <span className="amp">&amp;</span> Guava</div>
        <label htmlFor="pc" className="field-label">Enter the passcode</label>
        <input id="pc" className="input" type="password" autoComplete="current-password" autoFocus value={code} onChange={e => setCode(e.target.value)} />
        {err && <p className="lock-err" role="alert">{err}</p>}
        <button className="btn-primary" style={{ marginTop: 4 }} disabled={!code || busy}>{busy ? 'Checking…' : 'Open dashboard'}</button>
        <p className="muted">You only need to do this once on each device.</p>
      </form>
    </div>
  );
}

const TABS = [['today', 'Today', 'home'], ['trends', 'Trends', 'chart'], ['week', 'Week', 'week'], ['journal', 'Journal', 'journal'], ['more', 'More', 'more']];
const startTab = () => { const h = window.location.hash.slice(1); return TABS.some(t => t[0] === h) || h === 'report' ? h : 'today'; };

export default function App() {
  const [d, setD] = useState(null);
  const [tab, setTabState] = useState(startTab);
  const [cat, setCat] = useState(CATS[1]);
  const [offline, setOffline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [locked, setLocked] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef();

  const toast = useCallback(msg => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2600);
  }, []);

  const setTab = useCallback(t => {
    setTabState(t);
    window.history.replaceState(null, '', `#${t}`);
    window.scrollTo(0, 0);
  }, []);

  const load = useCallback(async () => {
    try {
      const get = (url, params) => http.get(url, { params }).then(r => r.data);
      const soft = (url, params, fallback) => get(url, params).catch(e => { if (e.response?.status === 401) throw e; return fallback; });
      const [insights, summary, pets, robot, sync, alerts, quality, observations, notes, feed, petlibro] = await Promise.all([
        get('/insights'), get('/litter/summary'), get('/pets'), soft('/robot/status', null, null), soft('/sync/status', null, null),
        soft('/alerts', { limit: 12 }, null), soft('/quality', null, null), soft('/observations', { days: 120 }, []),
        soft('/notes', null, []), soft('/feed', { hours: 48 }, []), soft('/petlibro', null, null),
      ]);
      setD({ insights, summary, pets, robot, sync, alerts, quality, observations, notes, feed, petlibro });
      setOffline(false);
      setRefreshKey(k => k + 1);
    } catch (e) {
      if (e.response?.status !== 401) setOffline(true);
    }
  }, []);

  useEffect(() => {
    const onLock = () => { setPasscode(''); setLocked(true); };
    window.addEventListener('lg-locked', onLock);
    return () => window.removeEventListener('lg-locked', onLock);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 120000);
    const wake = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', wake);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', wake); };
  }, [load]);

  const refresh = async () => {
    setSyncing(true);
    try { await http.post('/sync'); } catch {}
    await load();
    setSyncing(false);
    toast('Up to date');
  };

  if (locked) return <PasscodeScreen onUnlock={() => { setLocked(false); load(); }} />;

  const attention = d ? d.insights.cats.some(c => c.status === 'watch' || c.status === 'concern') : false;
  const openCat = c => { setCat(c); setTab('trends'); };
  const shown = tab === 'report' ? 'more' : tab;

  return (
    <div className="app">
      {offline && <p className="offline" role="alert">Can't reach the dashboard server. Showing the last data loaded.</p>}
      {!d ? (
        <>{!offline && <><div className="skeleton" style={{ height: 60 }} /><div className="skeleton" style={{ marginTop: 14 }} /><div className="skeleton" style={{ marginTop: 14 }} /></>}
          {offline && !getPasscode() && <button className="btn-secondary" style={{ marginTop: 12 }} onClick={load}>Try again</button>}</>
      ) : (
        <main key={tab}>
          {tab === 'today' && <Today d={d} onOpenCat={openCat} refresh={refresh} syncing={syncing} />}
          {tab === 'trends' && <Trends d={d} cat={cat} setCat={setCat} />}
          {tab === 'week' && <Week pets={d.pets} />}
          {tab === 'journal' && <Journal d={d} reload={load} refreshKey={refreshKey} toast={toast} />}
          {tab === 'more' && <More d={d} reload={load} toast={toast} openReport={() => setTab('report')} />}
          {tab === 'report' && <Report startCat={cat} onBack={() => setTab('more')} toast={toast} />}
        </main>
      )}

      {d && tab !== 'report' && tab !== 'journal' && (
        <button className="fab" onClick={() => setSheet('checkin')} aria-label="Log something"><Icon name="plus" /></button>
      )}

      <nav className="tabbar" aria-label="Sections">
        <div className="tabbar-inner">
          {TABS.map(([id, label, icon]) => (
            <button key={id} className="tab" aria-current={shown === id ? 'page' : undefined} onClick={() => setTab(id)}>
              <span className="tab-ico"><Icon name={icon} />{id === 'today' && attention && shown !== 'today' && <span className="tab-dot" />}</span>
              {label}
            </button>
          ))}
        </div>
      </nav>

      {sheet && (
        <Sheet title="Log something" onClose={() => setSheet(null)}>
          <div className="seg" role="group" aria-label="What to log" style={{ marginTop: 12 }}>
            <button aria-pressed={sheet === 'checkin'} onClick={() => setSheet('checkin')}>Box check</button>
            <button aria-pressed={sheet === 'note'} onClick={() => setSheet('note')}>Note</button>
          </div>
          <LogForm key={sheet} mode={sheet} defaultCat={cat} toast={toast} onSaved={() => { setSheet(null); load(); }} />
        </Sheet>
      )}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
