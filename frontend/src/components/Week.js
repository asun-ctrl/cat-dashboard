import React, { useEffect, useState } from 'react';
import { catVars, fmt, http } from '../lib';
import { CatPhoto, Chip, Icon, LevelIcon } from './Bits';

function Spark({ s, days }) {
  const vals = s.daily || [];
  const nums = vals.filter(v => v != null);
  if (s.value == null) return null;
  const isWeight = s.label === 'Weight';
  const lo = isWeight ? Math.min(...nums) - 0.15 : 0;
  const hi = Math.max(...nums, lo + 0.001);
  const pct = s.change_pct;
  const delta = pct == null ? '' : Math.abs(pct) < (isWeight ? 1 : 8) ? 'steady' : `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
  return (
    <div className="spark">
      <div className="spark-top"><span className="spark-label">{s.label}</span><span className="spark-delta">{delta}</span></div>
      <div className="spark-val">{s.value}<small>{s.unit}</small></div>
      <div className="spark-bars" role="img" aria-label={`${s.label} by day: ${vals.map(v => v ?? 'none').join(', ')}`}>
        {vals.map((v, i) => (v == null ? <span key={i} className="none" /> : <span key={i} style={{ height: `${Math.max(8, ((v - lo) / (hi - lo)) * 100)}%` }} />))}
      </div>
      <div className="spark-days">{days.map(dd => <span key={dd}>{fmt.weekday(dd)[0]}</span>)}</div>
    </div>
  );
}

export default function Week({ pets }) {
  const [offset, setOffset] = useState(0);
  const [story, setStory] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setStory(null); setErr(false);
    http.get('/story', { params: { offset } }).then(r => live && setStory(r.data)).catch(() => live && setErr(true));
    return () => { live = false; };
  }, [offset]);
  return (
    <>
      <h1 className="page-title">The week in review</h1>
      <p className="page-sub">Seven full days, compared with the week before.</p>
      <div className="week-nav">
        <button className="round-btn" onClick={() => setOffset(o => o + 1)} disabled={!story?.has_previous} aria-label="Previous week"><Icon name="back" /></button>
        <div className="week-range">{story ? `${fmt.day(story.start)} to ${fmt.day(story.end)}` : ' '}<small>{offset === 0 ? 'Last 7 days' : `${offset} week${offset > 1 ? 's' : ''} earlier`}</small></div>
        <button className="round-btn" onClick={() => setOffset(o => Math.max(0, o - 1))} disabled={offset === 0} aria-label="Next week"><Icon name="chev" /></button>
      </div>
      {err && <p className="offline">Couldn't load this week. Check your connection.</p>}
      {!story && !err && <div className="skeleton" />}
      {story?.cats.map(c => (
        <article className="card" key={c.cat} style={catVars(c.cat)}>
          <div className="story-head">
            <div className="story-avatar"><CatPhoto cat={c.cat} profile={pets[c.cat]} /></div>
            <div><h2 className="story-title">{c.headline}</h2><div style={{ marginTop: 5 }}><Chip level={c.level}>{c.level === 'good' ? 'Steady week' : 'Something changed'}</Chip></div></div>
          </div>
          <div className="spark-grid">
            {Object.values(c.stats).map(s => <Spark key={s.label} s={s} days={story.days} />)}
          </div>
          {c.paragraphs.map(p => (
            <div className="story-p" key={p.topic}><LevelIcon level={p.level} /><div><b>{p.topic}</b><p>{p.text}</p></div></div>
          ))}
          {c.alerts.map(a => (
            <div className="story-p" key={a.at}><LevelIcon level="watch" /><div><b>Alert, {fmt.weekday(a.at)}</b><p>{a.title}</p></div></div>
          ))}
          {!c.paragraphs.length && <p className="empty">No data for this week.</p>}
        </article>
      ))}
    </>
  );
}
