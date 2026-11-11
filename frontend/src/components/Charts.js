import React, { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { catColor, fmt } from '../lib';

const V = n => `var(--${n})`;
const tick = { fontSize: 11.5, fill: V('ink-3'), fontFamily: 'Atkinson Hyperlegible, system-ui' };
const grid = <CartesianGrid stroke={V('line')} vertical={false} />;
const xProps = { tick, tickLine: false, axisLine: { stroke: V('line') } };
const yProps = { tick, tickLine: false, axisLine: false };
const cursorBar = { fill: V('ink'), fillOpacity: 0.06 };
const cursorLine = { stroke: V('ink-3'), strokeDasharray: '3 3' };
const dot = { r: 5, stroke: V('surface'), strokeWidth: 2 };
const NOTE_KIND = { diet: 'Diet', med: 'Medication', vet: 'Vet', other: 'Note' };

function Tip({ active, payload, label, render }) {
  if (!active || !payload?.length) return null;
  return <div className="tip">{render(payload[0].payload, label)}</div>;
}

// Notes that fall on a day shown in this chart, as dashed vertical markers.
function useNotes(notes, cat, data) {
  const days = new Set(data.map(p => p.d));
  const mine = (notes || []).filter(n => (!n.cat || n.cat === cat) && days.has(n.day));
  const lines = [...new Set(mine.map(n => n.day))].map(d => (
    <ReferenceLine key={`note-${d}`} x={data.find(p => p.d === d).label} stroke={V('ink-2')} strokeDasharray="3 4" strokeWidth={1.5} />
  ));
  const caption = mine.length > 0 && (
    <ul className="chart-notes">
      {mine.slice(0, 4).map(n => <li key={n.id}><b>{fmt.day(n.day)}</b> · {NOTE_KIND[n.kind] || 'Note'}: {n.text}</li>)}
    </ul>
  );
  return { lines, caption, has: mine.length > 0 };
}

function Block({ title, takeaway, right, children, legend, caption }) {
  return (
    <div className="card">
      <div className="chart-head"><h3 className="card-title">{title}</h3>{right}</div>
      {takeaway && <p className="takeaway">{takeaway}</p>}
      {children}
      {legend}
      {caption}
    </div>
  );
}

const NoteLegend = () => <span><i className="note" />Your notes</span>;

// ── Weight ─────────────────────────────────────────────────────────────────
export function WeightChart({ cat, trend, vital, notes }) {
  const data = Object.entries(trend || {}).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ d, label: fmt.day(d), lbs: v }));
  const n = useNotes(notes, cat, data);
  const color = catColor(cat);
  const base = vital?.baseline;
  let takeaway = `Each point is ${cat}'s median weight that day. Odd readings, like a partial step on the scale, are left out.`;
  if (vital?.change_pct != null) {
    const ch = vital.change_pct;
    takeaway = Math.abs(ch) < 3
      ? `Steady. ${cat} is within ${Math.max(Math.abs(ch), 0.1).toFixed(1)}% of last month's weight, which is normal day-to-day wobble.`
      : ch < 0 ? `${cat} is ${Math.abs(ch).toFixed(1)}% below last month. The dashed red line marks a 5% loss, the point where a vet visit makes sense.`
               : `${cat} is ${ch.toFixed(1)}% above last month.`;
  }
  if (data.length < 2) return <Block title="Weight" takeaway={takeaway}><p className="empty">Not enough readings yet.</p></Block>;
  const vals = data.map(p => p.lbs);
  const lo = Math.min(...vals, base ? base * 0.95 : Infinity);
  const hi = Math.max(...vals, base ? base * 1.02 : -Infinity);
  const domain = [Math.floor((lo - 0.15) * 10) / 10, Math.ceil((hi + 0.15) * 10) / 10];
  return (
    <Block title="Weight" takeaway={takeaway} caption={n.caption}
      legend={<div className="legend">
        <span><i className="line" style={{ background: color }} />{cat}</span>
        {base && <span><i className="band" />Steady zone</span>}
        {base && <span><i className="line" style={{ background: V('concern') }} />5% loss</span>}
        {n.has && <NoteLegend />}
      </div>}>
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
          {grid}
          {base && <ReferenceArea y1={base * 0.98} y2={base * 1.02} fill={V('band')} fillOpacity={1} ifOverflow="extendDomain" />}
          {base && <ReferenceLine y={base * 0.95} stroke={V('concern')} strokeDasharray="5 4" strokeWidth={1.5} />}
          <XAxis dataKey="label" {...xProps} minTickGap={28} />
          <YAxis domain={domain} {...yProps} width={36} tickFormatter={v => v.toFixed(1)} />
          {n.lines}
          <Tooltip cursor={cursorLine} content={<Tip render={p => <><b>{fmt.weekday(p.d)}</b>{p.lbs.toFixed(2)} lbs</>} />} />
          <Line type="monotone" dataKey="lbs" stroke={color} strokeWidth={2.5} dot={false} activeDot={dot} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Block>
  );
}

