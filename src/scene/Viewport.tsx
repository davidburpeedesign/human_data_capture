/**
 * Three.js stage. One renderer for the lifetime of the component; datasets
 * swap scene content, frames only rewrite position buffers. Nothing here
 * allocates per frame.
 *
 * Visual rules (MORPHXGEN): near-black void, bone hairline grid, bone
 * skeleton, coral only as the single "indicator" (current COM), limb data
 * colours only on data marks (footprints). Point clouds blend additively so
 * dense regions bloom the way screen-blended renders do.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Dataset, MotionClip, Vec3 } from '../core/types';
import type { GaitReport } from '../analysis/report';
import type { Layers } from '../ui/Sidebar';
import { track } from '../core/landmarks';
import type { Side } from '../core/types';

/** Metres of arrow per body weight: 1 BW ≈ a third of standing height. */
const GRF_SCALE = 0.6;

interface Props {
  dataset: Dataset | null;
  frame: number;
  report: GaitReport | null;
  layers: Layers;
  onDrop: (files: File[]) => void;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#e4e3df';

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  grid: THREE.Group;
  content: THREE.Group;
  markers: THREE.Points | null;
  bones: THREE.LineSegments | null;
  comDot: THREE.Mesh | null;
  grfArrows: Record<Side, THREE.ArrowHelper> | null;
  comTrail: THREE.Line | null;
  footprints: THREE.Group | null;
  names: string[];
  bonePairs: [number, number][];
  lastFollowX: number;
}

function makeGrid(): THREE.Group {
  const g = new THREE.Group();
  const bone = new THREE.Color(css('--mx-bone'));
  const build = (step: number, extent: number, opacity: number) => {
    const pts: number[] = [];
    for (let v = -extent; v <= extent + 1e-6; v += step) {
      pts.push(v, 0, -extent, v, 0, extent, -extent, 0, v, extent, 0, v);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: bone, transparent: true, opacity, depthWrite: false }));
  };
  g.add(build(0.25, 12, 0.05));
  g.add(build(1, 12, 0.12));
  // Origin crosshair, the brand's "+" mark.
  const cross = new THREE.BufferGeometry();
  cross.setAttribute('position', new THREE.Float32BufferAttribute([-0.15, 0.001, 0, 0.15, 0.001, 0, 0, 0.001, -0.15, 0, 0.001, 0.15], 3));
  g.add(new THREE.LineSegments(cross, new THREE.LineBasicMaterial({ color: bone, transparent: true, opacity: 0.6 })));
  return g;
}

function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
  g.clear();
}

