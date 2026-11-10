import React from 'react';
import { catVars } from '../lib';
import { CatAvatar, StatusChip } from './Bits';

function RangeBar({ value, band, max, label }) {
  if (value == null) return null;
  const pct = v => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div className="range" role="img" aria-label={label}>
      <div className="range-band" style={{ left: pct(band[0]), width: `calc(${pct(band[1])} - ${pct(band[0])})` }} />
      <div className="range-dot" style={{ left: pct(value) }} />
    </div>
  );
}

function Vital({ label, value, unit, note, children }) {
  return (
    <div>
      <div className="vital-label">{label}</div>
      <div className="vital-value">{value ?? '--'}{value != null && unit && <small>{unit}</small>}</div>
      {children}
      {note && <div className="vital-note">{note}</div>}
    </div>
  );
}

export default function Hero({ data, profile, active, onSelect, onPhoto }) {
  const { cat, status, headline, summary, vitals = {} } = data;
  const verdict = headline.startsWith(cat) ? headline.slice(cat.length).trim() : headline;
  const w = vitals.weight, u = vitals.urine, s = vitals.stool;

  let weightNote = null;
  if (w?.change_pct != null) {
    const dir = Math.abs(w.change_pct) < 1 ? 'about the same as' : w.change_pct < 0 ? `${Math.abs(w.change_pct).toFixed(1)}% under` : `${w.change_pct.toFixed(1)}% over`;
    weightNote = `${dir} last month`;
  }

  const select = () => onSelect && onSelect(cat);
  return (
    <section
      className={`hero ${onSelect ? 'is-selectable' : ''} ${active ? 'is-active' : ''}`}
      style={catVars(cat)}
      onClick={select}
      onKeyDown={e => { if (onSelect && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(); } }}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={`${cat}: ${headline}. Show ${cat}'s details`}
    >
      <div className="hero-photo">
        <CatAvatar cat={cat} profile={profile} onUploaded={onPhoto} />
      </div>
      <div>
        <h2 className="hero-name">{cat}</h2>
        <p className="hero-verdict">{verdict}</p>
        {summary && <p className="hero-summary">{summary}</p>}
        <StatusChip level={status} />
      </div>
      <div className="vitals">
        <Vital label="Weight" value={w ? Number(w.value).toFixed(1) : null} unit="lbs" note={weightNote || (w ? 'trend builds over time' : 'no readings yet')} />
        <Vital label="Pees a day" value={u?.value} note={u?.baseline != null ? `usually ${u.baseline}` : 'healthy range 2 to 4'}>
          <RangeBar value={u?.value} band={[2, 4]} max={8} label={`${u?.value} a day; healthy range 2 to 4`} />
        </Vital>
        <Vital label="Poops a day" value={s?.value} note="healthy range 1 to 2">
          <RangeBar value={s?.value} band={[1, 2]} max={4} label={`${s?.value} a day; healthy range 1 to 2`} />
        </Vital>
      </div>
    </section>
  );
}
