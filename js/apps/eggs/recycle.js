// recycle.js — hidden easter egg recycle bin (stub; fleshed out by subagent).
import { wm } from '../../window-manager.js';
import { registerApp } from '../../desktop.js';

registerApp({
  id: 'recycle', name: 'recycle bin', icon: '🗑️', desktop: false, hidden: true,
  open: () => wm.open({
    id: 'recycle', title: 'recycle bin', icon: '🗑️', width: 420, height: 320,
    className: 'app-recycle',
    render: (el) => { el.innerHTML = '<p class="stub">recycle bin loading...</p>'; },
  }),
});
