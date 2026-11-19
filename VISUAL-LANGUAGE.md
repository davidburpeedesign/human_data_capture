# Visual language

How human_data_capture looks. It is a dark, technical, instrument-like
interface where data carries the colour and the UI chrome stays quiet. The
tokens live in `src/styles/tokens.css`; author CSS against the semantic names
below, never raw hex.

## Principles

- **Data first.** Colour belongs to data. Chrome is greyscale: near-black
  surfaces, off-white text and hairlines.
- **Lowercase UI.** Every label, button and readout is lowercase. The only
  exception is the product name in the header.
- **Square and flat.** No rounded corners (status tags may use 2px), no
  shadows, no gradients in chrome, no glow.
- **Hairlines, not boxes.** Panels are separated by 1px lines; the 3D stage
  is framed by corner ticks instead of a full border.
- **Be honest.** A value that is estimated or missing says so in text
  (`proxy`, `not available`), never through colour alone.

## Colour

### Surfaces and text

| token | value | use |
|---|---|---|
| `--bg` | `#222222` | app background |
| `--bg-deep` | `#1a1a1a` | 3D stage, inputs, chart dot outlines |
| `--surface-raise` | `#2b2b2b` | hover and selected rows |
| `--text-primary` | `#e4e3df` | default text (warm off-white) |
| `--text-emphasis` | `#ffffff` | hover and active text |
| `--text-muted` | off-white at 55% | secondary labels, units |
| `--text-faint` | off-white at 40% | axis labels, hints, disabled |

### Lines

| token | value | use |
|---|---|---|
| `--line` | off-white at 16% | panel borders, buttons (`--border-hair` = 1px) |
| `--line-soft` | off-white at 8% | row dividers, chart grid |
| `--line-strong` | `#e4e3df` | rare, emphatic rules |

An off-white alpha ramp (4, 8, 12, 16, 24, 40, 55, 72%) covers anything in between.

### Accent

| token | value | use |
|---|---|---|
| `--accent` | `#e48484` | coral, the only accent: active tab underline, selected-row marker, focus ring, view-cube face hover |
| `--accent-press` | `#b76a6a` | pressed state |

Coral is an indicator, never a fill or a text colour for content. Keep it
away from data marks: it sits too close to the left-limb red.

### Data

| token | value | use |
|---|---|---|
| `--data-left` | `#ea5a65` | left limb: curves, stance bars, footprints |
| `--data-right` | `#4698c7` | right limb |

Limb colours are for data marks only, never for chrome or text. Both reach at
least 3:1 contrast on the dark surface and stay apart under common colour-vision
deficiencies. Legends pair each colour with a text label (`left`, `right`).

### Magnitude ramp

Anything whose colour means "how much" (force arrows, force strips, the force
bars, cycle-curve shading) uses a diverging ramp around near-black. It is
defined in `src/core/colormap.ts`.

```
mint     blue     ·        navy     near-black  maroon   ·        red      blush
#b2e3d9  #4697c5  #3056b2  #312e50  #201c1d     #532530  #aa2744  #ea5964  #f3dada
◄──────── right side (cool) ────────   zero   ──────── left side (warm) ────────►
```

- Each side runs from black (none) through its own limb hue to a pale end, so
  the hue still says which leg it is.
- Force maps 0 to the trial's peak, rounded up to 0.5 ×BW (never below 1.5).
  Curves map over each chart's own range, with a floor at 30% so lines don't
  vanish into the background.
- Always show the scale beside it (`r 2.5 [ramp] 2.5 l`).

### Status

| token | value | use |
|---|---|---|
| `--status-ok` | off-white at 55% | landmark resolved |
| `--status-proxy` | `#c9a23a` | ochre `proxy` tag: metric built on a fallback |
| `--status-missing` | off-white at 24% | landmark or metric unavailable |

## Type

| family | role |
|---|---|
| **Intel One Mono** (400–600) | everything: UI, numbers, charts, HUD |
| Montserrat 500, uppercase, 0.10em tracking | the product name only |
| Space Mono | display headings (reserved; currently unused) |

Fallbacks are `ui-monospace, "SF Mono", Menlo, Consolas, monospace`. The fonts
load from Google Fonts in `index.html`.

| size | use |
|---|---|
| 14px | body base (`--fs-micro`), toolbar tool name |
| 12px | buttons, tabs, list names, block headers, chart titles |
| 11px | HUD, chart tooltips, legends, notes, metric units |
| 10px | chart axis labels, view-cube faces, tags |

- Body letter-spacing is `-0.02em`; controls and headers use `+0.04em`.
- Numbers use `font-variant-numeric: tabular-nums` wherever they update live.
- Line heights are 1.0 (tight), 1.15 (snug) and 1.45 (body).

## Space and geometry

- **Spacing** is on a 4px base: 4, 8, 12, 16, 24, 32, 48, 64 (`--sp-1` … `--sp-8`).
- **Borders:** 1px hairline (`--bw-hair`); 2px for marks such as the active-tab
  underline, selected-row bar, corner ticks and focus ring (`--bw-mark`).
- **Corners:** 0px, or 2px for tags.
- **Corner ticks:** 8px L-shaped brackets in off-white at 40%, 2px stroke,
  set 5px outside each corner of the 3D stage.
- **Header:** 64px tall.
- **Layout:** three columns: sidebar 248px, stage (fluid), analysis panel 400px
  (216px / 340px under 1280px wide).

## Motion

- Mechanical, never springy: `cubic-bezier(0.65, 0, 0.35, 1)`, 120ms for hovers
  and 240ms for larger changes.
- **Hover** brightens (off-white → white) or reveals the coral marker.
  **Press** shifts to dim coral. No scale-pop.
- `prefers-reduced-motion` turns transitions off.

## Components

- **Buttons:** transparent, 1px `--line` border, square. Hover brightens the
  text and border. A primary button turns coral on hover.
- **Checkboxes:** 10px empty square with a hairline border; filled off-white
  when on.
- **Range inputs:** a 2px track and a 2px × 14px bar thumb; the thumb turns
  coral on hover.
- **Tabs:** text only. The active tab gets a 2px coral underline.
- **Lists:** a full-height 2px coral bar on the left marks the selected row.
- **Tags:** 10px text in a 1px border of the same colour, 2px radius.

## Charts

- Canvas, hand-drawn, with no chart library.
- **Grid:** off-white at 8%; the zero line at 24%. Axis labels are 10px, faint.
- **Mean ± 1 sd:** a 2px mean line with its band at 14% opacity in the limb
  colour.
- **Markers:** toe-off is a dashed vertical line labelled `to`. The playhead is
  a 4px dot on the curve plus a faint full-height line in the limb colour.
- **Tooltips:** a `--bg` panel with a hairline border, 11px tabular numbers.
- **Missing data:** a gap in the line, never a line drawn to zero.

## 3D view

- **Stage:** `--bg-deep` behind a faint grid. The skeleton is drawn in
  off-white lines with square marker points. The centre of mass is a coral dot.
- **Limb data** (footprints, stance) uses the limb colours. Force arrows use
  the magnitude ramp.
- **HUD:** top left, 11px, one bar per leg plus the ramp scale; it never takes
  pointer events.
- **View cube:** top right, 56px, semi-transparent faces with hairline borders
  and coral on hover. The `persp` / `ortho` toggle sits directly beneath it.
- There are no instructional text overlays on the stage.
