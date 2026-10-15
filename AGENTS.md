# AGENTS.md

GraviBall: 2D game where you rotate the level (or, in mobile mode, the gravity)
to deliver a ball to an exit zone. Vite + TypeScript + pure SVG, no runtime deps.

## Run

```bash
npm install
npm run dev     # dev server
npm run build   # tsc --noEmit && vite build (must pass; strict TS)
```

## Structure

- `src/main.ts` — screen navigation (menu/levels/game/editor/scores/story),
  level-select keyboard nav (↑↓+Enter), mobile-mode setting
- `src/game.ts` — the whole game: physics (fixed substeps from config.json),
  SVG scene building, HUD, overlays, mobile mode (gyro + on-screen buttons +
  fullscreen toggle). One `Game` class; `new Game(root, level, hooks, { mobile })`
- `src/editor.ts` — level editor (draw/select/erase, props panel, save to LS, JSON export/import)
- `src/icons.ts` — inline SVG icon strings, `icon(name, size)`. Never use emojis in UI.
- `src/levels/*.json` — 10 built-in levels; `src/config.json` — physics/input tuning
- `src/storage.ts` — Local Storage: `graviball.best.v1`, `graviball.customLevels.v1`,
  `graviball.notes.v1`, `graviball.mobile` ("on"/"off"/absent=auto)
- `src/story.ts` — texts for note ids `n1`–`n12`

## Conventions & gotchas

- **Code style: minimal comments** — only non-obvious "why", no narration of what the code does.
- All UI glyphs are SVG icons via `icons.ts`; in-SVG text must be non-selectable (CSS handles it).
- Desktop: the world `<g>` rotates by `angle`, gravity stays world-down
  (`g = g·(sin θ, cos θ)` in world frame). Mobile mode: world transform is
  removed, the same `angle` rotates the gravity vector instead. Don't break this duality.
- Desktop viewBox is a fixed square `(w+h)/√2` centered on the level (worst-case
  rotation fit) — constant scale, never rescale per frame. Mobile uses plain `0 0 w h`.
- Physics: circle vs AABB in world space; spikes/movers are deadly (forgiving
  radius factors 0.8/0.9); bouncy walls enforce `bouncyMinSpeed`; sticky zeroes velocity.
- Gyro (mobile): needs user gesture (`requestPermission` on iOS/Android Chrome);
  every failure path must toast a message — never fail silently.
- Fullscreen button uses Fullscreen API on `documentElement` with `webkit`
  prefixes; failures are swallowed (iOS Safari, iframes).
- Level JSON format is documented in README.md; editor output must stay compatible.
- Levels are forgiving by design (big goals, wide gaps) — keep new content playable
  by rotation alone.
