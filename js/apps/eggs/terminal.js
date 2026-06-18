// terminal.js - hidden easter egg: a real (toy) CRT shell.
// A small command parser that lists/launches apps, prints fake files, keeps
// command history (up/down), and hides a few easter commands. Green-on-black,
// CRT flavor. Launched via the konami code or the corner hotspot (see
// secrets.js); do not change how it is opened.
import { wm } from '../../window-manager.js';
import { registerApp, openApp, getApp } from '../../desktop.js';

// escape any text before it ever touches innerHTML
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// localStorage helpers, namespaced under cozyfiles.terminal.*
const LS_HIST  = 'cozyfiles.terminal.history';
const LS_THEME = 'cozyfiles.terminal.theme';
const LS_USER  = 'cozyfiles.os.user';        // optional handle set elsewhere
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

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

// apps the `open` command can launch. ids must match the desktop registry.
const OPENABLE = ['files', 'about', 'contact', 'studio', 'paint',
                  'guestbook', 'notepad', 'recycle', 'terminal'];

// available terminal color themes (className toggled on the term root)
const THEMES = ['green', 'amber', 'mono', 'ice'];

function whoami() {
  const handle = lsGet(LS_USER, '').trim();
  if (handle) return `${handle}@cozyfiles  (guest, no privileges)`;
  return 'visitor@cozyfiles  (guest, no privileges)';
}

function help() {
  return [
    'available commands:',
    '  help              this list',
    '  ls / dir          list files',
    '  cat <file>        print a file',
    '  open <app>        launch an app (try `open files`)',
    '  apps              list launchable apps',
    '  whoami            who are you',
    '  date              current date + time',
    '  echo <text>       say it back',
    '  theme <name>      recolor the shell (green/amber/mono/ice)',
    '  lore              studio transmission',
    '  about             open ABOUT.TXT',
    '  clear / cls       wipe the screen',
    '  exit              close the terminal',
    '',
    'some doors are not on this list.',
  ].join('\n');
}

