// recycle.js - hidden easter egg: a recycle bin of "deleted" gag files.
import { wm } from '../../window-manager.js';
import { registerApp } from '../../desktop.js';

const TRASH = [
  { name: 'old_logo_final_FINAL_v7.png', gag: 'restored 0 times. still ugly.' },
  { name: 'passwords.txt', gag: 'nice try. it was empty anyway.' },
  { name: 'the_real_homepage.html', gag: 'this was the homepage once. it cried.' },
  { name: 'client_feedback.eml', gag: '"can you make the logo bigger" x40' },
  { name: 'budget_q3.xls', gag: 'shredded for emotional reasons.' },
];

registerApp({
  id: 'recycle', name: 'recycle bin', icon: '🗑️', desktop: false, hidden: true,
  open: () => wm.open({
    id: 'recycle', title: 'recycle bin', icon: '🗑️', width: 440, height: 320,
    className: 'app-recycle',
    render: (el) => {
      el.innerHTML = `
        <div class="rb">
          <div class="rb__bar">
            <span class="rb__count"></span>
            <button class="rb__empty" type="button">empty bin</button>
          </div>
          <ul class="rb__list"></ul>
          <p class="rb__say" aria-live="polite"></p>
        </div>
      `;
      const listEl = el.querySelector('.rb__list');
      const countEl = el.querySelector('.rb__count');
      const sayEl = el.querySelector('.rb__say');
      const emptyBtn = el.querySelector('.rb__empty');

      // local copy so emptying does not nuke the seed for next open
      let items = TRASH.slice();

      const say = (text) => { sayEl.textContent = text; };

      const render = () => {
        countEl.textContent = items.length
          ? `${items.length} item${items.length === 1 ? '' : 's'} in bin`
          : 'bin is empty';
        listEl.innerHTML = '';
        items.forEach((it) => {
          const li = document.createElement('li');
          li.className = 'rb__item';
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'rb__file';
          // textContent: gag names are safe, but never parse names as HTML
          btn.innerHTML = '<span class="rb__ico" aria-hidden="true">🗎</span>';
          const label = document.createElement('span');
          label.className = 'rb__name';
          label.textContent = it.name;
          btn.appendChild(label);
          btn.addEventListener('click', () => say(it.gag));
          li.appendChild(btn);
          listEl.appendChild(li);
        });
      };

      emptyBtn.addEventListener('click', () => {
        if (!items.length) { say('it is already empty. let it rest.'); return; }
        items = [];
        render();
        say('poof. all evidence destroyed. you saw nothing.');
      });

      say('double-deleted, but not gone. click a file.');
      render();
    },
  }),
});