export function Viewport({ dataset, frame, report, layers, onDrop }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);

  // ── one-time setup ───────────────────────────────────────────────────
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(new THREE.Color(css('--mx-void-deep')));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 200);
    camera.position.set(0.6, 1.4, 4.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0.6, 0.85, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;

    const grid = makeGrid();
    const content = new THREE.Group();
    scene.add(grid, content);

    stage.current = {
      renderer, scene, camera, controls, grid, content,
      markers: null, bones: null, comDot: null, comTrail: null, footprints: null, grfArrows: null,
      names: [], bonePairs: [], lastFollowX: NaN,
    };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      disposeGroup(scene);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      stage.current = null;
    };
  }, []);

  // ── dataset → scene content ──────────────────────────────────────────
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    disposeGroup(s.content);
    Object.assign(s, { markers: null, bones: null, comDot: null, comTrail: null, footprints: null, grfArrows: null, names: [], bonePairs: [], lastFollowX: NaN });
    if (!dataset) return;

    const bone = new THREE.Color(css('--mx-bone'));

    if (dataset.kind === 'scan') {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(dataset.positions, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({
        color: bone, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      s.content.add(pts);
      geo.computeBoundingBox();
      const h = geo.boundingBox!.max.y;
      s.controls.target.set(0, h * 0.5, 0);
      s.camera.position.set(2.4, h * 0.65, 2.8);
      return;
    }

    const clip = dataset;
    s.names = [...clip.trajectories.keys()];
    const index = new Map(s.names.map((n, i) => [n, i]));
    s.bonePairs = clip.bones
      .map(([a, b]) => [index.get(a), index.get(b)] as [number | undefined, number | undefined])
      .filter((p): p is [number, number] => p[0] !== undefined && p[1] !== undefined);

    const mgeo = new THREE.BufferGeometry();
    mgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(s.names.length * 3), 3));
    s.markers = new THREE.Points(mgeo, new THREE.PointsMaterial({ color: bone, size: 5, sizeAttenuation: false }));

    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(s.bonePairs.length * 6), 3));
    s.bones = new THREE.LineSegments(bgeo, new THREE.LineBasicMaterial({ color: bone, transparent: true, opacity: 0.7 }));

    s.content.add(s.markers, s.bones);

    const first = track(clip, 'SACRUM') ?? clip.trajectories.values().next().value;
    const x0 = first ? first.data[0] : 0;
    // Three-quarter view from the subject's right, slightly above the pelvis.
    s.controls.target.set(x0 + 0.3, 0.75, 0);
    s.camera.position.set(x0 + 2.2, 2.0, 3.9);
  }, [dataset]);

  // ── report-derived overlays: com trail, footprints ───────────────────
  useEffect(() => {
    const s = stage.current;
    if (!s || !dataset || dataset.kind !== 'motion' || !report) return;
    for (const o of [s.comTrail, s.comDot, s.footprints, ...(s.grfArrows ? Object.values(s.grfArrows) : [])]) {
      if (o) { s.content.remove(o); disposeGroup(o); }
    }
    s.grfArrows = null;

    if (report.com) {
      const path = report.com.path;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(path.flat(), 3));
      s.comTrail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: css('--mx-white'), transparent: true, opacity: 0.35 }));
      s.comDot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), new THREE.MeshBasicMaterial({ color: css('--accent') }));
      s.content.add(s.comTrail, s.comDot);
    }

    s.footprints = footprintGroup(dataset, report);

    if (report.grf) {
      // One arrow per foot in its limb colour. Created once per report;
      // per-frame updates only move, aim and scale them.
      const arrow = (side: Side) => {
        const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.5, css(side === 'left' ? '--data-left' : '--data-right'));
        a.visible = false;
        return a;
      };
      s.grfArrows = { left: arrow('left'), right: arrow('right') };
      s.content.add(s.grfArrows.left, s.grfArrows.right);
    }
    s.content.add(s.footprints);
  }, [dataset, report]);

  // ── per-frame update ─────────────────────────────────────────────────
  useEffect(() => {
    const s = stage.current;
    if (!s || !dataset || dataset.kind !== 'motion') return;
    const clip = dataset;
    const f = Math.max(0, Math.min(frame, clip.frameCount - 1));

    if (s.markers) {
      const arr = s.markers.geometry.getAttribute('position') as THREE.BufferAttribute;
      s.names.forEach((n, i) => {
        const d = clip.trajectories.get(n)!.data;
        arr.setXYZ(i, d[f * 3], d[f * 3 + 1], d[f * 3 + 2]);
      });
      arr.needsUpdate = true;
      s.markers.geometry.computeBoundingSphere();
      s.markers.visible = layers.markers;
    }
    if (s.bones) {
      const m = s.markers!.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = s.bones.geometry.getAttribute('position') as THREE.BufferAttribute;
      s.bonePairs.forEach(([a, b], i) => {
        arr.setXYZ(i * 2, m.getX(a), m.getY(a), m.getZ(a));
        arr.setXYZ(i * 2 + 1, m.getX(b), m.getY(b), m.getZ(b));
      });
      arr.needsUpdate = true;
      s.bones.geometry.computeBoundingSphere();
      s.bones.visible = layers.skeleton;
    }
    if (report?.com && s.comDot && s.comTrail) {
      const p: Vec3 = report.com.path[f];
      s.comDot.position.set(p[0], p[1], p[2]);
      s.comDot.visible = s.comTrail.visible = layers.com;
    }
    if (s.footprints) s.footprints.visible = layers.footprints;
    if (s.grfArrows && report?.grf) {
      for (const side of ['left', 'right'] as const) {
        const a = s.grfArrows[side];
        const F = report.grf.foot[side][f], cop = report.grf.cop[side][f];
        const mag = Math.hypot(F[0], F[1], F[2]);
        a.visible = layers.grf && !!cop && mag > 0.02;
        if (!a.visible || !cop) continue;
        a.position.set(cop[0], cop[1], cop[2]);
        a.setDirection(new THREE.Vector3(F[0] / mag, F[1] / mag, F[2] / mag));
        a.setLength(mag * GRF_SCALE, 0.07, 0.04);
      }
    }
    s.grid.visible = layers.grid;

    // Follow: slide camera and target with the subject, keep user's orbit.
    if (layers.follow && report?.events.pelvis) {
      const x = report.events.pelvis[f][0];
      // First followed frame after a dataset swap: recentre on the subject
      // rather than trusting the camera placement, because the swap renders
      // once with the previous clip's frame index before playback resets.
      const dx = Number.isFinite(s.lastFollowX) ? x - s.lastFollowX : x + 0.3 - s.controls.target.x;
      s.camera.position.x += dx;
      s.controls.target.x += dx;
      s.lastFollowX = x;
    } else {
      s.lastFollowX = NaN;
    }
  }, [dataset, frame, report, layers]);

  return (
    <div
      className="viewport"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const files = [...e.dataTransfer.files];
        if (files.length) onDrop(files);
      }}
    >
      <div className="viewport__gl" ref={host} />
      <span className="tick tick--tl" />
      <span className="tick tick--tr" />
      <span className="tick tick--bl" />
      <span className="tick tick--br" />
      {report?.grf && layers.grf && dataset?.kind === 'motion' && (
        <div className="viewport__hud">
          <span className="muted">grf (est.)</span>
          {(['left', 'right'] as const).map((side) => {
            const F = report.grf!.foot[side][Math.max(0, Math.min(frame, dataset.frameCount - 1))];
            return (
              <span key={side}>
                <i style={{ background: `var(--data-${side})` }} />
                {side[0]} {F[1].toFixed(2)} ×BW
              </span>
            );
          })}
        </div>
      )}
      <div className="viewport__legend">
        <span>x anterior · y superior · z right</span>
        <span className="muted">drag to orbit · scroll to zoom · drop .bvh .asx+.amc .c3d .csv .ply .obj .stl</span>
      </div>
    </div>
  );
}

/** Foot outlines on the floor at each foot-flat, in the limb's data colour. */
function footprintGroup(clip: MotionClip, report: GaitReport): THREE.Group {
  const g = new THREE.Group();
  for (const side of ['left', 'right'] as const) {
    const L = side === 'left' ? 'L' : 'R';
    const ids = (['HEEL', 'MT5', 'TOE', 'MT1'] as const).map((b) => track(clip, `${L}_${b}`));
    if (ids.some((t) => !t)) continue;
    const pts: number[] = [];
    for (const st of report.events.strides.filter((s) => s.side === side)) {
      const f = Number.isFinite(st.footFlat) ? st.footFlat : st.hs;
      for (let k = 0; k < 4; k++) {
        const a = ids[k]!.data, b = ids[(k + 1) % 4]!.data;
        pts.push(a[f * 3], 0.002, a[f * 3 + 2], b[f * 3], 0.002, b[f * 3 + 2]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: css(side === 'left' ? '--data-left' : '--data-right'), transparent: true, opacity: 0.8,
    })));
  }
  return g;
}
