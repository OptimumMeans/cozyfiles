// files.js — FILES.EXE (stub; fleshed out by subagent).
import { wm } from '../window-manager.js';
import { registerApp } from '../desktop.js';

registerApp({
  id: 'files', name: 'FILES.EXE', icon: '📁', desktop: true,
  open: () => wm.open({
    id: 'files', title: 'FILES.EXE', icon: '📁', width: 600, height: 420,
    className: 'app-files',
    render: (el) => { el.innerHTML = '<p class="stub">FILES.EXE loading...</p>'; },
  }),
});
