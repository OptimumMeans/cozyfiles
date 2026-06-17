// guestbook.js — hidden easter egg (stub; fleshed out by subagent).
import { wm } from '../../window-manager.js';
import { registerApp } from '../../desktop.js';

registerApp({
  id: 'guestbook', name: 'guestbook', icon: '📓', desktop: false, hidden: true,
  open: () => wm.open({
    id: 'guestbook', title: 'guestbook', icon: '📓', width: 420, height: 360,
    className: 'app-guestbook',
    render: (el) => { el.innerHTML = '<p class="stub">guestbook loading...</p>'; },
  }),
});
