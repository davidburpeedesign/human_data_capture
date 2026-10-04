import type { Dataset, LandmarkId, MotionClip } from '../core/types';
import { BASE_LANDMARKS, CENTRAL_LANDMARKS } from '../core/types';

export interface Layers {
  skeleton: boolean;
  markers: boolean;
  com: boolean;
  footprints: boolean;
  grid: boolean;
  follow: boolean;
}

interface Props {
  datasets: Dataset[];
  activeId: string;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onDemo: (kind: 'motion' | 'scan') => void;
  clip: MotionClip | null;
  layers: Layers;
  onLayers: (l: Layers) => void;
  cutoff: number;
  onCutoff: (hz: number) => void;
  warnings: string[];
}

const describe = (d: Dataset) =>
  d.kind === 'motion'
    ? `${d.format} · ${(d.frameCount / d.rate).toFixed(1)}s`
    : `${d.format} · ${((d.positions.length / 3) / 1000).toFixed(0)}k pts`;

export function Sidebar(p: Props) {
  return (
    <aside className="sidebar">
      <section className="block">
        <header className="block__head">
          <span>datasets</span>
          <span className="muted">{p.datasets.length}</span>
        </header>
        <ul className="list">
          {p.datasets.map((d) => (
            <li
              key={d.id}
              className={d.id === p.activeId ? 'item item--on' : 'item'}
              onClick={() => p.onSelect(d.id)}
            >
              <span className="item__marker" />
              <span className="item__body">
                <span className="item__name">{d.name}</span>
                <span className="item__desc">{d.kind} · {describe(d)}</span>
              </span>
              <button
                className="item__x"
                title="remove"
                onClick={(e) => { e.stopPropagation(); p.onRemove(d.id); }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="block__actions">
          <button className="btn btn--ghost" onClick={() => p.onDemo('motion')}>+ demo walk</button>
          <button className="btn btn--ghost" onClick={() => p.onDemo('scan')}>+ demo scan</button>
        </div>
      </section>

      {p.clip && (
        <>
          <section className="block">
            <header className="block__head"><span>layers</span></header>
            <div className="toggles">
              {(Object.keys(p.layers) as (keyof Layers)[]).map((k) => (
                <label key={k} className="toggle">
                  <input
                    type="checkbox"
                    checked={p.layers[k]}
                    onChange={(e) => p.onLayers({ ...p.layers, [k]: e.target.checked })}
                  />
                  {k}
                </label>
              ))}
            </div>
          </section>

          <section className="block">
            <header className="block__head">
              <span>filter</span>
              <span className="muted">{p.cutoff} hz low-pass</span>
            </header>
            <div className="block__pad">
              <input
                type="range"
                min={2}
                max={15}
                step={1}
                value={p.cutoff}
                onChange={(e) => p.onCutoff(+e.target.value)}
              />
            </div>
          </section>

          <LandmarkCoverage clip={p.clip} />

          {p.warnings.length > 0 && (
            <section className="block">
              <header className="block__head"><span>notes</span><span className="muted">{p.warnings.length}</span></header>
              <ul className="notes">
                {p.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </aside>
  );
}

function LandmarkCoverage({ clip }: { clip: MotionClip }) {
  const resolved = Object.keys(clip.landmarks).length;
  const total = BASE_LANDMARKS.length * 2 + CENTRAL_LANDMARKS.length;
  const cell = (id: LandmarkId) => {
    const hit = clip.landmarks[id];
    return (
      <span key={id} className={hit ? 'lm lm--on' : 'lm'} title={hit ? `${id} ← ${hit}` : `${id}: not found`}>
        {hit ? '+' : '·'}
      </span>
    );
  };
  return (
    <section className="block">
      <header className="block__head">
        <span>landmarks</span>
        <span className="muted">{resolved}/{total}</span>
      </header>
      <div className="lmgrid">
        <span className="lmgrid__h" />
        <span className="lmgrid__h">l</span>
        <span className="lmgrid__h">r</span>
        {BASE_LANDMARKS.map((b) => (
          <div key={b} className="lmgrid__row">
            <span className="lmgrid__name">{b.toLowerCase()}</span>
            {cell(`L_${b}` as LandmarkId)}
            {cell(`R_${b}` as LandmarkId)}
          </div>
        ))}
        {CENTRAL_LANDMARKS.map((c) => (
          <div key={c} className="lmgrid__row">
            <span className="lmgrid__name">{c.toLowerCase()}</span>
            {cell(c)}
            <span />
          </div>
        ))}
      </div>
    </section>
  );
}
