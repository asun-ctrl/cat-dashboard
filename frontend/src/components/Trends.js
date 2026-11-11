import React from 'react';
import { catVars } from '../lib';
import { CatSeg, Icon, LevelIcon } from './Bits';
import { DurationChart, EatingChart, RhythmChart, TripsChart, WaterChart, WeightChart } from './Charts';

function Findings({ cat, findings = [], sources = {} }) {
  return (
    <div className="card">
      <h3 className="card-title">What the data says</h3>
      <p className="card-sub">Compared with vet guidance and with {cat}'s own normal.</p>
      {!findings.length && <p className="empty">Findings appear after a few days of data.</p>}
      <ul style={{ marginTop: 10 }}>
        {findings.map(f => (
          <li key={f.id} className="finding">
            <div className="finding-row">
              <LevelIcon level={f.level} />
              <div>
                <div className="finding-topic">{f.topic}</div>
                <div className="finding-title">{f.title}</div>
                <p className="finding-detail">{f.detail}</p>
                <details>
                  <summary><Icon name="chev" strokeWidth="3" />Why it matters and what to do</summary>
                  <div className="explain">
                    <h4>Why it matters</h4><p>{f.why}</p>
                    <h4>What to do</h4><p>{f.action}</p>
                    {!!f.sources?.length && (
                      <p className="src">Source{f.sources.length > 1 ? 's' : ''}:{' '}
                        {f.sources.map((k, i) => sources[k] && <span key={k}>{i > 0 && ', '}<a href={sources[k].url} target="_blank" rel="noreferrer">{sources[k].label}</a></span>)}
                      </p>
                    )}
                  </div>
                </details>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Trends({ d, cat, setCat }) {
  const cur = d.insights.cats.find(c => c.cat === cat);
  const s = d.summary?.[cat];
  const pl = d.petlibro?.cats?.[cat];
  if (!cur) return null;
  return (
    <div style={catVars(cat)}>
      <h1 className="page-title">Trends</h1>
      <p className="page-sub">What the numbers mean, in plain terms.</p>
      <div className="sticky-seg"><CatSeg value={cat} onChange={setCat} /></div>
      <div className="two-col">
        <Findings cat={cat} findings={cur.findings} sources={d.insights.sources} />
        <div>
          <WeightChart cat={cat} trend={s?.weight_trend} vital={cur.vitals?.weight} notes={d.notes} />
          <EatingChart cat={cat} data={pl} notes={d.notes} />
          <WaterChart cat={cat} data={pl} vital={cur.vitals?.water} notes={d.notes} />
          <TripsChart cat={cat} week={s?.week_trend} month={s?.month_trend} year={s?.year_trend} notes={d.notes} />
          <RhythmChart cat={cat} hours={s?.hour_pattern} daysTracked={s?.averages?.days_tracked}
                       feedingTimes={d.insights.meal_times?.[cat] || d.insights.feeding_times} afterMeal={cur.vitals?.after_meal} />
          <DurationChart cat={cat} trend={s?.duration_trend} vital={cur.vitals?.duration} />
        </div>
      </div>
      <p className="muted" style={{ marginTop: 16 }}>{d.insights.disclaimer}</p>
    </div>
  );
}
