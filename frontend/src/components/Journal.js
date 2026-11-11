import React, { useCallback, useEffect, useState } from 'react';
import { CATS, catVars, fmt, http, localDay, todayStr } from '../lib';
import { Icon } from './Bits';

export const OBS = [
  { kind: 'normal_stool', label: 'Normal poop' },
  { kind: 'soft_stool', label: 'Soft poop' },
  { kind: 'diarrhea', label: 'Diarrhea' },
  { kind: 'constipated', label: 'Hard or straining' },
  { kind: 'blood', label: 'Blood' },
  { kind: 'vomit', label: 'Vomit or hairball' },
];
const OBS_LABEL = Object.fromEntries(OBS.map(o => [o.kind, o.label]));
export const NOTE_KINDS = [
  { kind: 'diet', label: 'Diet change' },
  { kind: 'med', label: 'Medication' },
  { kind: 'vet', label: 'Vet visit' },
  { kind: 'other', label: 'Something else' },
];
const NOTE_LABEL = { diet: 'Diet', med: 'Medication', vet: 'Vet', other: 'Note' };

// Shared by the Journal page and the "+" sheet on every tab.
export function LogForm({ mode, defaultCat, onSaved, toast }) {
  const [cat, setCat] = useState(defaultCat || CATS[1]);
  const [kind, setKind] = useState(mode === 'checkin' ? null : 'diet');
  const [text, setText] = useState('');
  const [day, setDay] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const isCheck = mode === 'checkin';
  const ok = isCheck ? !!kind : text.trim().length > 0;

  const save = async () => {
    setBusy(true);
    try {
      if (isCheck) {
        await http.post('/observations', { cat, kind, note: text.trim() || null });
        toast(`Logged "${OBS_LABEL[kind]}" for ${cat}`);
      } else {
        await http.post('/notes', { cat: cat === 'Both' ? null : cat, kind, text: text.trim(), day });
        toast('Note saved');
      }
      setText(''); if (isCheck) setKind(null);
      onSaved && onSaved();
    } catch (e) { toast(e.response?.data?.detail || "Couldn't save. Check your connection."); }
    setBusy(false);
  };

  return (
    <div>
      <div className="field">
        <span className="field-label">Which cat?</span>
        <div className="choice-row">
          {[...CATS, ...(isCheck ? [] : ['Both'])].map(c => (
            <button key={c} type="button" className="choice" aria-pressed={cat === c} style={catVars(c)} onClick={() => setCat(c)}>
              {c !== 'Both' && <span className="sw" />}{c}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">{isCheck ? 'What did you find?' : 'What kind of note?'}</span>
        <div className="choice-row">
          {(isCheck ? OBS : NOTE_KINDS).map(o => (
            <button key={o.kind} type="button" className="choice" aria-pressed={kind === o.kind} onClick={() => setKind(o.kind)}>{o.label}</button>
          ))}
        </div>
      </div>
      <label className="field">
        <span className="field-label">{isCheck ? 'Anything to add? (optional)' : 'What happened?'}</span>
        <input className="input" value={text} maxLength={300} onChange={e => setText(e.target.value)}
               placeholder={isCheck ? 'Small amount, near the door' : 'Switched to the new salmon food'} />
      </label>
      {!isCheck && (
        <label className="field">
          <span className="field-label">When?</span>
          <input className="input" type="date" value={day} max={todayStr()} onChange={e => setDay(e.target.value)} />
        </label>
      )}
      <button className="btn-primary" disabled={!ok || busy} onClick={save}>{busy ? 'Saving…' : isCheck ? 'Log it' : 'Save note'}</button>
    </div>
  );
}

function Timeline({ notes, observations, reload, toast }) {
  const [all, setAll] = useState(false);
  const items = [
    ...notes.map(n => ({ key: `n${n.id}`, id: n.id, type: 'note', day: n.day, cat: n.cat, tag: NOTE_LABEL[n.kind] || 'Note', text: n.text })),
    ...observations.map(o => ({ key: `o${o.id}`, id: o.id, type: 'obs', day: localDay(o.created_at), cat: o.cat, tag: 'Box check',
      text: `${OBS_LABEL[o.kind] || o.kind}${o.note ? `. ${o.note}` : ''}` })),
  ].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  const shown = all ? items : items.slice(0, 12);
  const remove = async it => {
    try {
      await http.delete(it.type === 'note' ? `/notes/${it.id}` : `/observations/${it.id}`);
      toast('Removed'); reload();
    } catch { toast("Couldn't remove it. Try again."); }
  };
  return (
    <div className="card">
      {!items.length && <p className="empty" style={{ paddingTop: 0 }}>Nothing logged yet. Notes you add show up here and as markers on the charts, so you can see what changed after a new food or a medication.</p>}
      {shown.map(it => (
        <div className="tl-item" key={it.key} style={catVars(it.cat)}>
          <div className="tl-date">{fmt.day(it.day)}</div>
          <div>
            <span className="tl-kind"><span className="dot" />{it.cat || 'Both cats'}, {it.tag}</span>
            <div>{it.text}</div>
          </div>
          <button className="x-btn" onClick={() => remove(it)} aria-label={`Remove: ${it.text}`}><Icon name="x" /></button>
        </div>
      ))}
      {items.length > shown.length && <button className="link-btn" onClick={() => setAll(true)}>Show all {items.length}</button>}
    </div>
  );
}

const QUIET = /No waste weight|No weight reading|Very short visit|No cat tag/;
const WHISKER = {
  sending: ['quiet', 'Sending to Whisker…'],
  sent: ['ok', 'Fixed in Whisker too'],
  failed: ['', "Saved here. Whisker didn't accept it."],
  skipped: ['quiet', 'Saved here only'],
};

function Visits({ refreshKey, onChanged, toast }) {
  const [flagged, setFlagged] = useState(true);
  const [rows, setRows] = useState(null);
  const [n, setN] = useState(8);
  const load = useCallback(async () => {
    try {
      const r = await http.get('/litter/recent', { params: { limit: flagged ? 100 : 60, flagged_only: flagged } });
      setRows(r.data);
    } catch { setRows(x => x || []); }
  }, [flagged]);
  useEffect(() => { load(); }, [load, refreshKey]);
  // A correction takes a few seconds to reach Whisker. Poll until it settles.
  useEffect(() => {
    if (!rows?.some(v => v.whisker === 'sending')) return undefined;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [rows, load]);

  const act = async (v, body, msg) => {
    try {
      if (body) await http.post(`/visits/${v.id}/override`, body);
      else await http.delete(`/visits/${v.id}/override`);
      toast(msg);
      await load();
      onChanged && onChanged();
    } catch { toast("Couldn't save that. Try again."); }
  };
  const list = (rows || []).filter(v => !flagged || !v.override || v.whisker).slice(0, n);

  return (
    <div className="card">
      <div className="seg sm" role="group" aria-label="Which visits to show" style={{ marginBottom: 6 }}>
        <button aria-pressed={flagged} onClick={() => { setFlagged(true); setN(8); }}>Needs a look</button>
        <button aria-pressed={!flagged} onClick={() => { setFlagged(false); setN(8); }}>All visits</button>
      </div>
      {rows && !list.length && <p className="empty">{flagged ? 'Nothing needs fixing right now.' : 'No visits yet.'}</p>}
      {list.map(v => {
        const who = v.counted_as || v.likely_cat;
        const notes = (v.reason || '').split('; ').filter(r => r && !QUIET.test(r));
        const badWeight = ['weight_outlier', 'weight_partial', 'matches_other_cat'].some(f => v.flags.includes(f));
        const choices = [...CATS].filter(c => c !== v.counted_as).sort((x, y) => (y === v.likely_cat) - (x === v.likely_cat));
        const w = v.whisker && WHISKER[v.whisker];
        return (
          <div className="visit" key={v.id} style={catVars(who)}>
            <div className="visit-top">
              <span className="visit-who"><span className="dot" />{v.counted_as || (v.likely_cat ? `Probably ${v.likely_cat}` : 'Unknown cat')}</span>
              <time className="muted">{fmt.time(v.timestamp)}</time>
            </div>
            <div className="visit-meta">
              {v.waste_type === 'Urine' ? 'Pee' : v.waste_type === 'Feces' ? 'Poop' : 'Type unclear'}
              {v.duration_seconds ? `, ${fmt.dur(v.duration_seconds)}` : ''}
              {v.weight_lbs ? <>, <span className={badWeight ? 'struck' : ''}>{fmt.lbs(v.weight_lbs)}</span></> : ''}
              {v.reported_cat !== 'Unknown' && v.counted_as && v.reported_cat !== v.counted_as ? `. Robot said ${v.reported_cat}.` : ''}
            </div>
            <div>
              {v.possible_loose_stool && <span className="badge">Might be loose stool</span>}
              {notes.map(x => <span key={x} className="badge quiet">{x}</span>)}
              {v.override && !w && <span className="badge quiet">{v.override === 'exclude' ? 'Ignored by you' : 'Corrected by you'}</span>}
              {w && <span className={`badge ${w[0]}`}>{w[1]}</span>}
            </div>
            <div className="visit-actions">
              {v.override ? <button className="mini" onClick={() => act(v, null, 'Correction undone')}>Undo</button> : <>
                {choices.map(c => <button key={c} className="mini" onClick={() => act(v, { action: 'assign', assign_to: c }, `Saved as ${c}`)}>It was {c}</button>)}
                {notes.length > 0 && v.reported_cat !== 'Unknown' && <button className="mini" onClick={() => act(v, { action: 'include' }, 'Reading kept')}>Reading is fine</button>}
                <button className="mini" onClick={() => act(v, { action: 'exclude' }, 'Visit ignored')}>Ignore</button>
              </>}
            </div>
          </div>
        );
      })}
      {rows && rows.length > n && <button className="link-btn" style={{ marginTop: 6 }} onClick={() => setN(n + 15)}>Show more</button>}
    </div>
  );
}

export default function Journal({ d, reload, refreshKey, toast }) {
  const [mode, setMode] = useState('note');
  return (
    <>
      <h1 className="page-title">Journal</h1>
      <p className="page-sub">What the sensors can't see. Your notes explain the charts later.</p>
      <div className="two-col">
        <div>
          <div className="card">
            <div className="seg" role="group" aria-label="What to log">
              <button aria-pressed={mode === 'note'} onClick={() => setMode('note')}>Add a note</button>
              <button aria-pressed={mode === 'checkin'} onClick={() => setMode('checkin')}>Log a box check</button>
            </div>
            <LogForm key={mode} mode={mode} onSaved={reload} toast={toast} />
          </div>
          <section className="section">
            <div className="section-head"><h2 className="section-title">Timeline</h2></div>
            <Timeline notes={d.notes} observations={d.observations} reload={reload} toast={toast} />
          </section>
        </div>
        <section className="section">
          <div className="section-head"><h2 className="section-title">Fix the robot's mistakes</h2></div>
          <p className="muted" style={{ margin: '-4px 0 10px' }}>When you say which cat it was, the fix is sent back to the Whisker app too, so its weight history improves.</p>
          <Visits refreshKey={refreshKey} onChanged={reload} toast={toast} />
        </section>
      </div>
    </>
  );
}
