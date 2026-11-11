import React, { useState } from 'react';
import { CATS, catVars, fmt, localDay, mins, todayStr } from '../lib';
import { CatPhoto, CatSeg, Chip, Icon, LevelIcon } from './Bits';

function headline(cats) {
  const flagged = cats.map(c => ({ cat: c.cat, status: c.status, n: c.findings.filter(f => f.level === 'watch' || f.level === 'concern').length }));
  const concern = flagged.find(c => c.status === 'concern');
  if (concern) return `${concern.cat} could use a vet's eyes.`;
  const w = flagged.filter(c => c.n > 0);
  if (!w.length) return cats.length > 1 ? 'Both cats are doing well.' : 'All good today.';
  if (w.length === 1) {
    const other = flagged.find(c => c.n === 0);
    return `${other ? `${other.cat} is fine. ` : ''}${w[0].cat} has ${w[0].n === 1 ? 'one thing' : `${w[0].n} things`} to watch.`;
  }
  return 'A few things to keep an eye on.';
}

function CatTile({ data, profile, pl, litter, onOpen }) {
  const { cat, status, vitals = {} } = data;
  const t = pl?.today;
  const line = status === 'good' ? 'Eating, drinking and litter habits look normal.'
    : data.findings.find(f => f.level === 'concern' || f.level === 'watch')?.title || data.headline;
  return (
    <button className="cat-tile" style={catVars(cat)} onClick={() => onOpen(cat)} aria-label={`${cat}: ${data.headline}. Open trends`}>
      <div className="cat-photo">
        <CatPhoto cat={cat} profile={profile} />
        <span className="cat-status"><Chip level={status} /></span>
      </div>
      <div>
        <div className="cat-name">{cat}</div>
        <p className="cat-line">{line}</p>
        <div className="cat-nums">
          <div className="cat-num"><b>{vitals.weight ? Number(vitals.weight.value).toFixed(1) : '--'}</b><span>lbs</span></div>
          {t ? <>
            <div className="cat-num"><b>{mins(t.eating_seconds)}</b><span>min eating</span></div>
            <div className="cat-num"><b>{t.drink_ml ?? '--'}</b><span>mL water</span></div>
          </> : <>
            <div className="cat-num"><b>{litter?.urine ?? '--'}</b><span>pees today</span></div>
            <div className="cat-num"><b>{litter?.feces ?? '--'}</b><span>poops today</span></div>
          </>}
        </div>
      </div>
    </button>
  );
}

const FEED = {
  eat: it => [`${it.cat} ate`, `${it.count} ${it.count === 1 ? 'visit' : 'visits'} to the bowl, ${fmt.dur(it.seconds)}`],
  drink: it => [`${it.cat} drank ${it.ml} mL`, it.count > 1 ? `${it.count} drinks` : null],
  meal: it => [`${it.cat}'s feeder served a meal`, `${it.portions} ${it.portions === 1 ? 'portion' : 'portions'}`],
  litter: it => [
    it.cat ? (it.sure ? `${it.cat} used the litter box` : `Probably ${it.cat} in the litter box`) : 'A cat used the litter box',
    [it.what === 'visit' ? 'Type unclear' : it.what === 'pee' ? 'Pee' : 'Poop', it.seconds ? fmt.dur(it.seconds) : null,
      it.weight_lbs ? `${it.weight_lbs.toFixed(1)} lbs` : null, it.maybe_loose ? 'might be loose stool' : null].filter(Boolean).join(' · '),
  ],
  checkin: it => [`You logged: ${it.label}`, it.cat],
  note: it => [`${it.label}: ${it.text}`, it.cat || 'Both cats'],
};

