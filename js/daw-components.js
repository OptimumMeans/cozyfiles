// daw-components.js — reusable mixer UI bits (session sidebar, etc.)

const VU_SEGMENTS = 12;

export function createDawKnob(rotDeg = 50) {
  const knob = document.createElement('div');
  knob.className = 'daw-channel__knob';
  knob.style.setProperty('--knob-rot', `${rotDeg}deg`);
  knob.innerHTML = '<span class="daw-channel__knob-tick"></span>';
  knob.setAttribute('aria-hidden', 'true');
  return knob;
}

export function createDawFaderVuRow({ vuLevel = 0 } = {}) {
  const row = document.createElement('div');
  row.className = 'daw-channel__strip-row';
  row.setAttribute('aria-hidden', 'true');
  const vuSegs = Array.from({ length: VU_SEGMENTS }, (_, s) => {
    const tier = s >= VU_SEGMENTS - 1 ? 'peak' : s >= VU_SEGMENTS - 4 ? 'high' : 'low';
    const lit = s < vuLevel ? ' is-lit' : '';
    return `<div class="daw-channel__vu-seg${lit}" data-tier="${tier}"></div>`;
  }).join('');
  row.innerHTML = `
    <div class="daw-channel__vu" aria-hidden="true">${vuSegs}</div>
    <div class="daw-channel__fader" aria-hidden="true">
      <div class="daw-channel__fader-ticks"></div>
      <div class="daw-channel__fader-cap"><span class="daw-channel__fader-notch"></span></div>
    </div>
  `;
  return row;
}
