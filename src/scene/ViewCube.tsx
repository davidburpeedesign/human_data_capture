/**
 * View cube: a small CSS 3D cube that mirrors the camera's orientation.
 * Dragging it orbits the stage camera; a click (press and release without
 * travel) on a face snaps to that orthographic view. The mode button under
 * it swaps perspective / orthographic.
 *
 * Faces are named for the subject in the lab frame (X anterior, Y up,
 * Z right): "front" looks at the subject's front from +X, "right" from +Z.
 * The cube's orientation is written by the viewport every frame through
 * `cubeRef`, so it never lags the render.
 */
import { useRef, type RefObject } from 'react';

export type View = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

/**
 * CSS placement of each face. CSS space is world space with Y flipped
 * (x right, y down, z toward the viewer), so world +X (front) is
 * rotateY(90deg) and world +Y (top) is rotateX(90deg).
 */
const FACES: { id: View; transform: string }[] = [
  { id: 'front', transform: 'rotateY(90deg)' },
  { id: 'back', transform: 'rotateY(-90deg)' },
  { id: 'right', transform: 'rotateY(0deg)' },
  { id: 'left', transform: 'rotateY(180deg)' },
  { id: 'top', transform: 'rotateX(90deg)' },
  { id: 'bottom', transform: 'rotateX(-90deg)' },
];

interface Props {
  cubeRef: RefObject<HTMLDivElement>;
  mode: 'persp' | 'ortho';
  onView: (view: View) => void;
  /** Orbit by a pointer delta in px (same sense as dragging the stage). */
  onOrbit: (dx: number, dy: number) => void;
  onToggleMode: () => void;
}

/** Pointer travel (px) below which a press counts as a click, not a drag. */
const CLICK_SLOP = 3;

export function ViewCube({ cubeRef, mode, onView, onOrbit, onToggleMode }: Props) {
  const drag = useRef<{ id: number; x: number; y: number; view: View | null; moved: boolean } | null>(null);

  // The stage captures the pointer so a drag keeps orbiting when it leaves
  // the 56px cube. Capture retargets the click to the stage, so the face is
  // remembered at pointerdown and the snap happens on a travel-free release.
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const face = (e.target as HTMLElement).closest<HTMLElement>('[data-view]');
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, view: (face?.dataset.view as View) ?? null, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    d.moved = true;
    d.x = e.clientX; d.y = e.clientY;
    onOrbit(dx, dy);
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved && d.view) onView(d.view);
  };

  return (
    <div className="viewcube">
      <div
        className="viewcube__stage"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => { drag.current = null; }}
      >
        <div className="viewcube__cube" ref={cubeRef}>
          {FACES.map((f) => (
            <div
              key={f.id}
              data-view={f.id}
              className="viewcube__face"
              style={{ transform: `${f.transform} translateZ(var(--cube-half))` }}
            >
              {f.id}
            </div>
          ))}
        </div>
      </div>
      <button className="viewcube__mode" onClick={onToggleMode} title="switch projection">
        {mode === 'ortho' ? 'ortho' : 'persp'}
      </button>
    </div>
  );
}
