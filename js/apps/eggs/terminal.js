// terminal.js — hidden easter egg shell (stub; fleshed out by subagent).
import { wm } from '../../window-manager.js';
import { registerApp } from '../../desktop.js';

registerApp({
  id: 'terminal', name: 'terminal', icon: '🖥️', desktop: false, hidden: true,
  open: () => wm.open({
    id: 'terminal', title: 'C:\\>', icon: '🖥️', width: 480, height: 320,
    className: 'app-terminal',
    render: (el) => { el.innerHTML = '<pre class="stub">terminal loading...</pre>'; },
  }),
});
