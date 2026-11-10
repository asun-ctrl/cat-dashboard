import React, { useState } from 'react';
import { http, photoSrc } from '../lib';

const paths = {
  good: <path d="M5 12.5l4.2 4L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />,
  watch: <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.6" /></g>,
  concern: <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 6v7.5" /><path d="M12 17.6v.1" /></g>,
  info: <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 11v6" /><path d="M12 7.2v.1" /></g>,
};

export function LevelIcon({ level, size = 14 }) {
  const l = paths[level] ? level : 'info';
  return (
    <span className={`lvl-icon ${l}`} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24">{paths[l]}</svg>
    </span>
  );
}

export const LEVEL_TEXT = { good: 'All good', watch: 'Keep an eye on it', concern: 'Talk to your vet', info: 'Still learning' };

export function StatusChip({ level }) {
  const l = LEVEL_TEXT[level] ? level : 'info';
  return (
    <span className={`status-chip ${l}`}>
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">{paths[l]}</svg>
      {LEVEL_TEXT[l]}
    </span>
  );
}

// Original illustration used until a real photo is added.
function CatFace({ cat }) {
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={`${cat}, no photo yet`}>
      <rect width="120" height="120" fill="var(--cat-soft)" />
      <path d="M30 52 L34 20 L54 38 Q60 36 66 38 L86 20 L90 52 Q96 64 92 78 Q84 100 60 100 Q36 100 28 78 Q24 64 30 52Z" fill="var(--cat)" opacity=".9" />
      <path d="M38 30 L40 44 L49 38Z M82 30 L80 44 L71 38Z" fill="var(--cat-soft)" opacity=".55" />
      <ellipse cx="47" cy="64" rx="5" ry="6.5" fill="#fff" />
      <ellipse cx="73" cy="64" rx="5" ry="6.5" fill="#fff" />
      <ellipse cx="48" cy="65" rx="2.4" ry="4" fill="#1D2133" />
      <ellipse cx="74" cy="65" rx="2.4" ry="4" fill="#1D2133" />
      <path d="M56 76 L64 76 L60 81Z" fill="#fff" opacity=".9" />
      <path d="M60 81 Q55 87 50 84 M60 81 Q65 87 70 84" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".85" />
    </svg>
  );
}

export function CatAvatar({ cat, profile, onUploaded, editable = true }) {
  const [broken, setBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const src = photoSrc(profile);

  const upload = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr('');
    const form = new FormData();
    form.append('file', file);
    try {
      await http.post(`/pets/${cat}/photo`, form);
      setBroken(false);
      onUploaded && onUploaded();
    } catch (ex) {
      setErr(ex.response?.data?.detail || 'Upload failed. Try a JPG or PNG.');
    }
    setBusy(false);
    e.target.value = '';
  };

  return (
    <>
      <div className="avatar">
        {src && !broken ? <img src={src} alt={cat} onError={() => setBroken(true)} /> : <CatFace cat={cat} />}
      </div>
      {editable && (
        <label className="photo-btn" title={src && !broken ? `Change ${cat}'s photo` : `Add a photo of ${cat}`}
               onClick={e => e.stopPropagation()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
          </svg>
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
            {busy ? 'Uploading' : `Choose a photo of ${cat}`}
          </span>
          <input type="file" accept="image/*,.heic,.heif" onChange={upload} disabled={busy} />
        </label>
      )}
      {err && <div className="photo-hint" role="alert" style={{ color: 'var(--concern)' }}>{err}</div>}
    </>
  );
}
