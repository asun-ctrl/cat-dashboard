import React, { useCallback, useEffect, useState } from 'react';
import { catVars, fmt, http } from '../lib';

const QUIET = /No waste weight|No weight reading|Very short visit|No cat tag/;

export default function VisitLog({ refreshKey, onChanged }) {
  const [open, setOpen] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [rows, setRows] = useState([]);

  const load = useCallback(async () => {
    if (!open) return;
    try {
      const r = await http.get('/litter/recent', { params: { limit: flagged ? 100 : 40, flagged_only: flagged } });
      setRows(r.data);
    } catch {}
  }, [open, flagged]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const act = async (id, body) => {
    try {
      if (body) await http.post(`/visits/${id}/override`, body);
      else await http.delete(`/visits/${id}/override`);
      await load();
      onChanged && onChanged();
    } catch {}
  };

  return (
    <div className="panel">
      <div className="chart-head">
        <div>
          <h3 className="panel-title">Visit log</h3>
          <p className="panel-sub">Every trip the robot recorded. Fix any visit it got wrong, and the charts update.</p>
        </div>
        <div className="range-switch">
          <button aria-pressed={open && !flagged} onClick={() => { setOpen(true); setFlagged(false); }}>All visits</button>
          <button aria-pressed={open && flagged} onClick={() => { setOpen(true); setFlagged(true); }}>Needs a look</button>
          {open && <button onClick={() => setOpen(false)}>Hide</button>}
        </div>
      </div>
      {open && (
        <div className="table-wrap">
          {!rows.length && <p className="empty">Nothing to show.</p>}
          {!!rows.length && (
            <table className="log-table">
              <thead><tr><th>Cat</th><th>When</th><th>What</th><th className="hide-sm">Time</th><th>Weight</th><th>Notes</th><th></th></tr></thead>
              <tbody>
                {rows.map(v => {
                  const who = v.counted_as || v.likely_cat;
                  const notes = (v.reason || '').split('; ').filter(r => r && !QUIET.test(r));
                  const badWeight = ['weight_outlier', 'weight_partial', 'matches_other_cat'].some(f => v.flags.includes(f));
                  return (
                    <tr key={v.id} className={v.counted_as ? '' : 'dim'} style={catVars(who)}>
                      <td><span className="log-cat"><span className="dot" />{v.counted_as || (v.likely_cat ? `${v.likely_cat}?` : 'Unknown')}</span>
                        {v.reported_cat !== 'Unknown' && v.reported_cat !== v.counted_as && <div className="vital-note">robot said {v.reported_cat}</div>}</td>
                      <td>{fmt.time(v.timestamp)}</td>
                      <td>{v.waste_type === 'Urine' ? 'Pee' : v.waste_type === 'Feces' ? 'Poop' : 'Unclear'}</td>
                      <td className="hide-sm">{fmt.dur(v.duration_seconds)}</td>
                      <td className={badWeight ? 'struck' : ''}>{fmt.lbs(v.weight_lbs)}</td>
                      <td>
                        {v.possible_loose_stool && <span className="badge">Might be loose stool</span>}
                        {notes.map(n => <span key={n} className="badge quiet">{n}</span>)}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {v.override ? <button className="mini-btn" onClick={() => act(v.id, null)}>Undo</button> : <>
                          {v.likely_cat && <button className="mini-btn" onClick={() => act(v.id, { action: 'assign', assign_to: v.likely_cat })}>It was {v.likely_cat}</button>}
                          {notes.length > 0 && v.reported_cat !== 'Unknown' && <button className="mini-btn" onClick={() => act(v.id, { action: 'include' })}>Reading is fine</button>}
                          <button className="mini-btn" onClick={() => act(v.id, { action: 'exclude' })}>Ignore</button>
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
