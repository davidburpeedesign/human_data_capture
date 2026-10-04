/**
 * View cube: a small CSS 3D cube that mirrors the camera's orientation, with
 * one clickable face per axis view. Clicking a face snaps the stage to that
 * orthographic view; the mode button returns to perspective.
 *
 * Faces are named for the subject in the lab frame (X anterior, Y up,
 * Z right): "front" looks at the subject's front from +X, "right" from +Z.
 * The cube's orientation is written by the viewport every frame through
 * `cubeRef`, so it never lags the render.
 */
import type { RefObject } from 'react';

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
  onToggleMode: () => void;
}

export function ViewCube({ cubeRef, mode, onView, onToggleMode }: Props) {
  return (
    <div className="viewcube">
      <div className="viewcube__stage">
        <div className="viewcube__cube" ref={cubeRef}>
          {FACES.map((f) => (
            <button
              key={f.id}
              className="viewcube__face"
              style={{ transform: `${f.transform} translateZ(var(--cube-half))` }}
              onClick={() => onView(f.id)}
              title={`${f.id} view (orthographic)`}
            >
              {f.id}
            </button>
          ))}
        </div>
      </div>
      {/* In an exact axis view only one face is visible, so every view also
          gets a plain button: any view is one click from any other. */}
      <div className="viewcube__views">
        {FACES.map((f) => (
          <button key={f.id} onClick={() => onView(f.id)} title={`${f.id} view (orthographic)`}>
            {f.id}
          </button>
        ))}
      </div>
      <button className="viewcube__mode" onClick={onToggleMode} title="switch projection">
        {mode === 'ortho' ? 'ortho' : 'persp'}
      </button>
    </div>
  );
}
