# CLAUDE.md

Guidance for working in this repository.

## What this is

A client-side browser tool for human data capture: ingest motion capture
(BVH, C3D, CSV) and 3D body scans (PLY, OBJ, STL), analyse gait / kinematic
morphology and anthropometrics, and visualise it. `ARCHITECTURE.md` is the
design doc and metric reference; read it before changing analysis code.

## Commands

- `npm run dev`: dev server on :5173
- `npm test`: Vitest (analysis vs. synthetic ground truth, format round-trips)
- `npm run typecheck` / `npm run build`

Run `npm test` and `npm run typecheck` before every commit.

## Layout

```
src/core/       types, vector math, signal processing, landmark aliases
src/io/         one file per format + normalize.ts (lab frame) + index.ts router
src/analysis/   context → segments → angles / events → spatiotemporal / com → report
src/demo/       synthetic walker + scan (also the test fixtures)
src/scene/      three.js viewport
src/ui/         panels, timeline, charts (canvas)
src/styles/     tokens.css (mirrors MORPHXGEN-visual-language.md) + app.css
tests/          vitest
```

## Rules

- **Lab frame is ISB:** X anterior, Y up, Z right, metres. Importers convert;
  analysis assumes it.
- **Analysis never reads file formats.** It asks for canonical landmarks via
  `ctx.p('L_HEEL')`. New marker naming → add an alias in `core/landmarks.ts`.
- **Filter once.** Only `analysis/context.ts` filters trajectories.
- **Be honest about inputs.** A metric whose landmarks are missing is
  `unavailable`; one built on a fallback axis is `proxy`. Never guess silently.
- **New metric:** add it to the right group in `analysis/report.ts`, document
  it in ARCHITECTURE.md §6, and add a ground-truth test if the synthetic
  walker can express it (add a `WalkerParams` field if needed).
- **Visual language:** lowercase UI, square corners, hairlines, no shadows.
  Coral (`--accent`) is an indicator only. Limb colours `--data-left` /
  `--data-right` are for data marks only, never chrome or text.
- No chart, state or CSS libraries. Keep three.js the only heavy dependency.

## Style

TypeScript strict, 2-space indent, single quotes, semicolons. Comments
explain *why* (method choice, reference, pitfall), not what. Cite the paper
when implementing a published method.

## Git

Concise imperative subject, body explaining the change. Do not open PRs
unless asked.
