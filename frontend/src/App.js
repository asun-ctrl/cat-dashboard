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
const fmt = {
  g: v => v ? `${Math.round(v)}g` : '--',
  lbs: v => v ? `${(v / 453.6).toFixed(1)} lbs` : '--',
  dur: v => v ? (v >= 60 ? `${Math.round(v/60)}m ${v%60}s` : `${v}s`) : '--',
  pct: v => v != null ? `${Math.round(v)}%` : '--',
  date: s => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  time: s => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
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
    .map(([date, val]) => ({ date: fmt.date(date), weight: Math.round(val) }));
  const weights = chartData.map(d => d.weight);
  const min = Math.min(...weights) - 20;
  const max = Math.max(...weights) + 20;
  const avg = Math.round(weights.reduce((a,b)=>a+b,0)/weights.length);
  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={chartData} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" stroke={T.border} />
        <XAxis dataKey="date" tick={{ fontSize: 9, fill: T.textDim, fontFamily: T.mono }} interval="preserveStartEnd" />
        <YAxis domain={[min, max]} tick={{ fontSize: 9, fill: T.textDim, fontFamily: T.mono }} />
        <Tooltip content={<ChartTip unit="g" />} />
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
function VisitChart({ weekData, monthData, quarterData, accent }) {
  const [range, setRange] = useState('30d');

  const build = (src, labelFn) =>
    Object.entries(src||{}).sort(([a],[b]) => a.localeCompare(b)).map(([d,v]) => ({
      date: labelFn(d),
      Urine: v.urine, Feces: v.feces,
      Max: v.total + (v.unknown||0)
    }));

  const data =
    range === '7d'  ? build(weekData, d => new Date(d).toLocaleDateString('en-US',{weekday:'short',month:'numeric',day:'numeric'})) :
    range === '30d' ? build(monthData, d => fmt.date(d)) :
    build(quarterData, d => `Wk ${fmt.date(d)}`);

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {['7d','30d','90d'].map(r => (
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
      <div style={{ color: T.textMid, fontSize: 14 }}>{cat} — no data yet</div>
    </Card>
  );

  const { today, averages, week_trend, month_trend, quarter_trend, hour_pattern, weight_trend, duration_trend } = data;
  const isGuava = cat === 'Guava';
  const hasAlert = today.feces_status === 'red' || today.urine_status === 'red';
  const latestWeightLbs = averages.latest_weight_grams ? (averages.latest_weight_grams / 453.6).toFixed(1) : null;

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
              {latestWeightLbs} lbs · {averages.days_tracked}d tracked
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
          GI alert — {today.feces} confirmed bowel movements today
        </div>
      )}

      {/* Unknown notice */}
      {today.unknown_total > 0 && (
        <div style={{
          background: T.unknown, border: `1px solid ${T.border}`,
          borderRadius: 6, padding: '8px 12px', marginBottom: 16,
          fontSize: 11, color: T.textDim, fontFamily: T.mono
        }}>
          {today.unknown_total} unidentified visit{today.unknown_total > 1 ? 's' : ''} today — counts below may be understated
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
          <VisitChart weekData={week_trend} monthData={month_trend} quarterData={quarter_trend} accent={accent} />
        </div>
      )}

      {/* Tab: Trends */}
      {tab === 'trends' && (
        <div>
          <Label>Visit trends (30d)</Label>
          <VisitChart weekData={week_trend} monthData={month_trend} quarterData={quarter_trend} accent={accent} />
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
          <Label>Weight per visit (grams, 30d)</Label>
          <WeightChart data={weight_trend} accent={accent} />
          <div style={{ fontSize: 10, color: T.textDim, fontFamily: T.mono, marginTop: 8, marginBottom: 20 }}>
            Weight measured by Litter-Robot SmartScale on each visit
          </div>
          <Divider />
          <div style={{ display: 'flex', gap: 20 }}>
            <div>
              <div style={{ fontSize: 10, fontFamily: T.mono, color: T.textDim, marginBottom: 4 }}>LATEST</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: T.text }}>{fmt.lbs(averages.latest_weight_grams)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontFamily: T.mono, color: T.textDim, marginBottom: 4 }}>NORMAL RANGE</div>
              <div style={{ fontSize: 12, color: T.textMid, fontFamily: T.mono, marginTop: 4 }}>
                {isGuava ? '5–10 lbs typical' : '6–12 lbs typical'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Patterns */}
      {tab === 'patterns' && (
        <div>
          <Label>Activity by hour of day (all-time)</Label>
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
function RecentVisits({ visits }) {
  if (!visits?.length) return null;
  return (
    <Card style={{ marginTop: 20 }}>
      <Label>Recent visits</Label>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: T.mono }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              {['Cat','Time','Type','Duration','Weight','Waste wt'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 12px', color: T.textDim, fontWeight: 500, fontSize: 10, letterSpacing: '0.08em' }}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visits.slice(0, 20).map(v => {
              const isUnknown = v.cat_name === 'Unknown' || v.cat_name?.startsWith('Cat-');
              const accent = v.cat_name === 'Lychee' ? T.lychee : v.cat_name === 'Guava' ? T.guava : T.unknown;
              return (
                <tr key={v.id} style={{ borderBottom: `1px solid ${T.border}`, opacity: isUnknown ? 0.5 : 1 }}>
                  <td style={{ padding: '8px 12px', color: accent, fontWeight: 500 }}>
                    {isUnknown ? 'Unknown' : v.cat_name}
                  </td>
                  <td style={{ padding: '8px 12px', color: T.textMid }}>{fmt.time(v.timestamp)}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{
                      color: v.waste_type === 'Urine' ? T.urine : v.waste_type === 'Feces' ? T.feces : T.textDim,
                      fontWeight: 500
                    }}>
                      {v.waste_type || '—'}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', color: T.textMid }}>{fmt.dur(v.duration_seconds)}</td>
                  <td style={{ padding: '8px 12px', color: T.textMid }}>{fmt.lbs(v.weight_grams)}</td>
                  <td style={{ padding: '8px 12px', color: T.textMid }}>{fmt.g(v.waste_weight_grams)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
        <span style={{ fontSize: 10, fontFamily: T.mono, color: '#6ab87a' }}>● ONLINE</span>
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
  const [visits, setVisits] = useState([]);
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
      const [s, v, st, rs] = await Promise.all([
        axios.get(`${API}/litter/summary`),
        axios.get(`${API}/litter/recent`),
        axios.get(`${API}/sync/status`),
        axios.get(`${API}/robot/status`)
      ]);
      setSummary(s.data);
      setVisits(v.data);
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

        {/* Recent visits */}
        <RecentVisits visits={visits} />

        {/* Reference */}
        <Card style={{ marginTop: 20 }}>
          <Label>Health reference</Label>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 11, fontFamily: T.mono, color: T.textDim }}>
            <span>URINE  2–4x/day normal · &gt;6x alert</span>
            <span>FECES  1–2x/day normal · &gt;3x alert</span>
            <span>DURATION  longer visits may indicate straining</span>
            <span>WEIGHT  measured per visit by SmartScale</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