// ── Eating ─────────────────────────────────────────────────────────────────
const timeWords = t => {
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return t;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};

export function EatingChart({ cat, data, notes }) {
  const hist = (data?.history || []).filter(h => h.eating_seconds != null);
  const chart = hist.map(h => ({ d: h.day, label: fmt.day(h.day), min: +(h.eating_seconds / 60).toFixed(1), sessions: h.eating_sessions }));
  const n = useNotes(notes, cat, chart);
  if (!data || (!hist.length && !data.meals?.length)) return null;
  const meals = data.meals || [];
  const full = hist.slice(0, -1);
  const avg = full.length ? full.reduce((a, h) => a + h.eating_seconds, 0) / full.length / 60 : null;
  let takeaway = meals.length
    ? `${cat}'s feeder serves ${meals.map(m => `${timeWords(m.time)}${m.portions ? ` (${m.portions} portion${m.portions > 1 ? 's' : ''})` : ''}`).join(' and ')}.`
    : '';
  if (avg != null && full.length >= 5) takeaway += ` A typical day is about ${avg.toFixed(0)} minutes at the bowl. Much less than that for a day or two is worth watching.`;
  return (
    <Block title="Eating" takeaway={takeaway} caption={n.caption}
      legend={chart.length > 1 && <div className="legend"><span><i style={{ background: catColor(cat) }} />Minutes at the bowl</span>{avg != null && <span><i className="line" style={{ background: V('ink-3') }} />Typical day</span>}{n.has && <NoteLegend />}</div>}>
      {chart.length > 1 ? (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chart} margin={{ top: 8, right: 6, left: 0, bottom: 0 }} barCategoryGap="22%">
            {grid}
            {avg != null && <ReferenceLine y={avg} stroke={V('ink-3')} strokeDasharray="4 3" />}
            <XAxis dataKey="label" {...xProps} minTickGap={22} />
            <YAxis {...yProps} width={30} />
            {n.lines}
            <Tooltip cursor={cursorBar} content={<Tip render={p => <><b>{fmt.weekday(p.d)}</b>{p.min} minutes over {p.sessions ?? '?'} visits</>} />} />
            <Bar dataKey="min" fill={catColor(cat)} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      ) : <p className="empty">Eating history starts building today.</p>}
    </Block>
  );
}

