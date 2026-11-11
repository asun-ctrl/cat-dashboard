import axios from 'axios';

export const API = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';
export const ORIGIN = API.replace(/\/api\/?$/, '');
export const http = axios.create({ baseURL: API, timeout: 30000 });

// Passcode: saved on this device after the first successful entry.
const KEY = 'lg-passcode';
export const getPasscode = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
export const setPasscode = v => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} };
export const withCode = url => { const k = getPasscode(); return k ? `${url}${url.includes('?') ? '&' : '?'}k=${encodeURIComponent(k)}` : url; };

http.interceptors.request.use(cfg => {
  const k = getPasscode();
  if (k) cfg.headers['X-Passcode'] = k;
  return cfg;
});
http.interceptors.response.use(r => r, err => {
  if (err.response?.status === 401 && !err.config.url.includes('/auth/check')) {
    window.dispatchEvent(new Event('lg-locked'));
  }
  return Promise.reject(err);
});

export const CATS = ['Lychee', 'Guava'];
const SLUG = { Lychee: 'lychee', Guava: 'guava' };
export const catVars = cat => (SLUG[cat]
  ? { '--cat': `var(--${SLUG[cat]})`, '--cat-soft': `var(--${SLUG[cat]}-soft)` }
  : { '--cat': 'var(--ink-3)', '--cat-soft': 'var(--surface-2)' });
export const catColor = cat => (SLUG[cat] ? `var(--${SLUG[cat]})` : 'var(--ink-3)');

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
  if (profile.photo) return withCode(`${ORIGIN}${profile.photo}`);
  return null;
};

export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const localDay = s => { const d = toDate(s); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const mins = sec => { if (sec == null) return '--'; const m = sec / 60; return m >= 10 ? Math.round(m) : Math.round(m * 10) / 10; };
