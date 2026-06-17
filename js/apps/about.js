// about.js — ABOUT.TXT (stub; fleshed out by subagent).
import { wm } from '../window-manager.js';
import { registerApp } from '../desktop.js';

registerApp({
  id: 'about', name: 'ABOUT.TXT', icon: '📄', desktop: true,
  open: () => wm.open({
    id: 'about', title: 'ABOUT.TXT', icon: '📄', width: 460, height: 380,
    className: 'app-about',
    render: (el) => { el.innerHTML = '<p class="stub">ABOUT.TXT loading...</p>'; },
  }),
});
