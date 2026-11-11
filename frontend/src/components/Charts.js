import React, { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { CAT_COLOR, fmt } from '../lib';

const C = { pee: '#E0A526', poop: '#9A5B2E', unknown: '#C9CED9', grid: '#E8ECF2', axis: '#7F869A', concern: '#C2412D', band: '#E3F3EA', paper: '#FFFFFF' };
const axisTick = { fontSize: 12, fill: C.axis, fontFamily: 'Atkinson Hyperlegible, system-ui' };

function Tip({ active, payload, label, render }) {
  if (!active || !payload?.length) return null;
  return <div className="tip">{render(payload[0].payload, label)}</div>;
}

function Block({ title, takeaway, right, children, legend }) {
  return (
    <div className="chart-block">
      <div className="chart-head">
        <h3 className="panel-title">{title}</h3>
        {right}
      </div>
      {takeaway && <p className="chart-takeaway">{takeaway}</p>}
      {children}
      {legend}
    </div>
  );
}

// ── Weight ─────────────────────────────────────────────────────────────────
export function WeightChart({ cat, trend, vital }) {
  const data = Object.entries(trend || {}).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ d, label: fmt.day(d), lbs: v }));
  const color = CAT_COLOR[cat];
  const base = vital?.baseline;
  let takeaway = `Each point is ${cat}'s median weight that day. Odd readings, like a partial step on the scale, are left out.`;
  if (vital?.change_pct != null) {
    const ch = vital.change_pct;
    takeaway = Math.abs(ch) < 3
      ? `Steady. ${cat} is within ${Math.max(Math.abs(ch), 0.1).toFixed(1)}% of last month's weight, which is normal day-to-day wobble.`
      : ch < 0 ? `${cat} is ${Math.abs(ch).toFixed(1)}% below last month. The dashed line marks a 5% loss, the point where a vet visit makes sense.`
               : `${cat} is ${ch.toFixed(1)}% above last month.`;
  }
  if (data.length < 2) return <Block title="Weight" takeaway={takeaway}><p className="empty">Not enough readings yet.</p></Block>;

  const vals = data.map(p => p.lbs);
  const lo = Math.min(...vals, base ? base * 0.95 : Infinity);
  const hi = Math.max(...vals, base ? base * 1.02 : -Infinity);
  const domain = [Math.floor((lo - 0.15) * 10) / 10, Math.ceil((hi + 0.15) * 10) / 10];

  return (
    <Block title="Weight" takeaway={takeaway}
      legend={<div className="legend">
        <span><i className="line" style={{ background: color }} />{cat}'s weight</span>
        {base && <span><i className="band" />Steady zone (within 2%)</span>}
        {base && <span><i className="line" style={{ background: C.concern }} />5% loss</span>}
      </div>}>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          {base && <ReferenceArea y1={base * 0.98} y2={base * 1.02} fill={C.band} fillOpacity={0.9} ifOverflow="extendDomain" />}
          {base && <ReferenceLine y={base * 0.95} stroke={C.concern} strokeDasharray="5 4" strokeWidth={1.5} />}
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: C.grid }} minTickGap={28} />
          <YAxis domain={domain} tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={v => v.toFixed(1)} />
          <Tooltip cursor={{ stroke: C.axis, strokeDasharray: '3 3' }}
            content={<Tip render={p => <><b>{fmt.weekday(p.d)}</b>{p.lbs.toFixed(2)} lbs</>} />} />
          <Line type="monotone" dataKey="lbs" stroke={color} strokeWidth={2} dot={false}
                activeDot={{ r: 5, stroke: C.paper, strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Block>
  );
}

