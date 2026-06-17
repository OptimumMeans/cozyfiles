# COZYFILES.US - Design Spec

Date: 2026-06-16
Status: Approved, in build

## Concept

A creative-studio website wearing the AWGE aesthetic. Cozyfiles is a creative
studio/collective. The site has two layers:

1. **The Gate** - cryptic, minimal, black. A mysterious front door. A single
   glitching glyph/wordmark, ambient flicker, a hidden/implicit way in
   ("press enter" + a clickable hotspot). No nav, no explanation.
2. **The Desktop** - "entering" plays a short boot/glitch transition into a
   retro desktop OS environment: wallpaper, clickable icons, a taskbar with a
   live clock, and draggable / resizable / focusable / closable windows that
   open as "apps."

Tech: **vanilla HTML / CSS / JS**. No framework, no build step. Deploys as
static files. Hosted locally during dev via a static server so progress is
watchable live.

Hard rule (house style, inherited): **zero em dashes anywhere** in shipped
copy or content. Use hyphens or rewrite.

## Aesthetic / Design Tokens

Retro-web meets net-art. Lo-fi, slightly broken on purpose, high-contrast.

- Palette: near-black bg (`#0a0a0a`), bone/off-white text (`#e8e6df`), a single
  acid accent (`#b6ff3c` lime) + a warm secondary (`#ff5e3a`). CRT green for
  terminal.
- Type: a monospace stack for system chrome (`"VT323", "Courier New", monospace`
  feel) and a grotesque/system stack for body. Use web-safe + a couple of
  Google fonts (VT323, Space Mono) loaded with `font-display: swap`.
- Texture: subtle scanline overlay, optional grain, chunky beveled window
  borders (Win98-ish), pixel cursors optional.
- Motion: glitch transitions, flicker, marquee, blink - used sparingly.

All tokens live in `css/tokens.css` as CSS custom properties. Everything else
references them. Do NOT hardcode colors/fonts elsewhere.

## File Structure

```
index.html              single entry; loads css + js (type=module)
css/
  tokens.css            design system custom properties (source of truth)
  reset.css             minimal reset + base
  gate.css              gate + boot transition
  desktop.css           desktop shell, icons, taskbar
  window.css            window chrome (title bar, borders, controls)
  apps.css              per-app content styles (namespaced .app-<id>)
js/
  main.js               boot orchestration: gate -> boot -> desktop init
  gate.js               gate screen + transition; resolves when user enters
  window-manager.js     WindowManager: open/close/focus/drag/resize/minimize
  desktop.js            app registry, desktop icons, taskbar, clock
  apps/
    files.js            FILES.EXE  (file-explorer portfolio)
    about.js            ABOUT.TXT  (manifesto)
    contact.js          CONTACT    (email/socials/form)
    player.js           PLAYER     (winamp-ish media player)
    eggs/
      terminal.js       hidden: fake shell w/ commands + secrets
      guestbook.js      hidden: sign-the-guestbook (localStorage)
      notepad.js        hidden: notepad with secret lore
      recycle.js        hidden: recycle bin w/ "deleted" gags
assets/
  icons/  wallpaper/  media/   placeholders, swapped later
```

## WindowManager API (the contract every app builds against)

`js/window-manager.js` exports a singleton `wm`.

```js
// Open (or focus, if singleton & already open) a window.
wm.open({
  id,            // string, unique app id e.g. "files"
  title,         // string shown in title bar, e.g. "FILES.EXE"
  icon,          // string: emoji or path to assets/icons/*
  render,        // (contentEl, win) => void  // app paints into contentEl
  width = 520,   // initial px
  height = 380,
  x, y,          // optional initial px; auto-cascaded if omitted
  singleton = true, // if true, second open() just focuses existing
  resizable = true,
  className = "",   // extra class on the window root, e.g. "app-files"
}) => winHandle

// winHandle: { id, el, contentEl, focus(), close(), minimize(), setTitle(s) }
```

Behavior WindowManager owns: dragging by title bar, resizing from SE corner,
focus/z-index stacking, minimize to taskbar, close, cascade positioning,
clamping to viewport, and emitting taskbar updates. Apps NEVER touch z-index,
positioning, or the taskbar directly. Apps only paint into `contentEl`.

## App Registry (desktop.js)

```js
registerApp({
  id, name,        // name = icon label on desktop
  icon,            // emoji or asset path
  open,            // () => void  // calls wm.open(...) with the app's config
  desktop = true,  // show an icon on the desktop?
  hidden = false,  // easter egg: no icon, opened by another app/secret
})
```

`desktop.js` reads the registry, renders desktop icons (double-click / tap to
open), renders the taskbar (clock + minimized windows), and exposes
`openApp(id)` so easter eggs can launch each other.

## Apps (scaffold with tasteful placeholder content)

- **FILES.EXE** - file-explorer window. Left: folder tree (PROJECTS, ARCHIVE,
  SECRETS). Right: icon grid of "files." Opening a project file opens a viewer
  pane/window with placeholder cover image + blurb. This is the main portfolio.
- **ABOUT.TXT** - manifesto window: studio story / ethos in cryptic but
  readable copy. Styled like a text doc.
- **CONTACT** - email (cameron@cozyfiles.us), socials, and a simple contact
  form (no backend yet; mailto or a stubbed handler that fakes a send).
- **PLAYER** - winamp-ish media player: transport controls, a track title
  marquee, a fake visualizer (canvas bars). Ships silent/placeholder track;
  real audio dropped in later. Must not autoplay with sound.
- **Easter eggs (hidden, no desktop icon):**
  - terminal: fake shell, commands (`help`, `ls`, `cat`, `whoami`, secret cmds
    that open other apps or reveal lore).
  - guestbook: visitors sign; entries persist in localStorage.
  - notepad: lore/secrets text.
  - recycle bin: clickable "deleted" gags.
  - Discovery: terminal launched via a hidden hotspot or a keyboard konami-ish
    sequence; document the trigger in README.

## Boot / Gate Flow (gate.js + main.js)

1. Page loads -> Gate visible (black, glyph, flicker, "press enter" hint +
   invisible hotspot).
2. User hits Enter or clicks the hotspot -> boot sequence: brief fake
   POST/boot text or glitch wipe (~1.5-2.5s), then reveal desktop.
3. `main.js` then calls `desktop.init()` which registers apps and paints icons.
4. Respect `prefers-reduced-motion`: shorten/skip glitch, no strobe.

## Accessibility / Quality Bar

- Keyboard: Enter to pass gate; Esc closes focused window; windows focusable.
- `prefers-reduced-motion` honored (no strobe/flashing for those users).
- Works on mobile: windows become near-fullscreen sheets under ~640px; icons
  tappable. Desktop metaphor degrades gracefully, not broken.
- No console errors. No external deps beyond Google Fonts. No autoplay audio.

## Out of Scope (YAGNI for v1)

- Real backend / contact form delivery (stub it).
- CMS / blog.
- Real auth. Real analytics.
- Real project content (placeholders now).

## Hosting

Local static server during dev (`python -m http.server` or `npx serve`) so the
site is watchable live. Static deploy target (Render static / Netlify / GH
Pages) decided later.