function Feed({ feed }) {
  const [who, setWho] = useState('All');
  const [more, setMore] = useState(false);
  const today = todayStr();
  const items = (feed || []).filter(it => who === 'All' || it.cat === who || (!it.cat && it.kind !== 'litter') || (it.kind === 'litter' && !it.cat));
  const [n, setN] = useState(8);
  const pool = more ? items : items.filter(it => localDay(it.ts) === today);
  const shown = pool.slice(0, n);
  const groups = [];
  shown.forEach(it => {
    const d = localDay(it.ts);
    if (!groups.length || groups[groups.length - 1].d !== d) groups.push({ d, items: [] });
    groups[groups.length - 1].items.push(it);
  });
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Today so far</h2>
        <CatSeg value={who} onChange={setWho} all small />
      </div>
      <div className="card">
        {!shown.length && <p className="empty" style={{ paddingTop: 0 }}>Nothing recorded yet today.</p>}
        {groups.map(g => (
          <div key={g.d}>
            {(more || g.d !== today) && <div className="feed-day">{g.d === today ? 'Today' : fmt.weekday(g.d)}</div>}
            {g.items.map((it, i) => {
              const [title, sub] = (FEED[it.kind] || FEED.note)(it);
              return (
                <div className="feed-item" key={`${it.ts}-${it.kind}-${i}`} style={catVars(it.cat)}>
                  <span className="feed-ico"><Icon name={it.kind} /></span>
                  <div className="feed-text">{title}{sub && <small>{sub}</small>}</div>
                  <time className="feed-time">{fmt.clock(it.ts)}</time>
                </div>
              );
            })}
          </div>
        ))}
        {pool.length > shown.length
          ? <button className="link-btn" style={{ marginTop: 8 }} onClick={() => setN(n + 20)}>Show earlier</button>
          : items.length > pool.length && <button className="link-btn" style={{ marginTop: 8 }} onClick={() => { setMore(true); setN(n + 20); }}>Show yesterday too</button>}
      </div>
    </section>
  );
}

export default function Today({ d, onOpenCat, refresh, syncing }) {
  const cats = d.insights.cats;
  const attn = cats.flatMap(c => c.findings.filter(f => f.level === 'watch' || f.level === 'concern').map(f => ({ ...f, cat: c.cat })))
    .sort((a, b) => (b.level === 'concern') - (a.level === 'concern'));
  const alerts = (d.alerts?.alerts || []).filter(a => Date.now() - new Date(a.created_at).getTime() < 36 * 3600e3 && !a.cat);
  return (
    <>
      <div className="topline">
        <span className="date">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <button className={`pill-btn ${syncing ? 'spin' : ''}`} onClick={refresh} disabled={syncing} aria-label="Check for new activity">
          <Icon name="refresh" />{syncing ? 'Checking' : d.sync?.last_sync ? fmt.clock(d.sync.last_sync) : 'Refresh'}
        </button>
      </div>
      <h1 className="headline">{headline(cats)}</h1>

      <div className="cats">
        {CATS.map(cat => {
          const c = cats.find(x => x.cat === cat);
          return c && <CatTile key={cat} data={c} profile={d.pets[cat]} pl={d.petlibro?.cats?.[cat]} litter={d.summary?.[cat]?.today} onOpen={onOpenCat} />;
        })}
      </div>

      <section className="section">
        <div className="section-head"><h2 className="section-title">Worth a look</h2></div>
        <div className="card">
          {!attn.length && !alerts.length && (
            <div className="allclear"><LevelIcon level="good" /><div><b>Nothing needs your attention.</b><div className="muted">Weight, eating, drinking and litter habits are all in their normal range.</div></div></div>
          )}
          {alerts.map(a => (
            <div className="attn" key={`a${a.id}`} style={{ gridTemplateColumns: '28px 1fr' }}>
              <LevelIcon level={a.severity === 'critical' ? 'concern' : 'watch'} />
              <div><div className="attn-title">{a.title}</div><p className="attn-detail">{a.message}</p></div>
            </div>
          ))}
          {attn.map(f => (
            <button className="attn" key={`${f.cat}-${f.id}`} style={catVars(f.cat)} onClick={() => onOpenCat(f.cat)}>
              <LevelIcon level={f.level} />
              <div><div className="attn-who">{f.cat}</div><div className="attn-title">{f.title}</div><p className="attn-detail">{f.detail}</p></div>
              <Icon name="chev" />
            </button>
          ))}
        </div>
      </section>

      <Feed feed={d.feed} />
    </>
  );
}
