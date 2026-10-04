import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BodyScan, Dataset } from './core/types';
import { importFiles, listSkeletons, prepareClip, rebindSkeleton, registerSkeleton } from './io/index';
import { analyzeGait } from './analysis/report';
import { analyzeScan } from './analysis/scan';
import { syntheticWalk } from './demo/synthetic';
import { syntheticScan } from './demo/syntheticScan';
import { downloadCsv, downloadJson } from './io/export';
import { Toolbar } from './ui/Toolbar';
import { Sidebar, type Layers } from './ui/Sidebar';
import { Viewport } from './scene/Viewport';
import { Timeline } from './ui/Timeline';
import { MetricsPanel } from './ui/MetricsPanel';
import { CurvesPanel } from './ui/CurvesPanel';
import { ScanPanel } from './ui/ScanPanel';

export type Tab = 'metrics' | 'curves' | 'scan';

const DEFAULT_LAYERS: Layers = {
  skeleton: true,
  markers: true,
  com: true,
  footprints: true,
  grid: true,
  follow: true,
  grf: true,
  ghost: false,
};

export function App() {
  const [datasets, setDatasets] = useState<Dataset[]>(() => [prepareClip(syntheticWalk()), syntheticScan()]);
  const [activeId, setActiveId] = useState<string>(datasets[0].id);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [tab, setTab] = useState<Tab>('metrics');
  const [cutoff, setCutoff] = useState(6);
  const [status, setStatus] = useState('ready');
  const [busy, setBusy] = useState(false);
  const [skeletons, setSkeletons] = useState<string[]>([]);

  const active = datasets.find((d) => d.id === activeId) ?? null;
  const clip = active?.kind === 'motion' ? active : null;
  const scan = active?.kind === 'scan' ? active : null;

  const report = useMemo(() => (clip ? analyzeGait(clip, { cutoff }) : null), [clip, cutoff]);
  const scanReport = useMemo(() => (scan ? analyzeScan(scan) : null), [scan]);

  useEffect(() => {
    setFrame(0);
    if (scan) setTab('scan');
    else if (tab === 'scan') setTab('metrics');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Playback runs on wall-clock time so it stays real-time at any frame rate.
  const raf = useRef(0);
  useEffect(() => {
    if (!clip || !playing) return;
    let last = performance.now();
    let f = frame;
    const tick = (now: number) => {
      // rAF timestamps can precede performance.now() taken at setup; clamp.
      f = (f + (Math.max(0, now - last) / 1000) * clip.rate * speed) % clip.frameCount;
      last = now;
      setFrame(Math.floor(f));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip, playing, speed]);

  const open = useCallback(async (files: File[]) => {
    setBusy(true);
    setStatus(`reading ${files.length} file${files.length > 1 ? 's' : ''}...`);
    const { datasets: added, skeletons, errors } = await importFiles(files);
    setSkeletons(listSkeletons());
    const guessed = added.filter((d) => d.kind === 'motion' && d.source?.matched === 'guessed');
    if (added.length) {
      setDatasets((ds) => [...ds, ...added]);
      setActiveId(added[added.length - 1].id);
    }
    const notes = [
      added.length ? `loaded ${added.length}` : '',
      skeletons.length ? `skeleton ${skeletons.join(', ')} ready${added.length ? '' : ': drop its .amc trials'}` : '',
      ...guessed.map((d) => `${d.name}: no skeleton name match, using ${d.kind === 'motion' ? d.source?.skeleton : ''} (change in sidebar)`),
      ...errors,
    ].filter(Boolean);
    setStatus(notes.join(' · ') || 'ready');
    setBusy(false);
  }, []);

  /** Swap the active trial for the same motion rebuilt on another skeleton. */
  const rebind = (skelName: string) => {
    if (!clip?.source) return;
    try {
      const next = rebindSkeleton(clip, skelName);
      setDatasets((ds) => ds.map((d) => (d.id === clip.id ? next : d)));
      setActiveId(next.id);
      setStatus(`${clip.name} on ${skelName}`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  const loadSkeleton = async (file: File) => {
    try {
      registerSkeleton(await file.text(), file.name);
      setSkeletons(listSkeletons());
      rebind(file.name);
    } catch (e) {
      setStatus(`${file.name}: ${(e as Error).message}`);
    }
  };

  const remove = (id: string) => {
    setDatasets((ds) => {
      const next = ds.filter((d) => d.id !== id);
      if (id === activeId && next.length) setActiveId(next[0].id);
      return next;
    });
  };

  const addDemo = (kind: 'motion' | 'scan') => {
    const seed = (Math.random() * 1e6) | 0;
    const d: Dataset = kind === 'motion'
      ? prepareClip({ ...syntheticWalk({ seed }), id: `synthetic-${seed}`, name: `synthetic_walk.${String(seed).slice(0, 3)}` })
      : { ...syntheticScan(1.6 + Math.random() * 0.3, 1, seed), id: `scan-${seed}`, name: `synthetic_scan.${String(seed).slice(0, 3)}` };
    setDatasets((ds) => [...ds, d]);
    setActiveId(d.id);
  };

  const readout = clip
    ? `${clip.format} · ${clip.trajectories.size} tracks · ${clip.rate.toFixed(0)} hz · ${(clip.frameCount / clip.rate).toFixed(1)} s`
    : scan
      ? `${scan.format} · ${(scan.positions.length / 3).toLocaleString()} pts`
      : '';

  return (
    <div className="app">
      <Toolbar
        name={active?.name ?? null}
        readout={readout}
        status={status}
        busy={busy}
        canExport={!!report || !!scanReport}
        canExportStrides={!!report}
        onOpen={open}
        onExportJson={() => {
          if (clip && report) downloadJson(clip, report);
          else if (scan && scanReport) downloadJson(scan, scanReport);
        }}
        onExportCsv={() => clip && report && downloadCsv(clip, report)}
      />

      <main className="main">
        <Sidebar
          datasets={datasets}
          activeId={activeId}
          onSelect={setActiveId}
          onRemove={remove}
          onDemo={addDemo}
          clip={clip}
          layers={layers}
          onLayers={setLayers}
          cutoff={cutoff}
          onCutoff={setCutoff}
          warnings={report?.warnings ?? []}
          skeletons={skeletons}
          onSkeleton={rebind}
          onLoadSkeleton={loadSkeleton}
        />

        <section className="stage">
          <Viewport dataset={active} frame={frame} report={report} layers={layers} onDrop={open} />
          {clip && report && (
            <Timeline
              clip={clip}
              report={report}
              frame={frame}
              playing={playing}
              speed={speed}
              onFrame={(f) => { setPlaying(false); setFrame(f); }}
              onPlay={() => setPlaying((p) => !p)}
              onSpeed={setSpeed}
            />
          )}
        </section>

        <aside className="panel">
          <nav className="tabs">
            {(['metrics', 'curves', 'scan'] as const).map((t) => (
              <button
                key={t}
                className={t === tab ? 'tab tab--on' : 'tab'}
                disabled={t === 'scan' ? !scan : !clip}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          <div className="panel__body">
            {tab === 'metrics' && report && <MetricsPanel report={report} />}
            {tab === 'curves' && report && clip && <CurvesPanel report={report} frame={frame} />}
            {tab === 'scan' && scanReport && <ScanPanel report={scanReport} scan={scan as BodyScan} />}
            {!active && <p className="muted empty">drop a file to begin...</p>}
          </div>
        </aside>
      </main>
    </div>
  );
}
