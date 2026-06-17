// player.js — PLAYER (stub; fleshed out by subagent).
import { wm } from '../window-manager.js';
import { registerApp } from '../desktop.js';

registerApp({
  id: 'player', name: 'PLAYER', icon: '🎵', desktop: true,
  open: () => wm.open({
    id: 'player', title: 'PLAYER', icon: '🎵', width: 360, height: 280, resizable: false,
    className: 'app-player',
    render: (el) => { el.innerHTML = '<p class="stub">PLAYER loading...</p>'; },
  }),
});
