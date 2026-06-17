// about.js - ABOUT.TXT (manifesto). A text-document feel: studio story + ethos.
// Cryptic but readable. Copy here is tasteful placeholder; owner swaps it later.
import { wm } from '../window-manager.js';
import { registerApp } from '../desktop.js';

// PLACEHOLDER manifesto. Each entry is one paragraph. Keep it evocative.
const PARAGRAPHS = [
  'cozyfiles is a small room with the lights left on.',
  'we are a studio, a collective, a habit. a few people who keep showing up to make things that did not exist that morning. some of it is for clients. some of it is for the drawer. the difference matters less than you would think.',
  'we like the work that is a little unfinished on purpose. the seam left showing. the cursor still blinking. a thing made by hands that were happy to be busy.',
  'nothing here is permanent. files get renamed. folders get moved. that is the point. come back later and the furniture will be somewhere new.',
];

// A short "we make:" list.
const WE_MAKE = [
  'objects, images, and sounds',
  'rooms you can click around in',
  'small machines that do one strange thing well',
  'the occasional secret',
];

// A faint, in-fiction "last modified" line. Static placeholder.
const LAST_MODIFIED = 'last modified 06.16.2026 // somewhere quiet';

function render(el) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  el.innerHTML = `
    <div class="ab">
      <div class="ab__menu" aria-hidden="true">
        <span>File</span><span>Edit</span><span>Format</span><span>View</span>
      </div>
      <article class="ab__doc" tabindex="0" aria-label="about cozyfiles document">
        <h1 class="ab__title">cozyfiles.txt</h1>
        <div class="ab__rule" aria-hidden="true">============================</div>

        <div class="ab__body">
          ${PARAGRAPHS.map(p => `<p class="ab__p">${p}</p>`).join('')}

          <p class="ab__p ab__p--label">we make:</p>
          <ul class="ab__list">
            ${WE_MAKE.map(item => `<li>&gt; ${item}</li>`).join('')}
          </ul>

          <p class="ab__p ab__sign">// the rest is under construction, and always will be.<span class="ab__caret" aria-hidden="true">_</span></p>
        </div>
      </article>
      <div class="ab__status" role="status">${LAST_MODIFIED}</div>
    </div>
  `;

  // Tasteful reveal: fade each block in sequence. Skipped for reduced motion.
  const blocks = [...el.querySelectorAll('.ab__p, .ab__list')];
  if (reduced) {
    blocks.forEach(b => b.classList.add('is-in'));
    return;
  }

  const timers = [];
  blocks.forEach((b, i) => {
    timers.push(setTimeout(() => b.classList.add('is-in'), 90 * i));
  });

  // Stop pending reveals if the window closes mid-animation.
  el.closest('.win')?.addEventListener('animationstart', (e) => {
    if (e.animationName && /clos/i.test(e.animationName)) timers.forEach(clearTimeout);
  });
}

registerApp({
  id: 'about', name: 'ABOUT.TXT', icon: '📄', desktop: true,
  open: () => wm.open({
    id: 'about', title: 'ABOUT.TXT', icon: '📄', width: 460, height: 400,
    className: 'app-about',
    render,
  }),
});
