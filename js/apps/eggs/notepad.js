// notepad.js - hidden easter egg: a notepad of cryptic studio lore.
// The text is editable in-place (no persistence needed).
import { wm } from '../../window-manager.js';
import { registerApp } from '../../desktop.js';

const LORE = [
  '// untitled.txt',
  '',
  'cozyfiles was not founded. it was discovered, already running,',
  'in a folder nobody remembers making.',
  '',
  'rule 1: every door should look like a wall.',
  'rule 2: the joke is never explained.',
  'rule 3: leave one light on for whoever finds this.',
  '',
  'known doors:',
  '  - the lime glyph on the gate',
  '  - a small bright pixel in a corner of the desktop',
  '  - up up down down left right left right b a',
  '',
  'if you are still reading, sign the guestbook. say you were here.',
  '',
  '> end of file',
].join('\n');

registerApp({
  id: 'notepad', name: 'notepad', icon: '🗒️', desktop: false, hidden: true,
  open: () => wm.open({
    id: 'notepad', title: 'untitled.txt', icon: '🗒️', width: 440, height: 360,
    className: 'app-notepad',
    render: (el) => {
      const ta = document.createElement('textarea');
      ta.className = 'np__text';
      ta.setAttribute('spellcheck', 'false');
      ta.setAttribute('aria-label', 'notepad');
      ta.value = LORE; // value is text, never parsed as HTML
      el.appendChild(ta);
    },
  }),
});
