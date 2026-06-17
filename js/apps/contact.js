// contact.js - CONTACT reimagined as a fake MAIL/inbox client.
// Two panes (list + reading), Inbox + Sent folders, a Compose view that routes
// through mailto: and records into a persisted "Sent" folder. No backend.
import { wm, onTap } from '../window-manager.js';
import { registerApp } from '../desktop.js';

const EMAIL = 'cameron@cozyfiles.us';

// localStorage keys (per the house convention: cozyfiles.mail.*)
const LS_READ = 'cozyfiles.mail.read';   // array of seeded-mail ids marked read
const LS_SENT = 'cozyfiles.mail.sent';   // array of {id,to,subject,body,date}

// Placeholder social links. Owner swaps the href="#" values for real profiles.
const SOCIALS = [
  { label: 'instagram', glyph: 'IG', href: '#' },
  { label: 'twitter / x', glyph: 'X', href: '#' },
  { label: 'soundcloud', glyph: 'SC', href: '#' },
];

// Pre-seeded inbox. Warm, on-brand, zero em dashes. Newest first.
const SEEDED = [
  {
    id: 'welcome',
    from: 'cozyfiles',
    fromAddr: EMAIL,
    subject: 'welcome to the inbox',
    date: '2026-06-01',
    body: [
      'hey, and welcome in.',
      '',
      "you found the mail terminal. this is where the studio actually talks back. poke around the folders, read what is here, and when you are ready to say something, hit COMPOSE up top.",
      '',
      'a few house notes:',
      '- everything you send lands in SENT and sticks around, so it feels real.',
      '- the actual delivery hands off to your mail app, addressed to us.',
      '- no creepy tracking, no list, no spam. just a line of contact.',
      '',
      'we read everything. say hi, pitch a thing, send a weird idea. all of it welcome.',
      '',
      'warmly,',
      'cozyfiles',
    ].join('\n'),
  },
  {
    id: 'studio-hours',
    from: 'the front desk',
    fromAddr: EMAIL,
    subject: 're: are you taking work?',
    date: '2026-05-28',
    body: [
      'short answer: usually, yes.',
      '',
      'we take on a handful of jobs at a time so each one gets real attention. shows, visuals, posters, the occasional thing with no name yet. if you have a project, the COMPOSE button is the door.',
      '',
      'tell us what it is, when it is, and the vibe. we will write back.',
    ].join('\n'),
  },
  {
    id: 'signal',
    from: 'night shift',
    fromAddr: EMAIL,
    subject: 'a transmission, unread',
    date: '2026-05-15',
    body: [
      'the lights in the studio are still on.',
      '',
      'someone left a tape running and a poster half folded on the desk. it can wait until morning. most things can.',
      '',
      'go make something. we will be here.',
    ].join('\n'),
  },
];

// ---- persistence helpers -------------------------------------------------

