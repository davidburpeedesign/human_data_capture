# human_data_capture: architecture & outline

> A browser tool for human data capture, analysis and visualisation.
> Ingest 3D body scans and motion capture, derive kinematic morphology,
> graph it. Everything runs client-side; data never leaves the machine.
> Chrome follows `MORPHXGEN-visual-language.md`.

---

## 1. Scope

**In (v0):**

- ingest motion capture: BVH, C3D, CSV/TSV marker trajectories
- ingest 3D body scans: PLY, OBJ, STL (mesh or point cloud)
- a 3D stage to play motion and inspect scans
- gait analysis: spatiotemporal parameters, joint/segment kinematics,
  foot/ankle behaviour, centre of mass, variability, left/right coordination
- scan anthropometrics: stature, dimensions, girth profile, area/volume
- cycle-normalised charts, metric tables, JSON/CSV export
- a synthetic walker and synthetic scan, so the tool is usable with no data

**Out, for now:** force plates / analog channels, EMG, IMU-only capture,
inverse dynamics, multi-trial session management, cloud storage, auth.
Each is on the roadmap (§9) and the data model leaves room for it.

---

## 2. Stack

| concern | choice | why |
|---|---|---|
| language | TypeScript, strict | the analysis code is numeric and easy to get subtly wrong |
| ui | React 18 | same as `mo_graph`; panels are plain components |
| build | Vite | a compile step only (TS/JSX); output is a static folder |
| 3d | three.js | renderer + PLY/OBJ/STL loaders + orbit controls |
| charts | hand-written canvas | ~150 lines; matches the visual language exactly, redraws every playback frame cheaply |
| tests | Vitest | analysis is validated against the synthetic ground truth |
| hosting | GitHub Pages via Actions | `.github/workflows/deploy.yml`, same as `mo_graph` |

No state library, no chart library, no CSS framework.

---

## 3. Data flow

```
 file ──► io/<format>.ts ──► io/normalize.ts ──► core/landmarks.ts ──► MotionClip
 (bvh, c3d, csv)              lab frame, metres   canonical landmark map

 file ──► io/scan.ts ──────────────────────────────────────────────► BodyScan
 (ply, obj, stl)   up-axis + unit detection

 MotionClip ──► analysis/report.ts ──► GaitReport ──► ui/MetricsPanel, ui/CurvesPanel,
                  │                                    scene/Viewport, ui/Timeline, io/export
                  ├─ context.ts       filtered landmark access (one place)
                  ├─ segments.ts      pelvis / thigh / shank / foot frames
                  ├─ angles.ts        joint + segment angles (deg)
                  ├─ events.ts        heel strike, toe off, foot flat, heel off
                  ├─ spatiotemporal.ts per-stride timing and distance
                  └─ com.ts           centre of mass trajectory

 BodyScan ──► analysis/scan.ts ──► ScanReport ──► ui/ScanPanel, scene/Viewport
```

Importers are format-only. Shared post-processing (frame, units, landmark
resolution) happens once in `io/index.ts`. Analysis never sees a file format.

---

## 4. Data model (`src/core/types.ts`)

- **`MotionClip`**: named `Trajectory`s (flat `Float32Array`, NaN = gap),
  sample rate, drawing bones, and a `landmarks` map from canonical ids to
  trajectory names.
- **`BodyScan`**: flat positions, optional triangle indices and colours.
- **Canonical landmarks**: `L_/R_` × `ASIS PSIS HJC KNEE_LAT KNEE_MED
  ANKLE_LAT ANKLE_MED HEEL TOE MT1 MT5 SHOULDER ELBOW WRIST`, plus
  `SACRUM C7 HEAD`. `core/landmarks.ts` holds the alias table (Plug-in Gait,
  CAST, Qualisys, OpenSim-ish, mixamo/CMU joint names).

### Conventions

- **Lab frame (ISB):** X anterior (direction of travel), Y superior, Z right.
  Metres, seconds.
- **Segment frames:** the same axes for both sides. Clinical signs are
  applied at angle extraction, so "internal rotation +" means the same on
  both legs.
