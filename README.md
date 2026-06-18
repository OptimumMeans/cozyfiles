# cozyfiles.us

A creative-studio site wearing the AWGE aesthetic. A cryptic minimal gate that
boots into a retro desktop OS environment: draggable windows, clickable app
icons, a taskbar, and hidden easter eggs.

Vanilla HTML / CSS / JS. No framework, no build step.

## Run locally

```bash
python -m http.server 3001
# or
npx serve -l 3001
```

Then open http://localhost:3001

## Gate skip toggle (dev)

While iterating on the boot sequence, the gate runs on every page load. To re-enable
skip-on-revisit for repeat visitors once the gate is finalized, edit `js/gate.js`:

- **Flag:** `SKIP_RECENT_BOOT_ENABLED` (near the top of the file)
- **`false` (current):** Always show the full gate (boot flicker → desktop icon → launch), regardless of `localStorage`. Click-anywhere-to-skip mid-sequence still works.
- **`true`:** If the user completed the gate within the last 5 minutes (`GATE_TS_KEY` in `localStorage`), skip straight to the session view on reload.

Set the flag back to `true` when the gate sequence is done and you want returning visitors to bypass the boot.

## Structure

See `docs/superpowers/specs/2026-06-16-cozyfiles-awge-design.md` for the full
design + the WindowManager API contract that every app builds against.

- `index.html` - entry
- `css/tokens.css` - design system (colors, fonts) source of truth
- `js/window-manager.js` - draggable/resizable window manager (`wm.open()`)
- `js/desktop.js` - app registry, desktop icons, taskbar
- `js/apps/*` - the apps (FILES, ABOUT, CONTACT, PLAYER)
- `js/apps/eggs/*` - hidden easter eggs

## Easter eggs

Hidden apps (no desktop icon) are launched from the terminal or secret triggers.
Triggers are documented inline in each egg module.

## House rule

Zero em dashes anywhere in copy or content. Use hyphens or rewrite.
