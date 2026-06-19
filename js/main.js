// main.js - boot orchestration: gate -> boot -> desktop.
import { runGate } from './gate.js';
import { initDesktop } from './desktop.js';

// register apps (each module self-registers via registerApp on import)
import './apps/files.js';
import './apps/about.js';
import './apps/contact.js';
import './apps/paint.js';
import './apps/settings.js';
import './apps/deck.js';
import './apps/studio-session.js';
import './apps/radio.js';
import './apps/credits.js';
import './apps/eggs/terminal.js';
import './apps/eggs/guestbook.js';
import './apps/eggs/notepad.js';
import './apps/eggs/recycle.js';
import './apps/eggs/secrets.js';
import './apps/eggs/konami.js';

async function start() {
  await runGate();
  const desktop = document.getElementById('desktop');
  desktop.hidden = false;
  initDesktop();
}

start();

// PWA: register the service worker so the desktop installs + boots offline.
// Relative './sw.js' keeps the scope correct under the GitHub Pages subpath.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