- **Joint angles:** Cardan Z-X-Y of distal relative to proximal (flexion,
  then ab/adduction, then axial rotation).

---

## 5. Ingestion

| format | status | notes |
|---|---|---|
| ASF/AMC | ✓ | Acclaim skeleton + motion (CMU database). FK per the Acclaim spec (`world = parent · C · M · C⁻¹`), file units (1/L inch) → metres, 120 Hz default. Trials pair with skeletons by CMU file naming via a session registry. Shares the virtual-marker step with BVH (`io/skeleton.ts`). |
| BVH | ✓ | FK → joint positions + orientations. Emits **virtual canonical markers** (epicondyles, malleoli, heel, MT1/MT5, ASIS/PSIS) rigidly attached to segments, so skeleton data and marker data share one analysis path. Assumes rest pose = neutral stance. |
| C3D | ✓ points | Intel, DEC (VAX float) and MIPS int/float, labels (+LABELS2), units, residual-based gaps. Analog (force plates, EMG) parsed in v1. |
| CSV/TSV | ✓ | flat `NAME_X` headers or split two-row headers; time column sets the rate. |
| PLY / OBJ / STL | ✓ | via three.js loaders; STL/OBJ welded. Longest axis = up; mm/cm/m from stature. |
| TRC (OpenSim) | planned | trivially a CSV variant |
| FBX / glTF animation | planned | via three.js loaders → same virtual-marker path as BVH |

`io/normalize.ts` infers the frame from the body: up = feet→pelvis, forward
= pelvis displacement (or heel→toe on a treadmill). It needs no header trust.

Within a trial, per-step measures use the **instantaneous heading**
(`analysis/events.ts`): the pelvis's horizontal velocity low-passed at
0.4 Hz, so curved and turning walks (common in CMU data) are measured in
the walker's own frame.

---

## 6. Analysis: metric definitions

Every metric reports left / right / pooled `{mean, sd, n}`, a signed
symmetry index where meaningful, and a status: `ok`, `proxy` (computed from
a fallback axis; see segment notes), or `unavailable` (required landmarks
missing). Nothing is silently guessed.

### 6.1 Events (`analysis/events.ts`)
- **Heel strike / toe off:** Zeni et al. 2008 (heel furthest ahead of / toe
  furthest behind the pelvis), refined to the frame the foot's lowest marker
  crosses 1 cm above floor level. Works on treadmill and overground.
- **Foot flat / heel off:** from heel→toe pitch vs. the median stance pitch.

### 6.2 Requested kinematic morphology

| metric | definition | needs |
|---|---|---|
| **stride length** | heel displacement between ipsilateral strikes (overground); step + next contralateral step (treadmill); or belt speed × stride time | heels, pelvis |
| **cadence** | 60 / mean step time (steps/min) | heels, pelvis |
| **foot progression angle** | heel→toe heading vs. direction of travel, mean over foot-flat → heel-off; toe-out + | heel, toe |
| **pronation / supination** | ankle-complex frontal angle (foot vs. shank, inversion +): peak eversion, eversion excursion, time to peak, peak eversion velocity; heuristic pattern label | + MT1/MT5 and malleoli for `ok`, else `proxy` |
| **ankle excursion** | sagittal ankle ROM in stance and full cycle; peak dorsi/plantarflexion | knee, ankle, heel, toe |
| **tibial rotation** | shank axial rotation in the lab, ROM and mean in stance; internal + | malleoli med/lat |
| **knee rotation** | shank vs. thigh axial rotation; ROM and peak internal | epicondyles + malleoli med/lat |
| **centre-of-mass trajectory** | Dempster/Winter segmental model with full-body landmarks; pelvis-centroid proxy otherwise. Vertical and ML excursion, 3D trail | pelvis (+ upper body) |
| **loading / unloading timing** | loading response = heel strike → contralateral toe off; unloading = contralateral heel strike → toe off; plus time to foot flat and heel off | heels, toes |
| **contact duration** | heel strike → toe off; with swing time and stance % | heels, toes |
| **gait variability** | CV % of stride time, stride length, contact, swing, step width | ≥ 3 strides |
| **left/right coordination** | inter-limb phase, phase coordination index (Plotnik 2007), symmetry indices | both sides |

