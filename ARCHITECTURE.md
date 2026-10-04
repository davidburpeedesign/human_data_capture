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
| ASF/AMC | ✓ | Acclaim skeleton (`.asf`, or `.asx` as CMU ships it) + motion (CMU database). FK per the Acclaim spec (`world = parent · C · M · C⁻¹`), file units (1/L inch) → metres, 120 Hz default. Trials pair with skeletons by CMU file naming via a session registry; with no name match the latest skeleton is used and flagged. Trials keep their raw motion (`clip.source`) so they can be rebuilt on any loaded skeleton from the sidebar. Shares the virtual-marker step with BVH (`io/skeleton.ts`). |
| BVH | ✓ | FK → joint positions + orientations. Emits **virtual canonical markers** (epicondyles, malleoli, heel, MT1/MT5, ASIS/PSIS) rigidly attached to segments, so skeleton data and marker data share one analysis path. Assumes rest pose = neutral stance. |
| C3D | ✓ points | Intel, DEC (VAX float) and MIPS int/float, labels (+LABELS2), units, residual-based gaps. Analog (force plates, EMG) parsed in v1. |
| CSV/TSV | ✓ | flat `NAME_X` headers or split two-row headers; time column sets the rate. |
| PLY / OBJ / STL | ✓ | via three.js loaders; STL/OBJ welded. Longest axis = up; mm/cm/m from stature. |
| TRC (OpenSim) | planned | trivially a CSV variant |
| FBX / glTF animation | planned | via three.js loaders → same virtual-marker path as BVH |

`io/normalize.ts` infers the frame from the body: up = feet→pelvis, forward
= pelvis displacement (or heel→toe on a treadmill). It needs no header trust.
It then levels the walking surface: a line through the lowest foot point per
20 cm of travel is rotated flat (0.1–8°, recorded as `meta.floor_tilt_deg`),
so a tilted capture volume doesn't read as COM bob.

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
  furthest behind the pelvis, along the instantaneous heading), refined by
  velocity: contact is where the heel's motion relative to the pelvis joins
  the stance slope (80 % of it), lift-off where the toe's leaves it. Works on
  treadmill and overground, and is immune to a swing heel skimming the floor.
- **Foot flat / heel off:** from heel→toe pitch vs. the median stance pitch.
- **Partial strides:** a side's last heel strike, with its toe-off inside the
  trial but no following heel strike, is kept with `partial: true` and an
  estimated cycle end (median complete stride, else two median steps). Short
  trials, especially running, often contain one complete stride per side or
  none; dropping the final stance would leave a side empty. Stance measures
  use partial strides; anything needing the next heel strike (stride time,
  stride length, swing, stance %, whole-cycle ankle range) does not. Cycle
  curves include them up to the end of the data (NaN beyond; the ensemble
  averages whichever curves cover each point).
- **Walking vs running:** `report.mode` is `running` when flight phases
  (neither foot in contact) fill >5 % of the span between the first and last
  detected events. Double-support measures are then empty by definition and
  say so.

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

### 6.2b Ground reaction force, estimated (`analysis/grf.ts`)

No force plates needed: total GRF is Newton's second law on the whole-body
COM, **F = m (a_com − g)**, reported in body weights (×BW), so body mass
cancels out. Single support gives the whole force to the stance foot. Double
support is indeterminate; we use the smooth transition assumption (Ren et
al. 2008), with the trailing foot's share easing from 1 at the leading heel
strike to 0 at its own toe-off (cubic, flat ends). The centre of pressure is
a display anchor rolling heel → toe over stance.

| metric | definition |
|---|---|
| vertical peaks (loading / push-off) | max vertical force in the first / second half of stance |
| midstance minimum | min vertical force between the two peaks |
| loading rate | 20–80 % of the first peak, BW/s |
| peak braking / propulsion | min / max anterior force in stance |
| peak medial | max medially directed force in stance |

Curves: vertical, anterior (+) / posterior (−), medial (+) / lateral (−),
per foot, in the walker's frame. Status is `ok` with a segmental COM and
`proxy` with the pelvis stand-in. Checks: over whole strides the estimate
averages 1.0 BW vertically and ~0 fore-aft (0.99 BW on CMU 07_01).

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
is an indicator only (active item, current COM, focus); the timeline
playhead is white because coral sits too close to the left-limb red. Limb
data colours (`--data-left` red #EA5A65, `--data-right` blue #4698C7) appear
only on data marks and were validated for dark-surface contrast and
colour-vision separation.

**Ghost layer**: every frame's skeleton and markers in two draw calls
(one LineSegments, one Points), additively blended bone ink with opacity
scaled to frame count, so dwell regions build up brighter. Built lazily on
first toggle, rebuilt per dataset; gap (NaN) samples are skipped so they
can't poison the bounding volume.

**Magnitude ramp** (`core/colormap.ts`): anything whose colour encodes "how
much" uses one diverging ramp around a near-black zero, mint → blue → navy →
black → maroon → red → blush. The limb colours sit inside it, so a per-side
magnitude runs from black (nothing; fuses with the void) toward that side's
own hue. Used by the GRF arrows (|F|, full scale 1.5 ×BW), the HUD legend
and the per-foot force strips on the stance timeline.

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
- C3D analog: force plates → measured GRF/COP, replacing the estimate
  and giving it a validation reference
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
- Skeleton virtual markers inherit the rig: a retargeted skeleton's ankle is
  not an anatomical ankle. The rest pose is taken as neutral; the foot is
  built in the shank's frame so splayed rest legs (CMU) add no inversion.
- Rigs with a hinge knee (CMU ASF: tibia `dof rx`) cannot express knee axial
  rotation; it is reported `unavailable` (`meta.knee_axial = 'locked'`).
  Tibial rotation, which comes from the hip, is still measured.
- Foot progression from a skeleton is only as good as the fit's foot yaw.
- Estimated GRF comes from a twice-differentiated COM, so mid-stance carries
  ripple a force plate would not show. The double-support split shares one
  force between both feet, so per-foot fore-aft and especially mediolateral
  forces in double support are approximate (their sum is not). With a
  pelvis-proxy COM, arm and trunk motion is missing from the estimate.
- The synthetic walker is a test fixture, not normative data. Its joint
  curves are plausible but not a reference gait.
