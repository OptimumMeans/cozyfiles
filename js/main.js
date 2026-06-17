// main.js - boot orchestration: gate -> boot -> desktop.
import { runGate } from './gate.js';
import { initDesktop } from './desktop.js';

// register apps (each module self-registers via registerApp on import)
import './apps/files.js';
import './apps/about.js';
import './apps/contact.js';
import './apps/player.js';
import './apps/studio.js';
import './apps/eggs/terminal.js';
import './apps/eggs/guestbook.js';
import './apps/eggs/notepad.js';
import './apps/eggs/recycle.js';
import './apps/eggs/secrets.js';

async function start() {
  await runGate();
  const desktop = document.getElementById('desktop');
  desktop.hidden = false;
  initDesktop();
}

start();
