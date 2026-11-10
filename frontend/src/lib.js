import axios from 'axios';

export const API = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';
export const ORIGIN = API.replace(/\/api\/?$/, '');
export const http = axios.create({ baseURL: API, timeout: 30000 });

export const CATS = ['Lychee', 'Guava'];
export const CAT_COLOR = { Lychee: '#5A54C8', Guava: '#E0607E' };
export const CAT_SOFT = { Lychee: '#ECEBFA', Guava: '#FCEAEF' };
export const catVars = cat => ({ '--cat': CAT_COLOR[cat] || '#7F869A', '--cat-soft': CAT_SOFT[cat] || '#E8ECF2' });

// Day-only strings ("2026-11-09") parse as UTC midnight, which shows as the
// previous day in US time zones. Treat them as local dates.
export const toDate = s => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? new Date(`${s}T00:00:00`) : new Date(s);

export const fmt = {
  day: s => toDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  weekday: s => toDate(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
  time: s => toDate(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
  clock: s => toDate(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  lbs: v => (v ? `${Number(v).toFixed(2)} lbs` : '--'),
  dur: v => (v ? (v >= 60 ? `${Math.floor(v / 60)}m ${String(v % 60).padStart(2, '0')}s` : `${v}s`) : '--'),
  hourLong: h => (h === 0 ? 'midnight' : h === 12 ? 'noon' : h < 12 ? `${h} AM` : `${h - 12} PM`),
  hour: h => (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`),
};

export const ago = s => {
  const mins = Math.round((Date.now() - toDate(s).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} hr ago` : fmt.time(s);
};

export const photoSrc = profile => {
  if (!profile) return null;
  if (profile.photo) return `${ORIGIN}${profile.photo}`;
  return profile.whisker_photo || null;
};