registerApp({
  id: 'terminal', name: 'terminal', icon: '🖥️', desktop: false, hidden: true,
  open: () => wm.open({
    id: 'terminal', title: 'C:\\>', icon: '🖥️', width: 520, height: 340,
    className: 'app-terminal',
    render: (el, win) => {
      el.innerHTML = `
        <div class="term" data-theme="green">
          <div class="term__out" role="log" aria-live="polite"></div>
          <div class="term__line">
            <span class="term__prompt">C:\\&gt;</span>
            <input class="term__input" type="text" autocomplete="off"
                   autocapitalize="off" spellcheck="false" aria-label="terminal input">
            <span class="term__cursor" aria-hidden="true">_</span>
          </div>
        </div>
      `;
      const termEl = el.querySelector('.term');
      const out = el.querySelector('.term__out');
      const input = el.querySelector('.term__input');

      // command history persists per device under cozyfiles.terminal.history
      let history = [];
      try { history = JSON.parse(lsGet(LS_HIST, '[]')) || []; } catch { history = []; }
      if (!Array.isArray(history)) history = [];
      let hIdx = history.length; // points one past the end of history
      const saveHistory = () => lsSet(LS_HIST, JSON.stringify(history.slice(-50)));

      const print = (text, cls) => {
        const div = document.createElement('div');
        div.className = 'term__row' + (cls ? ' ' + cls : '');
        div.innerHTML = esc(text);
        out.appendChild(div);
        out.scrollTop = out.scrollHeight;
        return div;
      };

      const echo = (cmd) => print('C:\\> ' + cmd, 'term__echo');

      // apply a theme by toggling a data attribute (CSS does the recolor)
      const applyTheme = (name) => {
        const t = THEMES.includes(name) ? name : 'green';
        termEl.setAttribute('data-theme', t);
        lsSet(LS_THEME, t);
        return t;
      };
      applyTheme(lsGet(LS_THEME, 'green'));

      // ---- matrix rain: a short, self-cleaning visual gag -----------------
      let matrixTimer = 0;
      const matrix = () => {
        if (matrixTimer) return;
        const glyphs = 'cozyfiles01<>{}/\\|*+.';
        let ticks = 0;
        print('wake up...', 'term__lore');
        matrixTimer = setInterval(() => {
          let line = '';
          for (let i = 0; i < 38; i++) {
            line += glyphs[Math.floor(Math.random() * glyphs.length)];
          }
          print(line, 'term__matrix');
          if (++ticks >= 14) {
            clearInterval(matrixTimer); matrixTimer = 0;
            print('the rabbit hole closes.', 'term__lore');
            input.focus();
          }
        }, 90);
      };

      const run = (raw) => {
        const cmd = raw.trim();
        if (cmd) {
          // avoid logging the same command twice in a row
          if (history[history.length - 1] !== cmd) history.push(cmd);
          history = history.slice(-50);
          saveHistory();
          hIdx = history.length;
        }
        echo(cmd);
        const [name, ...rest] = cmd.split(/\s+/);
        const arg = rest.join(' ');
        switch ((name || '').toLowerCase()) {
          case '': break;
          case 'help': case '?': print(help()); break;
          case 'ls': case 'dir': print(Object.keys(FILES).join('   ')); break;
          case 'cat': case 'type': {
            if (!arg) { print('usage: cat <file>'); break; }
            const f = FILES[arg.toLowerCase()];
            print(f != null ? f : `cat: ${arg}: no such file`, f != null ? '' : 'term__err');
            break;
          }
          case 'apps':
            print('launchable: ' + OPENABLE.filter(id => getApp(id)).join('   '));
            break;
          case 'open': case 'start': case 'run': {
            const id = arg.toLowerCase();
            if (!id) { print('usage: open <app>   (try `apps`)'); break; }
            if (!OPENABLE.includes(id) || !getApp(id)) {
              print(`open: ${arg}: no such app. type 'apps'.`, 'term__err'); break;
            }
            print(`opening ${id}...`, 'term__lore');
            openApp(id);
            break;
          }
          case 'whoami': print(whoami()); break;
          case 'date': case 'time': print(new Date().toString()); break;
          case 'echo': print(arg); break;
          case 'theme': {
            if (!arg) { print('themes: ' + THEMES.join('  ') + '   (current: ' + termEl.getAttribute('data-theme') + ')'); break; }
            const t = arg.toLowerCase();
            if (!THEMES.includes(t)) { print(`theme: ${arg}: unknown. try ${THEMES.join('/')}.`, 'term__err'); break; }
            applyTheme(t);
            print(`theme set to ${t}.`, 'term__lore');
            break;
          }
          case 'lore': print(LORE[Math.floor(Math.random() * LORE.length)], 'term__lore'); break;
          case 'about': print('opening ABOUT.TXT...', 'term__lore'); openApp('about'); break;
          case 'clear': case 'cls': out.innerHTML = ''; break;
          case 'exit': case 'quit': print('goodbye.', 'term__lore'); setTimeout(() => win.close(), 300); break;

          // --- doors that are not on the help list --------------------------
          case 'guestbook':
            print('opening guestbook...', 'term__lore'); openApp('guestbook'); break;
          case 'notepad': case 'lore.txt':
            print('opening notepad...', 'term__lore'); openApp('notepad'); break;
          case 'bin': case 'recycle': case 'trash':
            print('opening recycle bin...', 'term__lore'); openApp('recycle'); break;
          case 'sudo':
            print(`${lsGet(LS_USER, 'visitor').trim() || 'visitor'} is not in the sudoers file. this incident will be reported.`, 'term__err');
            break;
          case 'matrix': matrix(); break;
          case 'konami':
            print('up up down down left right left right b a', 'term__lore');
            print('(the desktop is listening, not this window.)', 'term__echo');
            break;
          case 'party':
            print('dispatching party...', 'term__lore');
            window.dispatchEvent(new CustomEvent('cozyfiles:party'));
            break;
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
        } else if (e.key === 'l' && e.ctrlKey) {
          out.innerHTML = '';
          e.preventDefault();
        }
      });

      // refocus input when clicking anywhere in the terminal body
      termEl.addEventListener('mousedown', (e) => {
        if (e.target !== input) { setTimeout(() => input.focus(), 0); }
      });

      // stop the matrix timer if the window closes mid-rain
      const origClose = win.close;
      win.close = () => { if (matrixTimer) { clearInterval(matrixTimer); matrixTimer = 0; } origClose(); };

      // boot banner + focus on open
      print('COZYFILES SHELL v1.0  (c) nobody');
      print("type 'help' for commands.");
      setTimeout(() => input.focus(), 0);
    },
  }),
});
