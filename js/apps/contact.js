// contact.js - CONTACT (email, socials, stubbed form). No backend; fakes a send.
import { wm } from '../window-manager.js';
import { registerApp } from '../desktop.js';

const EMAIL = 'cameron@cozyfiles.us';

// Placeholder social links. Owner swaps the href="#" values for real profiles.
const SOCIALS = [
  { label: 'instagram', glyph: 'IG', href: '#' },
  { label: 'twitter / x', glyph: 'X', href: '#' },
  { label: 'soundcloud', glyph: 'SC', href: '#' },
];

function render(el) {
  el.innerHTML = `
    <div class="cz">
      <p class="cz__lead">reach the studio.</p>

      <section class="cz__block" aria-label="direct contact">
        <span class="cz__label">// direct</span>
        <a class="cz__email" href="mailto:${EMAIL}">${EMAIL}</a>
      </section>

      <section class="cz__block" aria-label="socials">
        <span class="cz__label">// elsewhere</span>
        <ul class="cz__socials">
          ${SOCIALS.map(s => `
            <li>
              <a class="cz__social" href="${s.href}" target="_blank" rel="noopener noreferrer">
                <span class="cz__badge" aria-hidden="true">${s.glyph}</span>${s.label}
              </a>
            </li>`).join('')}
        </ul>
      </section>

      <form class="cz__form" novalidate aria-label="contact form">
        <span class="cz__label">// transmit a message</span>

        <label class="cz__field">
          <span>name</span>
          <input type="text" name="name" autocomplete="name" maxlength="80" />
        </label>

        <label class="cz__field">
          <span>email</span>
          <input type="email" name="email" autocomplete="email" maxlength="120" inputmode="email" />
        </label>

        <label class="cz__field">
          <span>message</span>
          <textarea name="message" rows="4" maxlength="2000"></textarea>
        </label>

        <p class="cz__status" role="status" aria-live="polite"></p>
        <button type="submit" class="cz__send">SEND &gt;</button>
      </form>
    </div>
  `;

  const form = el.querySelector('.cz__form');
  const status = el.querySelector('.cz__status');
  const btn = el.querySelector('.cz__send');
  const fields = {
    name: form.querySelector('[name="name"]'),
    email: form.querySelector('[name="email"]'),
    message: form.querySelector('[name="message"]'),
  };

  let timers = [];
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  // Clear a field's error styling as the visitor types.
  Object.values(fields).forEach(f => {
    f.addEventListener('input', () => f.classList.remove('is-bad'));
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimers();

    const name = fields.name.value.trim();
    const email = fields.email.value.trim();
    const message = fields.message.value.trim();

    let bad = false;
    [['name', name], ['email', email], ['message', message]].forEach(([k, v]) => {
      const empty = v.length === 0;
      fields[k].classList.toggle('is-bad', empty);
      if (empty) bad = true;
    });

    if (bad) {
      status.dataset.tone = 'err';
      status.textContent = 'all fields required. fill the empties.';
      return;
    }

    // No backend exists. Fake the transmission, then drop it into the void.
    btn.disabled = true;
    status.dataset.tone = 'ok';
    status.textContent = 'transmitting...';

    timers.push(setTimeout(() => {
      status.textContent = 'message sent to the void.';
      form.reset();
      btn.disabled = false;
    }, 900));
  });
}

registerApp({
  id: 'contact', name: 'CONTACT', icon: '✉️', desktop: true,
  open: () => wm.open({
    id: 'contact', title: 'CONTACT', icon: '✉️', width: 440, height: 460,
    className: 'app-contact',
    render,
  }),
});
