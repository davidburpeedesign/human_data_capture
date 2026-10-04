# human_data_capture

A browser tool for human data capture, analysis and visualisation. Drop in
motion capture or a 3D body scan and get kinematic morphology, gait
metrics, cycle curves and anthropometrics. Everything runs client-side, so
data never leaves the machine.

![human_data_capture](./docs/screenshot.png)

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full outline, metric
definitions and roadmap, and
[MORPHXGEN-visual-language.md](./MORPHXGEN-visual-language.md) for the
visual system.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # analysis + format tests (vitest)
npm run build      # typecheck + production bundle → dist/
```

The app opens on a synthetic walker and a synthetic scan, so every panel is
populated before you have data of your own.

## Ingest

| type | formats |
|---|---|
| motion capture | `.bvh` · `.c3d` · `.csv` / `.tsv` marker trajectories |
| body scan | `.ply` · `.obj` · `.stl` (mesh or point cloud) |

Drop files on the stage or use **open**. Units, up-axis and walking
direction are inferred from the body itself. Marker names are mapped to
canonical landmarks (Plug-in Gait, CAST, Qualisys and mixamo/CMU joint
names out of the box); the sidebar shows what resolved.

## Analysis

| group | metrics |
|---|---|
| spatiotemporal | walking speed, cadence, stride / step length, step width, stride time, contact duration, swing, stance % |
| loading / unloading | loading response, time to foot flat, time to heel off, pre-swing unloading |
| foot & ankle | foot progression angle, ankle excursion (stance / cycle), peak dorsi / plantarflexion |
| pronation / supination | peak eversion, eversion excursion, time to peak, eversion velocity, pattern |
| tibial & knee rotation | tibial rotation rom / mean, knee rotation rom / peak, loading knee flexion |
| centre of mass | 3d trajectory, vertical and mediolateral excursion |
| variability | cv % of stride time, stride length, contact, swing, step width |
| coordination | inter-limb phase, phase coordination index, symmetry indices |
| scan | stature, width, depth, area, volume, girth profile, named girths |

Each metric reports left / right / pooled values and says when it is a
proxy or unavailable because landmarks are missing.

## Exports

- **export report**: JSON with every metric, per-stride rows and mean curves
- **strides.csv**: one row per stride, for spreadsheets

## Deploying

Same as `mo_graph`: `.github/workflows/deploy.yml` builds and publishes to
GitHub Pages on every push to `main`. Set **Settings → Pages → Source:
GitHub Actions**.