// ── Drinking ───────────────────────────────────────────────────────────────
export function WaterChart({ cat, data, vital, notes }) {
  const hist = (data?.history || []).filter(h => h.drink_ml != null);
  const chart = hist.map(h => ({ d: h.day, label: fmt.day(h.day), ml: h.drink_ml, n: h.drinks }));
  const n = useNotes(notes, cat, chart);
  if (!hist.some(h => h.drink_ml > 0)) return null;
  const full = hist.slice(0, -1).filter(h => h.drink_ml > 0);
  const avg = full.length ? full.reduce((a, h) => a + h.drink_ml, 0) / full.length : null;
  let takeaway = `The fountain reads ${cat}'s tag, so this is ${cat}'s water only.`;
  if (vital?.value != null) takeaway += ` Last week averaged ${vital.value} mL a day${vital.baseline ? `, compared with ${vital.baseline} mL before` : ''}.`;
  return (
    <Block title="Drinking" takeaway={takeaway} caption={n.caption}
      legend={<div className="legend"><span><i style={{ background: V('water') }} />mL from the fountain</span>{avg != null && <span><i className="line" style={{ background: V('ink-3') }} />Typical day</span>}{n.has && <NoteLegend />}</div>}>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chart} margin={{ top: 8, right: 6, left: 0, bottom: 0 }} barCategoryGap="22%">
          {grid}
          {avg != null && <ReferenceLine y={avg} stroke={V('ink-3')} strokeDasharray="4 3" />}
          <XAxis dataKey="label" {...xProps} minTickGap={22} />
          <YAxis {...yProps} width={34} />
          {n.lines}
          <Tooltip cursor={cursorBar} content={<Tip render={p => <><b>{fmt.weekday(p.d)}</b>{p.ml} mL over {p.n} drinks</>} />} />
          <Bar dataKey="ml" fill={V('water')} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Block>
  );
}

// ── Bathroom trips ─────────────────────────────────────────────────────────
export function TripsChart({ cat, week, month, year, notes }) {
  const [range, setRange] = useState('30d');
  let data;
  if (range === '1y') {
    data = Object.entries(year || {}).sort(([a], [b]) => a.localeCompare(b)).filter(([, v]) => v.total > 0)
      .map(([d, v]) => ({ d, label: fmt.day(d), pee: +(v.urine / 7).toFixed(1), poop: +(v.feces / 7).toFixed(1), unknown: 0, weekly: true }));
  } else {
    const src = range === '7d' ? week : month;
    data = Object.entries(src || {}).sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({ d, label: range === '7d' ? fmt.weekday(d).split(',')[0] : fmt.day(d), pee: v.urine, poop: v.feces, unknown: v.unknown || 0 }));
  }
  const n = useNotes(range === '1y' ? [] : notes, cat, data);
  const full = data.slice(0, -1);
  const avg = k => (full.length ? full.reduce((a, p) => a + p[k], 0) / full.length : 0);
  const ap = avg('pee'), af = avg('poop');
  const takeaway = full.length
    ? `About ${(ap + af).toFixed(1)} trips a day (${ap.toFixed(1)} logged as pee, ${af.toFixed(1)} as poop). Most healthy cats go 3 to 6 times. `
      + (ap + af >= 3 && ap + af <= 6 ? `${cat} is in the normal range.` : ap + af > 6 ? 'That is on the high side.' : 'That is on the low side.')
    : null;
  return (
    <Block title="Bathroom trips" takeaway={takeaway} caption={n.caption}
      right={<div className="seg sm" role="group" aria-label="Time range">
        {[['7d', 'Week'], ['30d', 'Month'], ['1y', 'Year']].map(([r, l]) => <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>{l}</button>)}
      </div>}
      legend={<div className="legend">
        <span><i style={{ background: V('pee') }} />Pee</span>
        <span><i style={{ background: V('poop') }} />Poop</span>
        {range !== '1y' && <span><i style={{ background: V('unknown') }} />Untagged</span>}
        <span><i className="band" />Typical (3 to 6)</span>
        {n.has && <NoteLegend />}
      </div>}>
      {!data.length ? <p className="empty">No visits in this range yet.</p> : (
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 0 }} barCategoryGap="20%">
            {grid}
            <ReferenceArea y1={3} y2={6} fill={V('band')} fillOpacity={1} ifOverflow="extendDomain" />
            <XAxis dataKey="label" {...xProps} minTickGap={16} />
            <YAxis allowDecimals={false} {...yProps} width={24} />
            {n.lines}
            <Tooltip cursor={cursorBar} content={<Tip render={p => (
              <><b>{p.weekly ? `Week of ${fmt.day(p.d)} (daily average)` : fmt.weekday(p.d)}</b>
                {p.pee} pee, {p.poop} poop{p.unknown ? `, ${p.unknown} untagged` : ''}</>
            )} />} />
            <Bar dataKey="pee" stackId="a" fill={V('pee')} stroke={V('surface')} strokeWidth={1.5} isAnimationActive={false} />
            <Bar dataKey="poop" stackId="a" fill={V('poop')} stroke={V('surface')} strokeWidth={1.5} isAnimationActive={false} />
            {range !== '1y' && <Bar dataKey="unknown" stackId="a" fill={V('unknown')} stroke={V('surface')} strokeWidth={1.5} radius={[4, 4, 0, 0]} isAnimationActive={false} />}
          </BarChart>
        </ResponsiveContainer>
      )}
    </Block>
  );
}

