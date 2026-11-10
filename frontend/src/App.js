import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';

const API = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:       '#0a0a0f',
  surface:  '#111118',
  surfaceHover: '#16161f',
  border:   '#1e1e2a',
  borderHover: '#2a2a3a',
  text:     '#e8e8f0',
  textMid:  '#8888a0',
  textDim:  '#44445a',
  lychee:   '#7c6f9e',  // muted lavender
  guava:    '#9e7c6f',  // muted terracotta
  urine:    '#6f8f9e',  // muted slate blue
  feces:    '#9e8f6f',  // muted amber
  green:    '#4a7a5a',
  yellow:   '#8a7a3a',
  red:      '#7a3a3a',
  unknown:  '#3a3a4a',
  mono:     "'DM Mono', monospace",
  sans:     "'Inter', -apple-system, sans-serif"
};

// ── Tiny utilities ────────────────────────────────────────────────────────────
// Day-only strings ("2026-11-09") parse as UTC midnight, which shows as the
// previous day in US time zones. Treat them as local dates instead.
const toDate = s => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? new Date(`${s}T00:00:00`) : new Date(s);

const fmt = {
  g: v => v ? `${Math.round(v)}g` : '--',
  lbs: v => v ? `${Number(v).toFixed(2)} lbs` : '--',
  dur: v => v ? (v >= 60 ? `${Math.round(v/60)}m ${v%60}s` : `${v}s`) : '--',
  pct: v => v != null ? `${Math.round(v)}%` : '--',
  date: s => toDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  time: s => toDate(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
};

// ── Base components ───────────────────────────────────────────────────────────
function Card({ children, style, accent }) {
  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${accent ? accent + '30' : T.border}`,
      borderRadius: 12,
      padding: 24,
      ...style
    }}>
      {children}
    </div>
  );
}

function Label({ children, style }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.12em',
      textTransform: 'uppercase', color: T.textDim,
      fontFamily: T.mono, marginBottom: 10, ...style
    }}>
      {children}
    </div>
  );
}

function Pill({ status, label }) {
  const map = {
    green:  { bg: T.green  + '30', color: '#6ab87a' },
    yellow: { bg: T.yellow + '30', color: '#c4a44a' },
    red:    { bg: T.red    + '30', color: '#c46a6a' },
  };
  const s = map[status] || map.green;
  return (
    <span style={{
      background: s.bg, color: s.color,
      borderRadius: 4, padding: '2px 8px',
      fontSize: 10, fontWeight: 600, fontFamily: T.mono,
      letterSpacing: '0.08em'
    }}>
      {label?.toUpperCase()}
    </span>
  );
}

function Divider() {
  return <div style={{ height: 1, background: T.border, margin: '20px 0' }} />;
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────
const ChartTip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#0f0f18', border: `1px solid ${T.border}`,
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
      fontFamily: T.mono, color: T.textMid
    }}>
      <div style={{ marginBottom: 6, color: T.textDim }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color || T.text }}>
          {p.name}: <span style={{ color: T.text }}>{p.value}{unit || ''}</span>
        </div>
      ))}
    </div>
  );
};

// ── Small stat box ────────────────────────────────────────────────────────────
function StatBox({ label, value, sub, status, extra, accent }) {
  return (
    <div style={{
      background: T.bg, border: `1px solid ${T.border}`,
      borderRadius: 8, padding: '14px 16px', flex: 1, minWidth: 100
    }}>
      <div style={{ fontSize: 10, fontFamily: T.mono, color: T.textDim, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color: T.text, lineHeight: 1, marginBottom: 6 }}>
        {value}
        {sub && <span style={{ fontSize: 11, color: T.textDim, fontWeight: 400, marginLeft: 4 }}>{sub}</span>}
      </div>
      {extra > 0 && (
        <div style={{ fontSize: 10, color: '#c4a44a', fontFamily: T.mono, marginBottom: 6 }}>
          +{extra} unidentified
        </div>
      )}
      {status && <Pill status={status} label={status} />}
    </div>
  );
}

// ── Hour heatmap ──────────────────────────────────────────────────────────────
function HourHeatmap({ data, accent }) {
  if (!data) return null;
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const max = Math.max(...hours.map(h => (data[h]?.urine||0) + (data[h]?.feces||0)), 1);
  const lbl = h => h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h-12}p`;
  return (
    <div>
      <div style={{ display: 'flex', gap: 3 }}>
        {hours.map(h => {
          const total = (data[h]?.urine||0) + (data[h]?.feces||0);
          const alpha = total === 0 ? '0f' : Math.round((total/max) * 200 + 40).toString(16).padStart(2,'0');
          return (
            <div key={h} title={`${lbl(h)}: ${data[h]?.urine||0}u ${data[h]?.feces||0}f`} style={{
              flex: 1, height: 24, borderRadius: 3,
              background: total === 0 ? T.border : `${accent}${alpha}`,
              cursor: 'default'
            }} />
          );
        })}
      </div>
      <div style={{ display: 'flex', marginTop: 4 }}>
        {hours.map(h => (
          <div key={h} style={{ flex: 1, fontSize: 8, color: T.textDim, fontFamily: T.mono, textAlign: 'center' }}>
            {h % 6 === 0 ? lbl(h) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Weight trend mini chart ───────────────────────────────────────────────────
function WeightChart({ data, accent }) {
  if (!data || Object.keys(data).length < 2) return (
    <div style={{ color: T.textDim, fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
      Insufficient weight data
    </div>
  );
  const chartData = Object.entries(data)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([date, val]) => ({ date: fmt.date(date), weight: Number(val.toFixed(2)) }));
  const weights = chartData.map(d => d.weight);
  const min = Math.floor((Math.min(...weights) - 0.3) * 10) / 10;
  const max = Math.ceil((Math.max(...weights) + 0.3) * 10) / 10;
  const avg = Number((weights.reduce((a,b)=>a+b,0)/weights.length).toFixed(2));
  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={chartData} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={T.border} />
        <XAxis dataKey="date" tick={{ fontSize: 9, fill: T.textDim, fontFamily: T.mono }} interval="preserveStartEnd" />
        <YAxis domain={[min, max]} tick={{ fontSize: 9, fill: T.textDim, fontFamily: T.mono }} />
        <Tooltip content={<ChartTip unit=" lbs" />} />
        <ReferenceLine y={avg} stroke={T.textDim} strokeDasharray="3 3" />
        <Line type="monotone" dataKey="weight" name="Weight" stroke={accent} strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Duration chart ────────────────────────────────────────────────────────────
function DurationChart({ data, accent }) {
  if (!data || Object.keys(data).length < 2) return (
    <div style={{ color: T.textDim, fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
      Insufficient duration data
    </div>
  );
  const chartData = Object.entries(data)
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([date, val]) => ({ date: fmt.date(date), seconds: Math.round(val) }));
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={T.border} />
        <XAxis dataKey="date" tick={{ fontSize: 9, fill: T.textDim, fontFamily: T.mono }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 9, fill: T.textDim, fontFamily: T.mono }} />
        <Tooltip content={<ChartTip unit="s" />} />
        <Bar dataKey="seconds" name="Avg duration" fill={accent} opacity={0.7} radius={[2,2,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Visit trend chart ─────────────────────────────────────────────────────────
function VisitChart({ weekData, monthData, quarterData, yearData, accent }) {
  const [range, setRange] = useState('30d');

  const build = (src, labelFn) =>
    Object.entries(src||{}).sort(([a],[b]) => a.localeCompare(b)).map(([d,v]) => ({
      date: labelFn(d),
      Urine: v.urine, Feces: v.feces,
      Max: v.total + (v.unknown||0)
    }));

  const data =
    range === '7d'  ? build(weekData, d => toDate(d).toLocaleDateString('en-US',{weekday:'short',month:'numeric',day:'numeric'})) :
    range === '30d' ? build(monthData, d => fmt.date(d)) :
    range === '90d' ? build(quarterData, d => `Wk ${fmt.date(d)}`) :
    build(yearData, d => `Wk ${fmt.date(d)}`);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {['7d','30d','90d','1y'].map(r => (
          <button key={r} onClick={() => setRange(r)} style={{
            background: range === r ? T.borderHover : 'transparent',
            border: `1px solid ${range === r ? T.borderHover : T.border}`,
            borderRadius: 4, padding: '3px 10px',
            color: range === r ? T.text : T.textDim,
            fontSize: 10, fontFamily: T.mono, cursor: 'pointer',
            letterSpacing: '0.08em'
          }}>{r.toUpperCase()}</button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
          <defs>
            <linearGradient id={`gu-${accent}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={T.urine} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={T.urine} stopOpacity={0}/>
            </linearGradient>
            <linearGradient id={`gf-${accent}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={accent} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={accent} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke={T.border} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: T.textDim, fontFamily: T.mono }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9, fill: T.textDim, fontFamily: T.mono }} />
          <Tooltip content={<ChartTip />} />
          <Area type="monotone" dataKey="Max" name="Max possible" stroke={T.textDim} fill="none" strokeDasharray="3 3" strokeWidth={1} dot={false} />
          <Area type="monotone" dataKey="Urine" stroke={T.urine} fill={`url(#gu-${accent})`} strokeWidth={1.5} dot={false} />
          <Area type="monotone" dataKey="Feces" stroke={accent} fill={`url(#gf-${accent})`} strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
        {[['Urine', T.urine], ['Feces', accent], ['Max possible', T.textDim]].map(([name, color]) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 16, height: 1.5, background: color }} />
            <span style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono }}>{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Cat panel ─────────────────────────────────────────────────────────────────
function CatPanel({ cat, data, accent }) {
  const [tab, setTab] = useState('overview');
  if (!data) return (
    <Card style={{ flex: 1 }}>
      <div style={{ color: T.textMid, fontSize: 14 }}>{cat}: no data yet</div>
    </Card>
  );

  const { today, averages, week_trend, month_trend, quarter_trend, year_trend, hour_pattern, weight_trend, duration_trend } = data;
  const isGuava = cat === 'Guava';
  const hasAlert = today.feces_status === 'red' || today.urine_status === 'red';
  const latestWeightLbs = averages.latest_weight_lbs ? averages.latest_weight_lbs.toFixed(2) : null;
  const weightChange = averages.latest_weight_lbs && averages.baseline_weight_lbs
    ? ((averages.latest_weight_lbs - averages.baseline_weight_lbs) / averages.baseline_weight_lbs) * 100 : null;

  const tabs = ['overview', 'trends', 'weight', 'patterns'];

  return (
    <Card style={{ flex: 1, minWidth: 0 }} accent={accent}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
            <span style={{ fontSize: 18, fontWeight: 600, color: T.text, letterSpacing: '-0.01em' }}>{cat}</span>
            {isGuava && (
              <span style={{ fontSize: 9, fontFamily: T.mono, color: accent, background: accent+'20', padding: '2px 7px', borderRadius: 3 }}>
                GI WATCH
              </span>
            )}
          </div>
          {latestWeightLbs && (
            <div style={{ fontSize: 11, color: T.textDim, fontFamily: T.mono, marginTop: 4 }}>
              {latestWeightLbs} lbs · {averages.total_days_tracked || averages.days_tracked}d tracked
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono }}>daily avg</div>
          <div style={{ fontSize: 13, color: T.textMid, fontFamily: T.mono, marginTop: 2 }}>
            {averages.daily_urine}u · {averages.daily_feces}f
          </div>
        </div>
      </div>

      {/* Alert */}
      {hasAlert && isGuava && (
        <div style={{
          background: T.red + '20', border: `1px solid ${T.red}40`,
          borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#c46a6a'
        }}>
          GI alert: {today.feces} confirmed bowel movements today
        </div>
      )}

      {/* Unknown notice */}
      {today.unknown_total > 0 && (
        <div style={{
          background: T.unknown, border: `1px solid ${T.border}`,
          borderRadius: 6, padding: '8px 12px', marginBottom: 16,
          fontSize: 11, color: T.textMid, fontFamily: T.mono
        }}>
          {today.unknown_total} unidentified visit{today.unknown_total > 1 ? 's' : ''} today could be {cat}
          {today.likely_total > 0 ? ` (${today.likely_total} match ${cat}'s weight)` : ''}. Counts below may be understated.
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: `1px solid ${T.border}`, paddingBottom: 0 }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'transparent', border: 'none',
            borderBottom: tab === t ? `1px solid ${accent}` : '1px solid transparent',
            padding: '6px 12px', marginBottom: -1,
            color: tab === t ? T.text : T.textDim,
            fontSize: 11, fontFamily: T.mono, cursor: 'pointer',
            letterSpacing: '0.08em', textTransform: 'uppercase'
          }}>{t}</button>
        ))}
      </div>

      {/* Tab: Overview */}
      {tab === 'overview' && (
        <div>
          <Label>Today's confirmed activity</Label>
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
            <StatBox label="Urine" value={today.urine} sub="visits" status={today.urine_status} extra={today.unknown_urine} accent={accent} />
            <StatBox label="Feces" value={today.feces} sub="visits" status={today.feces_status} extra={today.unknown_feces} accent={accent} />
            <StatBox label="Total" value={today.total} sub="visits" extra={today.unknown_total} accent={accent} />
          </div>
          <Label>7-day visit pattern</Label>
          <VisitChart weekData={week_trend} monthData={month_trend} quarterData={quarter_trend} yearData={year_trend} accent={accent} />
        </div>
      )}

      {/* Tab: Trends */}
      {tab === 'trends' && (
        <div>
          <Label>Visit trends (30d)</Label>
          <VisitChart weekData={week_trend} monthData={month_trend} quarterData={quarter_trend} yearData={year_trend} accent={accent} />
          <Divider />
          <Label>Avg visit duration per day (seconds)</Label>
          <DurationChart data={duration_trend} accent={accent} />
          <div style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, marginTop: 8 }}>
            Longer visits may indicate straining or discomfort
          </div>
        </div>
      )}

      {/* Tab: Weight */}
      {tab === 'weight' && (
        <div>
          <Label>Daily median weight (lbs, 90d, outliers removed)</Label>
          <WeightChart data={weight_trend} accent={accent} />
          <div style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, marginTop: 8, marginBottom: 20 }}>
            Readings that don't fit this cat's recent range are left out. See flagged visits below.
          </div>
          <Divider />
          <div style={{ display: 'flex', gap: 20 }}>
            <div>
              <div style={{ fontSize: 10, fontFamily: T.mono, color: T.textDim, marginBottom: 4 }}>LATEST</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: T.text }}>{fmt.lbs(averages.latest_weight_lbs)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontFamily: T.mono, color: T.textDim, marginBottom: 4 }}>30-DAY BASELINE</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: T.textMid }}>{fmt.lbs(averages.baseline_weight_lbs)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontFamily: T.mono, color: T.textDim, marginBottom: 4 }}>CHANGE</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: weightChange != null && weightChange <= -4 ? '#c46a6a' : T.textMid }}>
                {weightChange != null ? `${weightChange > 0 ? '+' : ''}${weightChange.toFixed(1)}%` : '--'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Patterns */}
      {tab === 'patterns' && (
        <div>
          <Label>Activity by hour of day (90d)</Label>
          <HourHeatmap data={hour_pattern} accent={accent} />
          <div style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, marginTop: 10 }}>
            Darker = more visits at that hour
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Recent visits table ───────────────────────────────────────────────────────
const catColor = c => c === 'Lychee' ? T.lychee : c === 'Guava' ? T.guava : T.textDim;

function SmallBtn({ children, onClick, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      background: 'transparent', border: `1px solid ${T.border}`, borderRadius: 4,
      padding: '2px 7px', color: T.textMid, fontSize: 9, fontFamily: T.mono,
      cursor: 'pointer', letterSpacing: '0.06em', marginRight: 4
    }}>{children}</button>
  );
}