Also produced: hip/knee/ankle angles in all three planes, cycle-normalised
mean ± sd curves (101 samples) per limb.

### 6.3 Scan (`analysis/scan.ts`)
Stature, width, depth, surface area and volume (closed meshes), and a girth
profile from 2 cm slices: convex-hull perimeter per connected blob, so legs
and arms are measured separately from the torso. Named girths (neck, chest,
waist, hip, thigh, calf, ankle) at stature fractions.

### 6.4 Signal processing (`core/signal.ts`)
Gap fill → 4th-order zero-lag Butterworth (filtfilt, cutoff corrected for
the double pass), 6 Hz default, adjustable in the sidebar.

---

## 7. Interface

```
┌ toolbar: wordmark · dataset readout · status · open · strides.csv · export ┐
├──────────────┬──────────────────────────────────────┬──────────────────────┤
│ datasets     │                                      │ metrics │curves│scan │
│ layers       │        3d stage (three.js)           │                      │
│ filter       │   skeleton · markers · com · prints  │  tables / charts     │
│ landmarks    │                                      │                      │
│ notes        ├──────────────────────────────────────┤                      │
│              │ transport · gait diagram (l/r stance)│                      │
└──────────────┴──────────────────────────────────────┴──────────────────────┘
```

Visual rules, from the MORPHXGEN language: `#222` void, bone ink, hairline
grids, square corners, corner-tick frame on the stage, all lowercase. Coral
is an indicator only (active item, playhead, current COM, focus). Limb data
colours (`--data-left` blue, `--data-right` amber) appear only on data marks
and were validated for dark-surface contrast and colour-vision separation.

---

## 8. Testing

`npm test` runs Vitest against:

- **the synthetic walker** (`demo/synthetic.ts`): prescribed footprints and
  two-link IK, so cadence, stride length, step width, toe-out and stance
  fraction are known inputs. Analysis must recover them.
- **format round-trips:** BVH FK + virtual markers, both CSV layouts, and a
  minimal float C3D written in-test.
- **scan analysis** on the synthetic scan (stature, girth ordering, limb
  separation).

Real-data validation against a commercial pipeline is roadmap item v1.

---

## 9. Roadmap

**v0 (this scaffold):** ingest, stage, gait report, scan report, charts,
exports, synthetic data, tests.

**v1: real-data hardening**
- validate against Vicon Nexus / Visual3D outputs on public datasets
  (e.g. CMU mocap, Fukuchi 2018 running/walking set)
- C3D analog: force plates → true contact/loading from GRF, COP path
- TRC, glTF/FBX animation import
- per-pass segmentation for walk-out-and-back trials (headings already
  follow curves; sharp 180° turns still produce a few odd steps)
- static-trial calibration: subtract neutral offsets, functional HJC/knee axes

**v2: morphology from scans**
- register a scan to a motion clip's subject (scale a template skeleton
  from scan landmarks)
- foot-scan module: foot length/width, arch height index, ball girth, 
  feeding footwear last generation
- segment inertial parameters from scan volume, replacing Dempster tables

**v3: performance & sessions**
- analysis in a Web Worker; streaming parse for large C3D
- sessions in IndexedDB; trial comparison and normative bands
- PDF/HTML report export

---

## 10. Known limitations

- Pronation is the ankle-complex frontal angle, a kinematic proxy for
  subtalar motion. Pattern thresholds (`EVERSION_HIGH/LOW`) are heuristic
  and not diagnostic.
- Without medial markers, axial rotations fall back to neighbouring segment
  axes and are flagged `proxy`.
- BVH virtual markers inherit the rig: a retargeted skeleton's ankle is not
  an anatomical ankle.
- The synthetic walker is a test fixture, not normative data. Its joint
  curves are plausible but not a reference gait.