// ── Daily rhythm ───────────────────────────────────────────────────────────
export function RhythmChart({ cat, hours, daysTracked, feedingTimes = [], afterMeal }) {
  const days = Math.max(daysTracked || 1, 1);
  const data = Array.from({ length: 24 }, (_, h) => {
    const v = hours?.[String(h)] || { urine: 0, feces: 0 };
    return { h, label: fmt.hour(h), rate: +((v.urine + v.feces) / days).toFixed(2), urine: v.urine, feces: v.feces };
  });
  const peak = data.reduce((a, b) => (b.rate > a.rate ? b : a), data[0]);
  const mealHours = feedingTimes.map(t => parseInt(t, 10)).filter(x => !Number.isNaN(x));
  let takeaway = `When ${cat} usually uses the litter box. The busiest hour starts at ${fmt.hourLong(peak.h)}.`;
  if (afterMeal) takeaway += ` ${afterMeal.value}% of visits come within 2 hours of a meal (chance alone would be about ${afterMeal.expected}%).`;
  return (
    <Block title="Daily rhythm" takeaway={takeaway}
      legend={<div className="legend"><span><i style={{ background: catColor(cat) }} />Litter visits by hour</span>{!!mealHours.length && <span><i className="note" />Meal time</span>}</div>}>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} margin={{ top: 14, right: 6, left: 0, bottom: 0 }} barCategoryGap="12%">
          {grid}
          <XAxis dataKey="label" {...xProps} interval={2} />
          <YAxis {...yProps} width={30} tickFormatter={v => (v === 0 ? '0' : v.toFixed(1))} />
          {mealHours.map(h => <ReferenceLine key={h} x={fmt.hour(h)} stroke={V('ink-2')} strokeDasharray="3 4" strokeWidth={1.5} />)}
          <Tooltip cursor={cursorBar} content={<Tip render={p => <><b>{fmt.hourLong(p.h)}</b>{p.rate} visits a day on average</>} />} />
          <Bar dataKey="rate" fill={catColor(cat)} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Block>
  );
}

// ── Time in the box ────────────────────────────────────────────────────────
export function DurationChart({ cat, trend, vital }) {
  const data = Object.entries(trend || {}).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ d, label: fmt.day(d), sec: Math.round(v) }));
  const takeaway = vital
    ? `A typical visit lasts about ${vital.value} seconds (before this week: ${vital.baseline}). Visits that get steadily longer can mean straining.`
    : 'Average seconds per visit. Visits that get steadily longer can mean straining.';
  if (data.length < 2) return null;
  return (
    <Block title="Time in the box" takeaway={takeaway}>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
          {grid}
          <XAxis dataKey="label" {...xProps} minTickGap={28} />
          <YAxis {...yProps} width={38} tickFormatter={v => `${v}s`} />
          <Tooltip cursor={cursorLine} content={<Tip render={p => <><b>{fmt.weekday(p.d)}</b>{p.sec} seconds on average</>} />} />
          <Line type="monotone" dataKey="sec" stroke={catColor(cat)} strokeWidth={2.5} dot={false} activeDot={dot} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Block>
  );
}