function RecentVisits({ onChanged }) {
  const [visits, setVisits] = useState([]);
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/litter/recent`, { params: { limit: flaggedOnly ? 100 : 30, flagged_only: flaggedOnly } });
      setVisits(r.data);
    } catch {}
  }, [flaggedOnly]);

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const act = async (id, body) => {
    try {
      if (body) await axios.post(`${API}/visits/${id}/override`, body);
      else await axios.delete(`${API}/visits/${id}/override`);
      await load();
      if (onChanged) onChanged();
    } catch {}
  };

  const quiet = /No waste weight|No weight reading|Very short visit/;

  return (
    <Card style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Label style={{ marginBottom: 0 }}>{flaggedOnly ? 'Flagged visits (60d)' : 'Recent visits'}</Label>
        <SmallBtn onClick={() => setFlaggedOnly(f => !f)}>{flaggedOnly ? 'SHOW ALL' : 'SHOW FLAGGED'}</SmallBtn>
      </div>
      {!visits.length && <div style={{ color: T.textDim, fontSize: 12, fontFamily: T.mono }}>Nothing to show.</div>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: T.mono }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              {['Cat', 'Time', 'Type', 'Duration', 'Weight', 'Waste', 'Data check', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: T.textDim, fontWeight: 500, fontSize: 10, letterSpacing: '0.08em' }}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visits.map(v => {
              const counted = v.counted_as;
              const inferred = v.flags.includes('inferred_by_weight');
              const badWeight = ['weight_outlier', 'weight_partial', 'matches_other_cat'].some(f => v.flags.includes(f));
              const notes = v.reason ? v.reason.split('; ').filter(r => !quiet.test(r) && !(inferred && /No cat tag/.test(r))) : [];
              const issue = notes.length > 0;
              const label = counted || (v.likely_cat ? `${v.likely_cat}?` : 'Unknown');
              const struck = { color: T.textDim, textDecoration: 'line-through' };
              return (
                <tr key={v.id} style={{ borderBottom: `1px solid ${T.border}`, opacity: counted ? 1 : 0.6 }}>
                  <td style={{ padding: '8px 10px', color: catColor(counted || v.likely_cat), fontWeight: 500 }}>
                    {label}
                    {v.reported_cat !== 'Unknown' && v.reported_cat !== counted && (
                      <div style={{ fontSize: 9, color: T.textDim }}>tagged {v.reported_cat}</div>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px', color: T.textMid, whiteSpace: 'nowrap' }}>{fmt.time(v.timestamp)}</td>
                  <td style={{ padding: '8px 10px', color: v.waste_type === 'Urine' ? T.urine : v.waste_type === 'Feces' ? T.feces : T.textDim }}>{v.waste_type || '-'}</td>
                  <td style={{ padding: '8px 10px', color: T.textMid }}>{fmt.dur(v.duration_seconds)}</td>
                  <td style={{ padding: '8px 10px', ...(badWeight ? struck : { color: T.textMid }) }}>{fmt.lbs(v.weight_lbs)}</td>
                  <td style={{ padding: '8px 10px', ...(v.flags.includes('waste_outlier') ? struck : { color: T.textMid }) }}>{fmt.g(v.waste_weight)}</td>
                  <td style={{ padding: '8px 10px', fontSize: 10, color: issue ? '#c4a44a' : T.textDim, maxWidth: 220 }}>
                    {issue ? notes.join('; ') : 'OK'}
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                    {v.override ? (
                      <SmallBtn onClick={() => act(v.id, null)} title="Undo your change">UNDO</SmallBtn>
                    ) : (
                      <>
                        {v.likely_cat && (
                          <SmallBtn onClick={() => act(v.id, { action: 'assign', assign_to: v.likely_cat })} title={`Count this as ${v.likely_cat}`}>
                            IS {v.likely_cat.toUpperCase()}
                          </SmallBtn>
                        )}
                        {issue && v.reported_cat !== 'Unknown' && (
                          <SmallBtn onClick={() => act(v.id, { action: 'include' })} title="Reading is fine, keep it">KEEP</SmallBtn>
                        )}
                        <SmallBtn onClick={() => act(v.id, { action: 'exclude' })} title="Leave this visit out of all stats">DROP</SmallBtn>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Alerts panel ──────────────────────────────────────────────────────────────
function AlertsPanel() {
  const [data, setData] = useState(null);
  const [testMsg, setTestMsg] = useState('');
  const load = useCallback(async () => {
    try { const r = await axios.get(`${API}/alerts`, { params: { limit: 8 } }); setData(r.data); } catch {}
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const test = async () => {
    try {
      const r = await axios.post(`${API}/alerts/test`);
      setTestMsg(r.data.delivered.length ? `Sent via ${r.data.delivered.join(', ')}` : 'No channel set up yet');
    } catch (e) { setTestMsg(e.response?.status === 429 ? 'Wait a minute' : 'Failed'); }
  };

  const ch = data?.channels || {};
  const sevColor = { critical: '#c46a6a', warning: '#c4a44a', info: T.textMid };
  const on = [ch.ntfy && 'push', ch.sms && 'text'].filter(Boolean);
  return (
    <Card style={{ flex: 1, minWidth: 280 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Label style={{ marginBottom: 0 }}>Alerts</Label>
        <SmallBtn onClick={test}>SEND TEST</SmallBtn>
      </div>
      <div style={{ fontSize: 10, fontFamily: T.mono, color: on.length ? '#6ab87a' : '#c4a44a', marginBottom: 12 }}>
        {on.length ? `Notifying by ${on.join(' + ')}` : 'No notification channel set. Alerts only show here.'}
        {ch.quiet_hours ? ` · quiet ${ch.quiet_hours}` : ''}{testMsg ? ` · ${testMsg}` : ''}
      </div>
      {!data?.alerts?.length && <div style={{ color: T.textDim, fontSize: 12, fontFamily: T.mono }}>No alerts. All quiet.</div>}
      {data?.alerts?.map(a => (
        <div key={a.id} style={{ borderLeft: `2px solid ${sevColor[a.severity] || T.textDim}`, padding: '4px 10px', marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: T.text }}>{a.title}</div>
          <div style={{ fontSize: 11, color: T.textMid, marginTop: 2 }}>{a.message}</div>
          <div style={{ fontSize: 9, color: T.textDim, fontFamily: T.mono, marginTop: 3 }}>
            {fmt.time(a.created_at)}{a.delivered === 'held' ? ' · held for quiet hours' : ''}
          </div>
        </div>
      ))}
    </Card>
  );
}

// ── Data quality panel ────────────────────────────────────────────────────────
function QualityPanel({ syncStatus, refreshKey }) {
  const [q, setQ] = useState(null);
  useEffect(() => { axios.get(`${API}/quality`).then(r => setQ(r.data)).catch(() => {}); }, [refreshKey]);
  const rows = q ? [
    ['Visits checked', q.visits],
    ['Weight outliers left out', q.weight_outliers],
    ['Likely mislabeled cat', q.mislabeled],
    ['Untagged, matched by weight', q.inferred],
    ['Untagged, no match', Math.max(0, q.unidentified - q.inferred)],
    ['Waste weight outliers', q.waste_outliers],
    ['Your manual fixes', q.manual],
  ] : [];
  return (
    <Card style={{ flex: 1, minWidth: 280 }}>
      <Label>Data quality (30d)</Label>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: T.mono, color: T.textMid, padding: '3px 0' }}>
          <span>{k}</span><span style={{ color: T.text }}>{v}</span>
        </div>
      ))}
      <Divider />
      <div style={{ fontSize: 10, fontFamily: T.mono, color: syncStatus?.persistent ? T.textDim : '#c4a44a' }}>
        {syncStatus?.persistent ? 'History is saved and keeps growing' : 'Storage is not persistent. History resets on redeploy.'}
        {syncStatus?.first_visit ? ` · since ${fmt.date(syncStatus.first_visit)}` : ''}
      </div>
      <a href={`${API}/export.csv`} style={{ display: 'inline-block', marginTop: 10, fontSize: 10, fontFamily: T.mono, color: T.textMid }}>
        DOWNLOAD CSV FOR VET
      </a>
    </Card>
  );
}

// ── Robot status bar ──────────────────────────────────────────────────────────
function RobotStatus({ status }) {
  if (!status) return null;
  const drawerPct = status.waste_drawer_level;
  const drawerColor = drawerPct == null ? T.textDim : drawerPct > 80 ? '#c46a6a' : drawerPct > 60 ? '#c4a44a' : '#6ab87a';

  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 8, padding: '12px 20px',
      display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center',
      marginBottom: 20
    }}>
      <div>
        <span style={{ fontSize: 10, fontFamily: T.mono, color: T.textDim, marginRight: 10 }}>LITTER-ROBOT 5 PRO</span>
        <span style={{ fontSize: 10, fontFamily: T.mono, color: status.is_online === 0 ? '#c46a6a' : '#6ab87a' }}>● {status.is_online === 0 ? 'OFFLINE' : 'ONLINE'}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontFamily: T.mono, color: T.textDim }}>WASTE DRAWER</span>
        <div style={{ width: 60, height: 6, background: T.border, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${drawerPct || 0}%`, height: '100%', background: drawerColor, borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
        <span style={{ fontSize: 10, fontFamily: T.mono, color: drawerColor }}>{fmt.pct(drawerPct)}</span>
      </div>
      {status.litter_level && (
        <div>
          <span style={{ fontSize: 10, fontFamily: T.mono, color: T.textDim }}>LITTER </span>
          <span style={{ fontSize: 10, fontFamily: T.mono, color: T.textMid }}>{status.litter_level}</span>
        </div>
      )}
      {status.last_checked && (
        <div style={{ marginLeft: 'auto', fontSize: 10, fontFamily: T.mono, color: T.textDim }}>
          checked {fmt.time(status.last_checked)}
        </div>
      )}
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────
export default function App() {
  const [summary, setSummary] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [syncStatus, setSyncStatus] = useState(null);
  const [robotStatus, setRobotStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [historicalSyncing, setHistoricalSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState('Lychee');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 900);
  const [backendOk, setBackendOk] = useState(null);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      await axios.get(`${API}/health`);
      setBackendOk(true);
      const [s, st, rs] = await Promise.all([
        axios.get(`${API}/litter/summary`),
        axios.get(`${API}/sync/status`),
        axios.get(`${API}/robot/status`)
      ]);
      setSummary(s.data);
      setRefreshKey(k => k + 1);
      setSyncStatus(st.data);
      setRobotStatus(rs.data);
    } catch {
      setBackendOk(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60000);
    return () => clearInterval(t);
  }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    try { await axios.post(`${API}/sync`); await fetchData(); } catch {}
    setSyncing(false);
  };

  const handleHistoricalSync = async () => {
    setHistoricalSyncing(true);
    try {
      await axios.post(`${API}/sync/historical`);
      setTimeout(async () => { await fetchData(); setHistoricalSyncing(false); }, 35000);
    } catch { setHistoricalSyncing(false); }
  };

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: T.sans }}>

      {/* Header */}
      <div style={{
        borderBottom: `1px solid ${T.border}`,
        padding: '16px 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
        position: 'sticky', top: 0, background: T.bg, zIndex: 100
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: T.text, letterSpacing: '-0.01em' }}>
            Cat Health Monitor
          </div>
          <div style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, marginTop: 2 }}>
            {dateStr} · {timeStr}
            {syncStatus?.total_visits_stored ? ` · ${syncStatus.total_visits_stored} visits` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {backendOk === false && (
            <span style={{ fontSize: 10, fontFamily: T.mono, color: '#c46a6a' }}>● OFFLINE</span>
          )}
          <button onClick={handleHistoricalSync} disabled={historicalSyncing} style={{
            background: 'transparent', border: `1px solid ${T.border}`,
            borderRadius: 6, padding: '7px 14px',
            color: historicalSyncing ? T.textDim : T.textMid,
            fontSize: 11, fontFamily: T.mono, cursor: historicalSyncing ? 'not-allowed' : 'pointer',
            letterSpacing: '0.06em'
          }}>
            {historicalSyncing ? 'SYNCING...' : 'FULL HISTORY'}
          </button>
          <button onClick={handleSync} disabled={syncing} style={{
            background: syncing ? T.border : T.surface,
            border: `1px solid ${T.borderHover}`,
            borderRadius: 6, padding: '7px 14px',
            color: syncing ? T.textDim : T.text,
            fontSize: 11, fontFamily: T.mono, cursor: syncing ? 'not-allowed' : 'pointer',
            letterSpacing: '0.06em'
          }}>
            {syncing ? 'SYNCING...' : 'SYNC'}
          </button>
        </div>
      </div>

      <div style={{ padding: isMobile ? '20px 16px' : '24px 28px', maxWidth: 1400, margin: '0 auto' }}>

        {/* Robot status */}
        <RobotStatus status={robotStatus} />

        {/* Mobile cat tabs */}
        {isMobile && (
          <div style={{ display: 'flex', gap: 2, marginBottom: 16, background: T.surface, borderRadius: 8, padding: 3, border: `1px solid ${T.border}` }}>
            {['Lychee', 'Guava'].map(cat => (
              <button key={cat} onClick={() => setActiveTab(cat)} style={{
                flex: 1, padding: '8px 0', borderRadius: 6, border: 'none',
                background: activeTab === cat ? T.bg : 'transparent',
                color: activeTab === cat ? T.text : T.textDim,
                fontSize: 12, fontFamily: T.mono, cursor: 'pointer',
                letterSpacing: '0.06em'
              }}>{cat.toUpperCase()}</button>
            ))}
          </div>
        )}

        {/* Cat panels */}
        <div style={{ display: 'flex', gap: 20, flexDirection: isMobile ? 'column' : 'row' }}>
          {isMobile
            ? <CatPanel cat={activeTab} data={summary?.[activeTab]} accent={activeTab === 'Lychee' ? T.lychee : T.guava} />
            : ['Lychee', 'Guava'].map(cat => (
                <CatPanel key={cat} cat={cat} data={summary?.[cat]} accent={cat === 'Lychee' ? T.lychee : T.guava} />
              ))
          }
        </div>

        {/* Alerts and data quality */}
        <div style={{ display: 'flex', gap: 20, marginTop: 20, flexDirection: isMobile ? 'column' : 'row' }}>
          <AlertsPanel />
          <QualityPanel syncStatus={syncStatus} refreshKey={refreshKey} />
        </div>

        {/* Recent visits */}
        <RecentVisits onChanged={fetchData} />

        {/* Reference */}
        <Card style={{ marginTop: 20 }}>
          <Label>Health reference</Label>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 11, fontFamily: T.mono, color: T.textDim }}>
            <span>URINE  2 to 4x/day normal · over 6x alert</span>
            <span>FECES  1 to 2x/day normal · over 3x alert</span>
            <span>DURATION  longer visits may indicate straining</span>
            <span>WEIGHT  a sustained drop of 4% or more triggers an alert</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
