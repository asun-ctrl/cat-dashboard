import React, { useState } from 'react';
import { ago, http } from '../lib';

export const OBS = [
  { kind: 'normal_stool', label: 'Normal poop', color: '#9A5B2E' },
  { kind: 'soft_stool', label: 'Soft poop', color: '#C9893F' },
  { kind: 'diarrhea', label: 'Diarrhea', color: '#E0A526' },
  { kind: 'constipated', label: 'Hard or straining', color: '#545A70' },
  { kind: 'blood', label: 'Blood', color: '#C2412D' },
  { kind: 'vomit', label: 'Vomit or hairball', color: '#7F869A' },
];
const LABEL = Object.fromEntries(OBS.map(o => [o.kind, o.label]));

export default function CheckIn({ cat, observations = [], onChange }) {
  const [msg, setMsg] = useState('');
  const mine = observations.filter(o => o.cat === cat).slice(0, 5);

  const log = async kind => {
    try {
      await http.post('/observations', { cat, kind });
      setMsg(`Logged "${LABEL[kind]}" for ${cat}.`);
      onChange && onChange();
    } catch { setMsg('Could not save. Check your connection and try again.'); }
  };
  const undo = async id => {
    try { await http.delete(`/observations/${id}`); onChange && onChange(); } catch {}
  };

  return (
    <div className="panel">
      <h3 className="panel-title">What did you find in the box?</h3>
      <p className="panel-sub">
        The robot can't see what the stool looks like, and it sometimes logs loose stool as pee. A quick tap when you
        check the box fills that gap. Your notes feed into the findings and give your vet real examples.
      </p>
      <div className="checkin-grid">
        {OBS.map(o => (
          <button key={o.kind} className="chip-btn" onClick={() => log(o.kind)}>
            <span className="sw" style={{ background: o.color }} />{o.label}
          </button>
        ))}
      </div>
      {msg && <p className="toast" role="status">{msg}</p>}
      {!!mine.length && (
        <ul className="logged">
          {mine.map(o => (
            <li key={o.id}><span>{LABEL[o.kind] || o.kind}, {ago(o.created_at)}</span>
              <button className="btn-quiet" onClick={() => undo(o.id)}>Remove</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
