// notepad.js — hidden easter egg (stub; fleshed out by subagent).
import { wm } from '../../window-manager.js';
import { registerApp } from '../../desktop.js';

registerApp({
  id: 'notepad', name: 'notepad', icon: '🗒️', desktop: false, hidden: true,
  open: () => wm.open({
    id: 'notepad', title: 'untitled.txt', icon: '🗒️', width: 420, height: 340,
    className: 'app-notepad',
    render: (el) => { el.innerHTML = '<p class="stub">notepad loading...</p>'; },
  }),
});