function loadReadSet() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_READ));
    return new Set(Array.isArray(raw) ? raw : []);
  } catch { return new Set(); }
}
function saveReadSet(set) {
  try { localStorage.setItem(LS_READ, JSON.stringify([...set])); } catch { /* storage full or blocked */ }
}
function loadSent() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_SENT));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}
function saveSent(list) {
  try { localStorage.setItem(LS_SENT, JSON.stringify(list)); } catch { /* storage full or blocked */ }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---- view -----------------------------------------------------------------

function render(contentEl) {
  const readSet = loadReadSet();

  // state
  let folder = 'inbox';      // 'inbox' | 'sent'
  let selectedId = null;     // currently open message id (per folder, recomputed)
  let composing = false;

  contentEl.innerHTML = `
    <div class="mz">
      <div class="mz__toolbar">
        <div class="mz__tabs" role="tablist" aria-label="mail folders">
          <button class="mz__tab" type="button" role="tab" data-folder="inbox">
            INBOX <span class="mz__badge" data-unread hidden>0</span>
          </button>
          <button class="mz__tab" type="button" role="tab" data-folder="sent">SENT</button>
        </div>
        <button class="mz__compose" type="button">COMPOSE &gt;</button>
      </div>
      <div class="mz__panes">
        <ul class="mz__list" role="listbox" aria-label="messages"></ul>
        <section class="mz__read" aria-label="reading pane"></section>
      </div>
    </div>
  `;

  const tabs = [...contentEl.querySelectorAll('.mz__tab')];
  const listEl = contentEl.querySelector('.mz__list');
  const readEl = contentEl.querySelector('.mz__read');
  const composeBtn = contentEl.querySelector('.mz__compose');
  const unreadBadge = contentEl.querySelector('[data-unread]');
  const panesEl = contentEl.querySelector('.mz__panes');

  function unreadCount() {
    return SEEDED.filter(m => !readSet.has(m.id)).length;
  }
  function refreshUnreadBadge() {
    const n = unreadCount();
    unreadBadge.textContent = String(n);
    unreadBadge.hidden = n === 0;
  }

  // Messages for the active folder, newest first, normalized shape.
  function currentMessages() {
    if (folder === 'sent') {
      return loadSent()
        .slice()
        .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0))
        .map(m => ({
          id: m.id, from: 'you', fromAddr: EMAIL, to: m.to,
          subject: m.subject || '(no subject)', date: m.date, body: m.body, sent: true,
        }));
    }
    return SEEDED.slice(); // already newest first
  }

  function paintList() {
    const msgs = currentMessages();
    panesEl.classList.toggle('is-compose', composing);

    if (msgs.length === 0) {
      listEl.innerHTML = `<li class="mz__empty">${folder === 'sent' ? 'no sent mail yet.' : 'inbox is empty.'}</li>`;
    } else {
      listEl.innerHTML = msgs.map(m => {
        const unread = folder === 'inbox' && !readSet.has(m.id);
        return `
          <li class="mz__item${unread ? ' is-unread' : ''}${m.id === selectedId ? ' is-active' : ''}"
              role="option" tabindex="0" data-id="${escapeHtml(m.id)}"
              aria-selected="${m.id === selectedId}">
            <span class="mz__dot" aria-hidden="true"></span>
            <span class="mz__itemmain">
              <span class="mz__from">${escapeHtml(folder === 'sent' ? ('to: ' + (m.to || EMAIL)) : m.from)}</span>
              <span class="mz__subject">${escapeHtml(m.subject)}</span>
            </span>
            <span class="mz__date">${escapeHtml(m.date)}</span>
          </li>`;
      }).join('');

      listEl.querySelectorAll('.mz__item').forEach(li => {
        onTap(li, () => openMessage(li.dataset.id));
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMessage(li.dataset.id); }
        });
      });
    }
  }

  function openMessage(id) {
    composing = false;
    selectedId = id;

    // mark seeded inbox mail as read
    if (folder === 'inbox' && !readSet.has(id)) {
      readSet.add(id);
      saveReadSet(readSet);
      refreshUnreadBadge();
    }

    const msg = currentMessages().find(m => m.id === id);
    if (!msg) { paintList(); paintEmptyReader(); return; }

    const metaLine = msg.sent
      ? `to: ${escapeHtml(msg.to || EMAIL)}`
      : `from: ${escapeHtml(msg.from)} &lt;${escapeHtml(msg.fromAddr)}&gt;`;

    readEl.innerHTML = `
      <article class="mz__msg">
        <button class="mz__back" type="button">&lt; back</button>
        <header class="mz__msghead">
          <h2 class="mz__msgsubject">${escapeHtml(msg.subject)}</h2>
          <p class="mz__msgmeta">${metaLine}</p>
          <p class="mz__msgdate">${escapeHtml(msg.date)}</p>
        </header>
        <div class="mz__msgbody">${escapeHtml(msg.body)}</div>
        ${msg.sent ? '' : `
          <footer class="mz__msgfoot">
            <button class="mz__reply" type="button" data-reply="${escapeHtml(msg.subject)}">REPLY &gt;</button>
          </footer>`}
      </article>
    `;
    panesEl.classList.add('show-read'); // mobile: reveal reader sheet
    panesEl.classList.remove('is-compose');

    const replyBtn = readEl.querySelector('.mz__reply');
    if (replyBtn) onTap(replyBtn, () => openCompose('re: ' + replyBtn.dataset.reply));
    const backBtn = readEl.querySelector('.mz__back');
    if (backBtn) onTap(backBtn, () => { selectedId = null; paintList(); paintEmptyReader(); });

    paintList();
  }

  function paintEmptyReader() {
    readEl.innerHTML = `<p class="mz__placeholder">select a message to read.</p>`;
    panesEl.classList.remove('show-read');
  }

  // ---- compose -----------------------------------------------------------

  function openCompose(prefillSubject = '') {
    composing = true;
    selectedId = null;
    panesEl.classList.add('is-compose', 'show-read');
    tabs.forEach(t => t.setAttribute('aria-selected', 'false'));
    paintList();

    readEl.innerHTML = `
      <form class="mz__form" novalidate aria-label="compose message">
        <button class="mz__back" type="button">&lt; back</button>
        <p class="mz__formhead">// new message to ${escapeHtml(EMAIL)}</p>

        <label class="mz__field">
          <span>your name</span>
          <input type="text" name="name" autocomplete="name" maxlength="80" />
        </label>

        <label class="mz__field">
          <span>your email</span>
          <input type="email" name="email" autocomplete="email" maxlength="120" inputmode="email" />
        </label>

        <label class="mz__field">
          <span>subject</span>
          <input type="text" name="subject" maxlength="140" value="${escapeHtml(prefillSubject)}" />
        </label>

        <label class="mz__field">
          <span>message</span>
          <textarea name="message" rows="6" maxlength="2000"></textarea>
        </label>

        <p class="mz__status" role="status" aria-live="polite"></p>
        <div class="mz__formactions">
          <button type="submit" class="mz__send">SEND &gt;</button>
          <button type="button" class="mz__cancel">cancel</button>
        </div>

        <div class="mz__elsewhere" aria-label="socials">
          <span class="mz__elsewherelabel">// elsewhere</span>
          <ul class="mz__socials">
            ${SOCIALS.map(s => `
              <li>
                <a class="mz__social" href="${s.href}" target="_blank" rel="noopener noreferrer">
                  <span class="mz__socialbadge" aria-hidden="true">${s.glyph}</span>${s.label}
                </a>
              </li>`).join('')}
          </ul>
        </div>
      </form>
    `;

    const form = readEl.querySelector('.mz__form');
    const status = form.querySelector('.mz__status');
    const sendBtn = form.querySelector('.mz__send');
    const fields = {
      name: form.querySelector('[name="name"]'),
      email: form.querySelector('[name="email"]'),
      subject: form.querySelector('[name="subject"]'),
      message: form.querySelector('[name="message"]'),
    };

    Object.values(fields).forEach(f => {
      f.addEventListener('input', () => f.classList.remove('is-bad'));
    });

    const backToList = () => { composing = false; selectFolder(folder); };
    onTap(form.querySelector('.mz__cancel'), backToList);
    onTap(form.querySelector('.mz__back'), backToList);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = fields.name.value.trim();
      const email = fields.email.value.trim();
      const subject = fields.subject.value.trim();
      const message = fields.message.value.trim();

      // name, email, message are required; subject can default.
      let bad = false;
      [['name', name], ['email', email], ['message', message]].forEach(([k, v]) => {
        const empty = v.length === 0;
        fields[k].classList.toggle('is-bad', empty);
        if (empty) bad = true;
      });
      if (bad) {
        status.dataset.tone = 'err';
        status.textContent = 'name, email, and message are required.';
        return;
      }

      sendBtn.disabled = true;
      status.dataset.tone = 'ok';
      status.textContent = 'routing to your mail app...';

      const subjectLine = subject || `hello from ${name}`;
      const bodyLines = [message, '', '---', `from: ${name} <${email}>`].join('\n');

      // Record into the persisted Sent folder so it feels real.
      const sentList = loadSent();
      sentList.push({
        id: 'sent-' + Date.now(),
        to: EMAIL,
        subject: subjectLine,
        body: bodyLines,
        date: new Date().toISOString().slice(0, 10),
      });
      saveSent(sentList);

      // No backend: hand off to the visitor's mail client via mailto:.
      const href = `mailto:${EMAIL}`
        + `?subject=${encodeURIComponent(subjectLine)}`
        + `&body=${encodeURIComponent(bodyLines)}`;
      try { window.location.href = href; } catch { /* popup blocked; copy still in Sent */ }

      status.textContent = 'sent. saved a copy to SENT.';
      setTimeout(() => {
        composing = false;
        selectFolder('sent');
      }, 700);
    });
  }

  // ---- folders -----------------------------------------------------------

  function selectFolder(next) {
    folder = next;
    composing = false;
    selectedId = null;
    tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.folder === folder)));
    panesEl.classList.remove('is-compose');
    paintList();
    paintEmptyReader();
  }

  tabs.forEach(t => onTap(t, () => selectFolder(t.dataset.folder)));
  onTap(composeBtn, () => openCompose());

  // boot
  refreshUnreadBadge();
  selectFolder('inbox');
}

registerApp({
  id: 'contact', name: 'CONTACT', icon: '✉️', desktop: true,
  open: () => wm.open({
    id: 'contact', title: 'MAIL', icon: '✉️', width: 600, height: 440,
    className: 'app-contact',
    render,
  }),
});
