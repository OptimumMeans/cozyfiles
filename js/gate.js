// gate.js — minimal boot: flicker → one icon → launch → session

/** When true, repeat visitors who finished the gate within 5 minutes skip straight to session. */
const SKIP_RECENT_BOOT_ENABLED = false;

const GATE_TS_KEY = 'cozyfiles-gate-ts';
const SKIP_WINDOW_MS = 5 * 60 * 1000;
const BOOT_FLICKER_MS = 1000;
const LAUNCH_MS = 850;

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function shouldSkipGate() {
  if (!SKIP_RECENT_BOOT_ENABLED) return false;
  try {
    const t = Number(localStorage.getItem(GATE_TS_KEY));
    return Number.isFinite(t) && Date.now() - t < SKIP_WINDOW_MS;
  } catch {
    return false;
  }
}

function markGateSeen() {
  try {
    localStorage.setItem(GATE_TS_KEY, String(Date.now()));
  } catch { /* noop */ }
}

function isTapToOpen() {
  return window.matchMedia('(max-width: 640px)').matches
    || window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function startGateClock() {
  const el = document.getElementById('gate-menubar-clock');
  if (!el) return;
  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => {
    const d = new Date();
    el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  tick();
  setInterval(tick, 15000);
}

export function runGate() {
  return new Promise((resolve) => {
    const gate = document.getElementById('gate');
    if (!gate) {
      resolve();
      return;
    }

    if (shouldSkipGate()) {
      gate.hidden = true;
      markGateSeen();
      resolve();
      return;
    }

    const boot = document.getElementById('gate-boot');
    const desktop = document.getElementById('gate-desktop');
    const launchEl = document.getElementById('gate-launch');
    const launchIcon = document.getElementById('gate-launch-icon');
    const crtLine = document.getElementById('gate-crt-line');
    const snapEl = document.getElementById('gate-snap');

    let phase = 'boot';
    let bootDone = false;
    let finished = false;

    const finish = async () => {
      if (finished) return;
      finished = true;
      gate.classList.add('is-snapping');
      snapEl.hidden = false;
      await delay(reduced() ? 80 : 280);
      gate.hidden = true;
      markGateSeen();
      resolve();
    };

    const showDesktop = () => {
      if (bootDone) return;
      bootDone = true;
      phase = 'desktop';
      boot.hidden = true;
      boot.classList.remove('is-active');
      desktop.hidden = false;
      requestAnimationFrame(() => desktop.classList.add('is-visible'));
      crtLine.classList.add('is-faded');
      startGateClock();
    };

    const runLaunch = async () => {
      if (phase !== 'desktop') return;
      phase = 'launch';
      desktop.classList.remove('is-visible');
      desktop.hidden = true;
      launchEl.hidden = false;
      launchEl.classList.add('is-active');

      const skipLaunch = () => { finish(); };
      gate.addEventListener('click', skipLaunch, { once: true });

      await delay(reduced() ? 180 : LAUNCH_MS);
      gate.removeEventListener('click', skipLaunch);

      crtLine.hidden = false;
      crtLine.classList.remove('is-faded', 'is-thin');
      crtLine.classList.add('is-blooming');
      launchEl.classList.add('is-glitch');
      await delay(reduced() ? 80 : 320);

      await finish();
    };

    const onOpen = () => runLaunch();
    launchIcon.addEventListener('dblclick', onOpen);
    launchIcon.addEventListener('click', () => {
      if (isTapToOpen()) onOpen();
    });

    (async () => {
      if (reduced()) {
        showDesktop();
        return;
      }

      boot.hidden = false;
      boot.classList.add('is-active');
      crtLine.hidden = false;
      crtLine.classList.add('is-thin');

      const skipBoot = () => showDesktop();
      gate.addEventListener('click', skipBoot);

      await delay(BOOT_FLICKER_MS);
      gate.removeEventListener('click', skipBoot);
      if (bootDone) return;

      crtLine.classList.remove('is-thin');
      crtLine.classList.add('is-blooming');
      boot.classList.remove('is-active');
      await delay(280);
      showDesktop();
    })();
  });
}

export function bootDesktop(initDesktop) {
  const desktop = document.getElementById('desktop');
  desktop.hidden = false;
  initDesktop();

  if (reduced()) return;

  desktop.classList.add('is-populating');
  const plugins = desktop.querySelectorAll('.session__plugin');
  plugins.forEach((row, i) => row.style.setProperty('--plugin-i', String(i)));
  const total = plugins.length * 100 + 320;
  setTimeout(() => {
    desktop.classList.remove('is-populating');
    plugins.forEach((row) => row.style.removeProperty('--plugin-i'));
  }, total);
}
