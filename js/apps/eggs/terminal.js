// terminal.js - hidden easter egg: a fake CRT shell.
// Commands: help, ls, cat <file>, whoami, clear, plus secret commands that
// launch the other eggs (guestbook, notepad, bin/recycle) and reveal lore.
import { wm } from '../../window-manager.js';
import { registerApp, openApp } from '../../desktop.js';

// escape user-typed text before it ever touches innerHTML
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FILES = {
  'readme.txt':
    'cozyfiles is a creative studio that does not exist yet.\n' +
    'if you are reading this, you found the back door. welcome.',
  'manifesto.txt':
    'we make things that feel found, not made.\n' +
    'lo-fi on purpose. broken on purpose. cozy on purpose.',
  'todo.txt':
    '- finish the gate\n- hide more doors\n- never explain the joke',
  'keys.dat':
    '[redacted] try the konami code on the desktop. up up down down ...',
};

const LORE = [
  'BOOT LOG: a small studio woke up in a black room and started building doors.',
  'every app here is a room. some rooms only open from inside other rooms.',
  'the lime glyph on the gate is the only honest thing on this whole site.',
];

function help() {
  return [
    'available commands:',
    '  help            this list',
    '  ls              list files',
    '  cat <file>      print a file',
    '  whoami          who are you',
    '  lore            studio transmission',
    '  guestbook       sign the wall (opens an app)',
    '  notepad         open the lore notepad',
    '  bin             open the recycle bin',
    '  clear           wipe the screen',
  ].join('\n');
}

function ls() {
  return Object.keys(FILES).join('   ');
}

function cat(arg) {
  if (!arg) return 'usage: cat <file>';
  const f = FILES[arg.toLowerCase()];
  return f != null ? f : `cat: ${arg}: no such file`;
}

registerApp({
  id: 'terminal', name: 'terminal', icon: '🖥️', desktop: false, hidden: true,
  open: () => wm.open({
    id: 'terminal', title: 'C:\\>', icon: '🖥️', width: 520, height: 340,
    className: 'app-terminal',
    render: (el) => {
      el.innerHTML = `
        <div class="term">
          <div class="term__out" role="log" aria-live="polite"></div>
          <div class="term__line">
            <span class="term__prompt">C:\\&gt;</span>
            <input class="term__input" type="text" autocomplete="off"
                   autocapitalize="off" spellcheck="false" aria-label="terminal input">
            <span class="term__cursor" aria-hidden="true">_</span>
          </div>
        </div>
      `;
      const out = el.querySelector('.term__out');
      const input = el.querySelector('.term__input');
      const history = [];
      let hIdx = 0; // points one past the end of history

      const print = (text, cls) => {
        const div = document.createElement('div');
        div.className = 'term__row' + (cls ? ' ' + cls : '');
        div.innerHTML = esc(text);
        out.appendChild(div);
        out.scrollTop = out.scrollHeight;
      };

      const echo = (cmd) => print('C:\\> ' + cmd, 'term__echo');

      const run = (raw) => {
        const cmd = raw.trim();
        if (cmd) { history.push(cmd); hIdx = history.length; }
        echo(cmd);
        const [name, ...rest] = cmd.split(/\s+/);
        const arg = rest.join(' ');
        switch ((name || '').toLowerCase()) {
          case '': break;
          case 'help': print(help()); break;
          case 'ls': case 'dir': print(ls()); break;
          case 'cat': case 'type': print(cat(arg)); break;
          case 'whoami': print('visitor@cozyfiles  (guest, no privileges)'); break;
          case 'lore': print(LORE[Math.floor(Math.random() * LORE.length)], 'term__lore'); break;
          case 'clear': case 'cls': out.innerHTML = ''; break;
          case 'guestbook':
            print('opening guestbook...', 'term__lore'); openApp('guestbook'); break;
          case 'notepad': case 'lore.txt':
            print('opening notepad...', 'term__lore'); openApp('notepad'); break;
          case 'bin': case 'recycle': case 'trash':
            print('opening recycle bin...', 'term__lore'); openApp('recycle'); break;
          default:
            print(`'${cmd}' is not recognized. type 'help'.`, 'term__err');
        }
      };

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          run(input.value);
          input.value = '';
        } else if (e.key === 'ArrowUp') {
          if (history.length) { hIdx = Math.max(0, hIdx - 1); input.value = history[hIdx] || ''; }
          e.preventDefault();
        } else if (e.key === 'ArrowDown') {
          if (history.length) {
            hIdx = Math.min(history.length, hIdx + 1);
            input.value = hIdx === history.length ? '' : history[hIdx];
          }
          e.preventDefault();
        }
      });

      // refocus input when clicking anywhere in the terminal body
      el.querySelector('.term').addEventListener('mousedown', (e) => {
        if (e.target !== input) { setTimeout(() => input.focus(), 0); }
      });

      // boot banner + focus on open
      print('COZYFILES SHELL v0.9  (c) nobody');
      print("type 'help' for commands.");
      setTimeout(() => input.focus(), 0);
    },
  }),
});