// ── Bathroom trips ─────────────────────────────────────────────────────────
export function TripsChart({ cat, week, month, year }) {
  const [range, setRange] = useState('30d');
  let data;
  if (range === '1y') {
    data = Object.entries(year || {}).sort(([a], [b]) => a.localeCompare(b))
      .filter(([, v]) => v.total > 0)
      .map(([d, v]) => ({ d, label: fmt.day(d), pee: +(v.urine / 7).toFixed(1), poop: +(v.feces / 7).toFixed(1), unknown: 0, weekly: true }));
  } else {
    const src = range === '7d' ? week : month;
    data = Object.entries(src || {}).sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({ d, label: range === '7d' ? fmt.weekday(d).split(',')[0] : fmt.day(d), pee: v.urine, poop: v.feces, unknown: v.unknown || 0 }));
  }
  const full = data.slice(0, -1);   // today is partial
  const avg = k => full.length ? full.reduce((a, p) => a + p[k], 0) / full.length : 0;
  const ap = avg('pee'), af = avg('poop');
  const takeaway = full.length
    ? `On average ${cat} peed ${ap.toFixed(1)} and pooped ${af.toFixed(1)} times a day in this period. ` +
      `Most healthy cats go 3 to 6 times a day in total (2 to 4 pees, 1 to 2 poops). ` +
      (ap + af >= 3 && ap + af <= 6 ? `That puts ${cat} right in the normal range.` : ap + af > 6 ? 'That is on the high side.' : 'That is on the low side.')
    : null;

  return (
    <Block title="Bathroom trips" takeaway={takeaway}
      right={<div className="range-switch" role="group" aria-label="Time range">
        {['7d', '30d', '1y'].map(r => <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>{r === '1y' ? 'Year' : r === '7d' ? 'Week' : 'Month'}</button>)}
      </div>}
      legend={<div className="legend">
        <span><i style={{ background: C.pee }} />Pee</span>
        <span><i style={{ background: C.poop }} />Poop</span>
        {range !== '1y' && <span><i style={{ background: C.unknown }} />Untagged, could be {cat}</span>}
        <span><i className="band" />Typical total (3 to 6)</span>
      </div>}>
      {!data.length ? <p className="empty">No visits in this range yet.</p> : (
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid stroke={C.grid} vertical={false} />
            <ReferenceArea y1={3} y2={6} fill={C.band} fillOpacity={0.9} ifOverflow="extendDomain" />
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: C.grid }} minTickGap={16} />
            <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} width={30} />
            <Tooltip cursor={{ fill: 'rgba(29,33,51,.05)' }} content={<Tip render={p => (
              <><b>{p.weekly ? `Week of ${fmt.day(p.d)} (daily avg)` : fmt.weekday(p.d)}</b>
                {p.pee} pee, {p.poop} poop{p.unknown ? `, ${p.unknown} untagged` : ''}</>
            )} />} />
            <Bar dataKey="pee" stackId="a" fill={C.pee} stroke={C.paper} strokeWidth={2} isAnimationActive={false} />
            <Bar dataKey="poop" stackId="a" fill={C.poop} stroke={C.paper} strokeWidth={2} isAnimationActive={false} />
            {range !== '1y' && <Bar dataKey="unknown" stackId="a" fill={C.unknown} stroke={C.paper} strokeWidth={2} radius={[4, 4, 0, 0]} isAnimationActive={false} />}
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
  const color = CAT_COLOR[cat];
  const peak = data.reduce((a, b) => (b.rate > a.rate ? b : a), data[0]);
  const mealHours = feedingTimes.map(t => parseInt(t, 10)).filter(n => !Number.isNaN(n));
  let takeaway = `When ${cat} usually goes, averaged over the last ${days} days. The busiest hour starts at ${fmt.hourLong(peak.h)}.`;
  if (afterMeal) {
    takeaway += ` ${afterMeal.value}% of visits come within 2 hours of a meal (chance alone would be about ${afterMeal.expected}%).`;
  }
  return (
    <Block title="Daily rhythm" takeaway={takeaway}
      legend={<div className="legend">
        <span><i style={{ background: color }} />Visits per day at that hour</span>
        {!!mealHours.length && <span><i className="line" style={{ background: '#1D2133' }} />Meal time</span>}
      </div>}>
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={data} margin={{ top: 14, right: 8, left: 0, bottom: 0 }} barCategoryGap="12%">
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: C.grid }} interval={2} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={36} tickFormatter={v => (v === 0 ? '0' : v.toFixed(v < 1 ? 2 : 1))} />
          {mealHours.map(h => <ReferenceLine key={h} x={fmt.hour(h)} stroke="#1D2133" strokeDasharray="4 3"
            label={{ value: 'meal', position: 'top', fontSize: 11, fill: '#545A70' }} />)}
          <Tooltip cursor={{ fill: 'rgba(29,33,51,.05)' }} content={<Tip render={p => (
            <><b>{fmt.hour(p.h)} to {fmt.hour((p.h + 1) % 24)}</b>{p.rate} visits a day on average<br />{p.urine} pee, {p.feces} poop in total</>
          )} />} />
          <Bar dataKey="rate" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Block>
  );
}

// ── Time in the box ────────────────────────────────────────────────────────
export function DurationChart({ cat, trend, vital }) {
  const data = Object.entries(trend || {}).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ d, label: fmt.day(d), sec: Math.round(v) }));
  const color = CAT_COLOR[cat];
  const takeaway = vital
    ? `A typical visit lasts about ${vital.value} seconds (before this week: ${vital.baseline}). Visits that get steadily longer can mean straining.`
    : `Average seconds per visit each day. Visits that get steadily longer can mean straining.`;
  if (data.length < 2) return <Block title="Time in the box" takeaway={takeaway}><p className="empty">Not enough visits yet.</p></Block>;
  return (
    <Block title="Time in the box" takeaway={takeaway}>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: C.grid }} minTickGap={28} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={46} tickFormatter={v => `${v}s`} />
          <Tooltip cursor={{ stroke: C.axis, strokeDasharray: '3 3' }} content={<Tip render={p => <><b>{fmt.weekday(p.d)}</b>{p.sec} seconds on average</>} />} />
          <Line type="monotone" dataKey="sec" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: C.paper, strokeWidth: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </Block>
  );
}

