import React, { useEffect, useState } from 'react';
import { CATS, catVars, http, photoSrc } from '../lib';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
const paths = {
  home: <><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v9h12v-9" /></>,
  chart: <><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 4-5 3 3 5-7" /></>,
  week: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  journal: <><path d="M6 4h11a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z" /><path d="M10 9h5M10 13h5" /></>,
  more: <><circle cx="6" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18" cy="12" r="1.4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <><path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" /><path d="M20 20v-4h-4" /></>,
  chev: <path d="m9 5 7 7-7 7" />,
  back: <path d="m15 5-7 7 7 7" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  eat: <><path d="M4 12h16a8 8 0 0 1-16 0z" /><path d="M9 8c0-1.5 1-1.5 1-3M14 8c0-1.5 1-1.5 1-3" /></>,
  drink: <path d="M12 3.5c3 4 5.5 6.8 5.5 10a5.5 5.5 0 0 1-11 0c0-3.2 2.5-6 5.5-10z" />,
  litter: <><path d="M4 10h16l-1.5 9h-13z" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  meal: <><path d="M7 4h10l-1 7H8z" /><path d="M10 11v3M14 11v3M6 19c2-3 10-3 12 0" /></>,
  note: <><path d="M5 19l1-4L16 5l3 3L9 18z" /><path d="M14 7l3 3" /></>,
  checkin: <><circle cx="12" cy="12" r="8" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  doc: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  device: <><rect x="5" y="4" width="14" height="16" rx="4" /><circle cx="12" cy="12" r="3.5" /></>,
  download: <><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  wand: <><path d="m5 19 9-9" /><path d="M15 4v3M19 8h-3M18 4.5 16.5 6M9 5v2M5 9h2" /></>,
  share: <><path d="M12 15V4M8 8l4-4 4 4" /><path d="M6 12v7h12v-7" /></>,
  good: <path d="M5 12.500l4.2 4L19 7" strokeWidth="2.6" />,
  watch: <><path d="M2.5 12s3.5-6.5 9.5-6.500S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></>,
  concern: <><path d="M12 6v7.5" strokeWidth="2.6" /><path d="M12 17.600v.100" strokeWidth="2.6" /></>,
  info: <><path d="M12 11v6" strokeWidth="2.4" /><path d="M12 7.200v.100" strokeWidth="2.4" /></>,
};

export function Icon({ name, ...rest }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...S} {...rest}>{paths[name] || paths.info}</svg>;
}

export const LEVEL_TEXT = { good: 'All good', watch: 'Keep an eye', concern: 'Call the vet', info: 'Learning' };
const lv = l => (LEVEL_TEXT[l] ? l : 'info');

export const LevelIcon = ({ level }) => <span className={`lvl ${lv(level)}`}><Icon name={lv(level)} /></span>;
export const Chip = ({ level, children }) => <span className={`chip ${lv(level)}`}><Icon name={lv(level)} />{children || LEVEL_TEXT[lv(level)]}</span>;

function CatFace({ cat }) {
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={`${cat}, no photo yet`}>
      <rect width="120" height="120" fill="var(--cat-soft)" />
      <path d="M30 52 L34 20 L54 38 Q60 36 66 38 L86 20 L90 52 Q96 64 92 78 Q84 100 60 100 Q36 100 28 78 Q24 64 30 52Z" fill="var(--cat)" />
      <ellipse cx="47" cy="64" rx="5" ry="6.5" fill="#fff" /><ellipse cx="73" cy="64" rx="5" ry="6.5" fill="#fff" />
      <ellipse cx="48" cy="65" rx="2.4" ry="4" fill="#171A2B" /><ellipse cx="74" cy="65" rx="2.4" ry="4" fill="#171A2B" />
      <path d="M56 76 L64 76 L60 81Z" fill="#fff" opacity=".9" />
    </svg>
  );
}

export function CatPhoto({ cat, profile }) {
  const [broken, setBroken] = useState(false);
  const src = photoSrc(profile);
  useEffect(() => setBroken(false), [src]);
  return src && !broken ? <img src={src} alt={cat} onError={() => setBroken(true)} /> : <CatFace cat={cat} />;
}

export function PhotoUpload({ cat, onDone, toast }) {
  const [busy, setBusy] = useState(false);
  const upload = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    try { await http.post(`/pets/${cat}/photo`, form); toast(`${cat}'s photo is updated`); onDone && onDone(); }
    catch (ex) { toast(ex.response?.data?.detail || 'Upload failed. Try a JPG or PNG.'); }
    setBusy(false);
    e.target.value = '';
  };
  return (
    <label className="btn-secondary" style={{ position: 'relative', overflow: 'hidden', ...catVars(cat) }}>
      <Icon name="camera" width="18" height="18" />{busy ? 'Uploading…' : `${cat}'s photo`}
      <input type="file" accept="image/*,.heic,.heif" onChange={upload} disabled={busy}
             style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
    </label>
  );
}

export function CatSeg({ value, onChange, all = false, small = false }) {
  const opts = all ? ['All', ...CATS] : CATS;
  return (
    <div className={`seg ${small ? 'sm' : ''}`} role="group" aria-label="Choose a cat">
      {opts.map(c => (
        <button key={c} aria-pressed={value === c} onClick={() => onChange(c)} style={catVars(c)}>
          {c !== 'All' && <span className="dot" />}{c}
        </button>
      ))}
    </div>
  );
}

export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const esc = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <h2 className="sheet-title">{title}</h2>
          <button className="x-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
