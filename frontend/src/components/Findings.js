import React from 'react';
import { LevelIcon } from './Bits';

export default function Findings({ cat, findings = [], sources = {}, disclaimer }) {
  return (
    <div className="panel">
      <h3 className="panel-title">What the data says</h3>
      <p className="panel-sub">Compared with general vet guidance and with {cat}'s own normal. Tap any item for why it matters.</p>
      {!findings.length && <p className="empty">Not enough data yet. Findings appear after a few days of visits.</p>}
      <ul className="findings">
        {findings.map(f => (
          <li key={f.id} className="finding">
            <div className="finding-row">
              <LevelIcon level={f.level} />
              <div>
                <div className="finding-topic">{f.topic}</div>
                <div className="finding-title">{f.title}</div>
                <p className="finding-detail">{f.detail}</p>
                <details>
                  <summary>
                    <svg className="chev" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4l8 8-8 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Why it matters and what to do
                  </summary>
                  <div className="explain">
                    <h4>Why it matters</h4>
                    <p>{f.why}</p>
                    <h4>What to do</h4>
                    <p>{f.action}</p>
                    {!!f.sources?.length && (
                      <p className="src">
                        Source{f.sources.length > 1 ? 's' : ''}:{' '}
                        {f.sources.map((k, i) => sources[k] && (
                          <span key={k}>{i > 0 && ', '}<a href={sources[k].url} target="_blank" rel="noreferrer">{sources[k].label}</a></span>
                        ))}
                      </p>
                    )}
                  </div>
                </details>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {disclaimer && <p className="vital-note" style={{ marginTop: 10 }}>{disclaimer}</p>}
    </div>
  );
}