// ── Eating (PetLibro feeder) ───────────────────────────────────────────────
const timeWords = t => {
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return t;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
};

export function EatingBlock({ cat, data }) {
  if (!data) return null;
  const color = CAT_COLOR[cat];
  const meals = data.meals || [];
  const today = data.today || {};
  const hist = (data.history || []).filter(h => h.eating_seconds != null);
  const full = hist.slice(0, -1);
  const avgMin = full.length ? full.reduce((a, h) => a + h.eating_seconds, 0) / full.length / 60 : null;

  let takeaway = meals.length
    ? `${cat}'s feeder serves ${meals.length} meal${meals.length > 1 ? 's' : ''} a day at ${meals.map(m => `${timeWords(m.time)}${m.portions ? ` (${m.portions} portion${m.portions > 1 ? 's' : ''})` : ''}`).join(' and ')}.`
    : `Feeding schedule not available yet.`;
  if (today.eating_sessions != null) {
    takeaway += ` Today so far: ${today.eating_sessions} visits to the bowl`;
    takeaway += today.eating_seconds != null ? `, about ${Math.round(today.eating_seconds / 60)} minutes of eating.` : '.';
  }
  if (avgMin != null && full.length >= 5) takeaway += ` A typical full day is about ${avgMin.toFixed(0)} minutes. Eating noticeably less than that for a day or two is worth watching.`;

  const chart = hist.map(h => ({ d: h.day, label: fmt.day(h.day), min: +(h.eating_seconds / 60).toFixed(1), sessions: h.eating_sessions }));
  return (
    <Block title="Eating" takeaway={takeaway}
      legend={chart.length > 1 && <div className="legend"><span><i style={{ background: color }} />Minutes at the bowl per day</span>{avgMin != null && <span><i className="line" style={{ background: C.axis }} />Typical day</span>}</div>}>
      {chart.length > 1 ? (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%">
            <CartesianGrid stroke={C.grid} vertical={false} />
            {avgMin != null && <ReferenceLine y={avgMin} stroke={C.axis} strokeDasharray="4 3" />}
            <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: C.grid }} minTickGap={20} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={36} />
            <Tooltip cursor={{ fill: 'rgba(29,33,51,.05)' }} content={<Tip render={p => <><b>{fmt.weekday(p.d)}</b>{p.min} minutes, {p.sessions ?? '?'} visits to the bowl</>} />} />
            <Bar dataKey="min" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      ) : <p className="empty">Daily eating history starts building today. The chart appears after a couple of days.</p>}
    </Block>
  );
}

// ── Drinking (PetLibro RFID fountain) ──────────────────────────────────────
export function WaterBlock({ cat, data, vital }) {
  const hist = (data?.history || []).filter(h => h.drink_ml != null);
  if (!hist.some(h => h.drink_ml > 0)) return null;
  const full = hist.slice(0, -1).filter(h => h.drink_ml > 0);
  const avg = full.length ? full.reduce((a, h) => a + h.drink_ml, 0) / full.length : null;
  const today = data?.today;
  let takeaway = `How much ${cat} drank from the fountain each day. The fountain reads ${cat}'s tag, so this is ${cat}'s water only.`;
  if (vital?.value != null) {
    takeaway += ` Last week averaged about ${vital.value} mL a day` + (vital.baseline ? ` (before that, ${vital.baseline} mL).` : '.');
  }
  if (today?.drink_ml != null) takeaway += ` Today so far: ${today.drink_ml} mL over ${today.drinks} drinks.`;
  const chart = hist.map(h => ({ d: h.day, label: fmt.day(h.day), ml: h.drink_ml, n: h.drinks }));
  return (
    <Block title="Drinking" takeaway={takeaway}
      legend={<div className="legend"><span><i style={{ background: '#4B8FD1' }} />mL from the fountain</span>{avg != null && <span><i className="line" style={{ background: C.axis }} />Typical day</span>}</div>}>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%">
          <CartesianGrid stroke={C.grid} vertical={false} />
          {avg != null && <ReferenceLine y={avg} stroke={C.axis} strokeDasharray="4 3" />}
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: C.grid }} minTickGap={20} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} />
          <Tooltip cursor={{ fill: 'rgba(29,33,51,.05)' }} content={<Tip render={p => <><b>{fmt.weekday(p.d)}</b>{p.ml} mL over {p.n} drinks</>} />} />
          <Bar dataKey="ml" fill="#4B8FD1" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </Block>
  );
}
