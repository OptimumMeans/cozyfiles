// contact.js — CONTACT (stub; fleshed out by subagent).
import { wm } from '../window-manager.js';
import { registerApp } from '../desktop.js';

registerApp({
  id: 'contact', name: 'CONTACT', icon: '✉️', desktop: true,
  open: () => wm.open({
    id: 'contact', title: 'CONTACT', icon: '✉️', width: 440, height: 400,
    className: 'app-contact',
    render: (el) => { el.innerHTML = '<p class="stub">CONTACT loading...</p>'; },
  }),
});
