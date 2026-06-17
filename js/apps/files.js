// files.js - FILES.EXE (file-explorer portfolio, the centerpiece app).
import { wm } from '../window-manager.js';
import { registerApp } from '../desktop.js';

// Inline fallback portfolio. The real source of truth is data/portfolio.json,
// fetched on load. This copy keeps FILES working from file:// (where fetch is
// blocked) or if the JSON is ever missing. Keep them in sync.
const FALLBACK = {
  folders: [
    {
      id: 'projects', label: 'PROJECTS', glyph: '📂',
      files: [
        { slug: 'chase-atlantic-fillmore', name: 'CHASE_ATLANTIC_FILLMORE.mp4', title: 'Chase Atlantic // Fillmore', type: '.mp4', accent: 'accent', kind: 'video', media: 'assets/media/chase-atlantic-fillmore.mp4', poster: 'assets/media/chase-atlantic-fillmore.jpg', blurb: 'Recap cut from the Fillmore Minneapolis show.' },
        { slug: 'tiesto', name: 'TIESTO.mp4', title: 'Tiesto', type: '.mp4', accent: 'accent-2', kind: 'video', media: 'assets/media/tiesto.mp4', poster: 'assets/media/tiesto.jpg', blurb: 'Live visual recap.' },
        { slug: 'cozyfiles-live', name: 'COZYFILES_LIVE.jpg', title: 'Cozyfiles // Live', type: '.jpg', accent: 'crt-green', kind: 'image', media: 'assets/media/cozyfiles-live.jpg', blurb: 'Still from the floor.' },
        { slug: 'ghost-grid', name: 'GHOST_GRID.jpg', title: 'Ghost Grid', type: '.jpg', accent: 'accent', blurb: 'A typeface drawn entirely from the gaps between billboards.' },
        { slug: 'paper-saints', name: 'PAPER_SAINTS.mov', title: 'Paper Saints', type: '.mov', accent: 'accent-2', blurb: 'Stop-motion saints folded from receipts. They blink when you leave the room.' },
        { slug: 'velvet-error', name: 'VELVET_ERROR.psd', title: 'Velvet Error', type: '.psd', accent: 'crt-green', blurb: 'A poster series for a band that has never agreed to exist.' },
      ],
    },
    {
      id: 'archive', label: 'ARCHIVE', glyph: '🗃️',
      files: [
        { slug: 'dial-tone-89', name: 'DIAL_TONE_89.jpg', title: 'Dial Tone 89', type: '.jpg', accent: 'accent', blurb: 'Our first job. Everyone who saw it has since changed their number.' },
        { slug: 'concrete-lullaby', name: 'CONCRETE_LULLABY.mov', title: 'Concrete Lullaby', type: '.mov', accent: 'accent-2', blurb: 'Shelved campaign for a city that was repaved before it shipped.' },
        { slug: 'untitled-final-2', name: 'UNTITLED_FINAL_v2.psd', title: 'Untitled (final) (2)', type: '.psd', accent: 'crt-green', blurb: 'We swear this was the last revision. It was not.' },
      ],
    },
    {
      id: 'secrets', label: 'SECRETS', glyph: '🔒', locked: true,
      files: [
        { slug: 'do-not-open', name: 'DO_NOT_OPEN.bin', title: 'do_not_open', type: '.bin', accent: 'accent-2', cryptic: true, blurb: 'You opened it. Of course you did. There is nothing here yet. Keep watching.' },
        { slug: 'readme-soon', name: 'README_SOON.txt', title: 'readme_soon', type: '.txt', accent: 'accent', cryptic: true, blurb: 'Three more files are coming. We have not made them yet. Neither have you.' },
      ],
    },
  ],
  hidden: [
    {
      folderId: 'secrets',
      file: { slug: 'you-found-the-floor', name: 'THE_FLOOR.exe', title: 'the_floor', type: '.bin', accent: 'crt-green', cryptic: true, hidden: true, blurb: 'You opened every door in the house. So we left one more. This is the floor under the floor. Stay as long as you like.' },
    },
  ],
};

// Live portfolio. Starts as the fallback; loadPortfolio() may replace it.
let FOLDERS = FALLBACK.folders;
let HIDDEN = FALLBACK.hidden;
let loaded = false;

async function loadPortfolio() {
  if (loaded) return;
  loaded = true;
  try {
    const res = await fetch('data/portfolio.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (Array.isArray(data.folders) && data.folders.length) {
      FOLDERS = data.folders;
      HIDDEN = Array.isArray(data.hidden) ? data.hidden : [];
    }
  } catch (_err) {
    // fetch blocked (file://) or JSON missing - keep the inline fallback.
  }
}

const TYPE_GLYPH = {
  '.mov': '🎞️', '.mp4': '🎬', '.mp3': '🎵', '.jpg': '🖼️',
  '.psd': '🎨', '.txt': '📄', '.bin': '⬛', '.exe': '⬛',
};

// ---- localStorage state ---------------------------------------------------
const LS = {
  order: 'cozyfiles.files.order',       // { folderId: [slug, ...] }
  recycle: 'cozyfiles.files.recycle',   // [ { ...file, _folder, _ts } ]
  progress: 'cozyfiles.files.progress', // { opened: [folderId], unlocked: bool }
};

function lsRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_e) { return fallback; }
}
function lsWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_e) { /* quota / private mode */ }
}

// shared store helpers (FILES <-> RECYCLE). A same-tab custom event lets an
// open RECYCLE window refresh immediately (the native 'storage' event only
// fires in *other* tabs).
const RECYCLE_EVENT = 'cozyfiles:recycle';
export function getRecycle() { return lsRead(LS.recycle, []); }
function setRecycle(list) {
  lsWrite(LS.recycle, list);
  try { window.dispatchEvent(new CustomEvent(RECYCLE_EVENT)); } catch (_e) { /* old browsers */ }
}

// progress (hidden-file unlock) -------------------------------------------
const HIDDEN_UNLOCK_COUNT = 3; // open this many distinct folders to reveal
function getProgress() { return lsRead(LS.progress, { opened: [], unlocked: false }); }
function setProgress(p) { lsWrite(LS.progress, p); }
function markFolderOpened(folderId) {
  const p = getProgress();
  if (!p.opened.includes(folderId)) p.opened.push(folderId);
  if (!p.unlocked && p.opened.length >= HIDDEN_UNLOCK_COUNT) p.unlocked = true;
  setProgress(p);
  return p;
}

// ---- model helpers --------------------------------------------------------
// Returns the visible files for a folder: seeds (minus recycled) + any revealed
// hidden files, ordered by the saved per-folder order.
function folderFiles(folder) {
  const recycledSlugs = new Set(getRecycle().map(r => r.slug));
  let files = folder.files.filter(f => !recycledSlugs.has(f.slug));

  // reveal hidden files attached to this folder once unlocked
  const prog = getProgress();
  if (prog.unlocked) {
    HIDDEN.filter(h => h.folderId === folder.id).forEach(h => {
      if (!recycledSlugs.has(h.file.slug) && !files.some(f => f.slug === h.file.slug)) {
        files.push(h.file);
      }
    });
  }

  // apply saved order
  const order = lsRead(LS.order, {})[folder.id];
  if (order && order.length) {
    const bySlug = new Map(files.map(f => [f.slug, f]));
    const sorted = [];
    order.forEach(slug => { if (bySlug.has(slug)) { sorted.push(bySlug.get(slug)); bySlug.delete(slug); } });
    bySlug.forEach(f => sorted.push(f)); // new / unordered files go last
    files = sorted;
  }
  return files;
}

function saveOrder(folderId, slugs) {
  const all = lsRead(LS.order, {});
  all[folderId] = slugs;
  lsWrite(LS.order, all);
}

function findFile(slug) {
  for (const folder of FOLDERS) {
    const f = folder.files.find(x => x.slug === slug);
    if (f) return f;
  }
  for (const h of HIDDEN) { if (h.file.slug === slug) return h.file; }
  // recycled files keep their data in the bin record
  const rec = getRecycle().find(r => r.slug === slug);
  return rec || null;
}
function folderOfFile(slug) {
  for (const folder of FOLDERS) {
    if (folder.files.some(x => x.slug === slug)) return folder.id;
  }
  const h = HIDDEN.find(h => h.file.slug === slug);
  return h ? h.folderId : null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Real media renders inline; everything else gets the tinted placeholder cover.
function coverMarkup(file) {
  if (file.kind === 'video' && file.media) {
    return `<video class="fx-media" controls playsinline preload="metadata"
        ${file.poster ? `poster="${escapeHtml(file.poster)}"` : ''}>
        <source src="${escapeHtml(file.media)}" type="video/mp4" />
      </video>`;
  }
  if (file.kind === 'image' && file.media) {
    return `<img class="fx-media" src="${escapeHtml(file.media)}" alt="${escapeHtml(file.title)}" loading="lazy" />`;
  }
  return `<div class="fx-cover fx-cover--${file.accent}" aria-hidden="true">
      <span class="fx-cover__type">${escapeHtml(file.type)}</span>
    </div>`;
}

// Grid thumbnail: real video (poster + hover scrub) / image / tinted glyph.
function thumbMarkup(file) {
  if (file.kind === 'video' && file.media) {
    const poster = file.poster ? `poster="${escapeHtml(file.poster)}"` : '';
    return `<span class="fx-file__thumb fx-file__thumb--video" data-scrub>
        <video class="fx-thumb-media" muted playsinline preload="metadata"
               ${poster} src="${escapeHtml(file.media)}"></video>
        <span class="fx-file__play" aria-hidden="true">▶</span>
      </span>`;
  }
  if (file.kind === 'image' && file.media) {
    return `<span class="fx-file__thumb">
        <img class="fx-thumb-media" src="${escapeHtml(file.media)}" alt="" loading="lazy" />
      </span>`;
  }
  return `<span class="fx-file__icon" aria-hidden="true">${TYPE_GLYPH[file.type] || '🗎'}</span>`;
}

// Touch capability OR a small viewport both count as "tap to open".
const isTapToOpen = () => (
  window.matchMedia('(max-width: 640px)').matches ||
  window.matchMedia('(hover: none) and (pointer: coarse)').matches
);
const canHoverScrub = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

function openViewer(slug) {
  const file = findFile(slug);
  if (!file) return;
  const hasMedia = !!file.media;
  wm.open({
    id: `files-view-${slug}`,
    title: file.name,
    icon: TYPE_GLYPH[file.type] || '🗔',
    width: hasMedia ? 480 : 360, height: hasMedia ? 440 : 380,
    className: 'app-files',
    render: (el) => {
      el.innerHTML = `
        <div class="fx-viewer">
          ${coverMarkup(file)}
          <h2 class="fx-viewer__title">${escapeHtml(file.title)}</h2>
          <p class="fx-viewer__meta">
            <span class="fx-tag">${escapeHtml(file.type)}</span>
            <span class="fx-tag">${escapeHtml(file.name)}</span>
          </p>
          <p class="fx-viewer__blurb">${escapeHtml(file.blurb)}</p>
          ${hasMedia ? '' : '<p class="fx-viewer__note">placeholder // real cut drops soon</p>'}
        </div>
      `;
      if (file.kind === 'video' && isTapToOpen()) {
        const vid = el.querySelector('video.fx-media');
        if (vid) vid.play().catch(() => { /* fall back to the play button */ });
      }
    },
  });
}

// ---- hover-scrub wiring ---------------------------------------------------
// On a fine pointer, hovering a video thumb seeks the preview as the cursor
// moves left-to-right across it (scrubbing frames). Leaving resets to poster.
function attachScrub(scrubEl) {
  const vid = scrubEl.querySelector('video.fx-thumb-media');
  if (!vid) return;
  let ready = false;
  let dur = 0;
  const ensureMeta = () => {
    if (ready) return;
    if (vid.readyState >= 1 && isFinite(vid.duration) && vid.duration > 0) {
      ready = true; dur = vid.duration;
    } else {
      vid.load();
    }
  };
  vid.addEventListener('loadedmetadata', () => { ready = true; dur = vid.duration; });

  scrubEl.addEventListener('pointerenter', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return; // mouse only
    ensureMeta();
    scrubEl.classList.add('is-scrubbing');
  });
  scrubEl.addEventListener('pointermove', (e) => {
    if (!ready || !dur) { ensureMeta(); return; }
    const rect = scrubEl.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    try { vid.currentTime = Math.min(dur - 0.05, pct * dur); } catch (_e) { /* not seekable yet */ }
  });
  scrubEl.addEventListener('pointerleave', () => {
    scrubEl.classList.remove('is-scrubbing');
    try { vid.currentTime = 0; } catch (_e) { /* ignore */ }
  });
}

// ---- main render ----------------------------------------------------------
function render(contentEl, handle) {
  let active = FOLDERS[0] ? FOLDERS[0].id : 'projects';
  let query = '';
  let searchAll = false;

  contentEl.innerHTML = `
    <div class="fx">
      <nav class="fx-tree" aria-label="folders">
        <p class="fx-tree__head">C:\\COZYFILES</p>
        <ul role="tablist"></ul>
      </nav>
      <section class="fx-main" aria-label="files">
        <div class="fx-search">
          <input class="fx-search__input" type="search" placeholder="search files..."
                 aria-label="search files" autocomplete="off" spellcheck="false" />
          <label class="fx-search__scope">
            <input type="checkbox" class="fx-search__all" /> all
          </label>
        </div>
        <div class="fx-statusbar"><span class="fx-statusbar__path"></span><span class="fx-statusbar__count"></span></div>
        <ul class="fx-grid" role="listbox" aria-label="file list"></ul>
        <div class="fx-actionbar">
          <button class="fx-act fx-act--del" type="button" disabled>delete</button>
          <span class="fx-actionbar__hint">select a file</span>
        </div>
      </section>
    </div>
  `;

  const treeUl = contentEl.querySelector('.fx-tree ul');
  const grid = contentEl.querySelector('.fx-grid');
  const pathEl = contentEl.querySelector('.fx-statusbar__path');
  const countEl = contentEl.querySelector('.fx-statusbar__count');
  const searchInput = contentEl.querySelector('.fx-search__input');
  const searchAllBox = contentEl.querySelector('.fx-search__all');
  const delBtn = contentEl.querySelector('.fx-act--del');
  const hintEl = contentEl.querySelector('.fx-actionbar__hint');

  let selectedSlug = null;
  const scrubbers = []; // for cleanup

  function paintTree() {
    treeUl.innerHTML = FOLDERS.map(f => `
      <li>
        <button class="fx-tree__item" type="button" role="tab"
                data-folder="${f.id}" aria-selected="${f.id === active}">
          <span class="fx-tree__glyph" aria-hidden="true">${f.glyph}</span>
          <span class="fx-tree__label">${escapeHtml(f.label)}</span>
          ${f.locked ? '<span class="fx-tree__lock" aria-hidden="true">🔒</span>' : ''}
        </button>
      </li>
    `).join('');
    treeUl.querySelectorAll('.fx-tree__item').forEach(btn => {
      btn.addEventListener('click', () => selectFolder(btn.dataset.folder));
    });
  }

  function setSelected(slug) {
    selectedSlug = slug;
    grid.querySelectorAll('.fx-file').forEach(li => {
      li.classList.toggle('is-selected', li.dataset.slug === slug);
    });
    const has = !!slug;
    delBtn.disabled = !has;
    if (has) {
      const f = findFile(slug);
      hintEl.textContent = f ? f.name : '';
    } else {
      hintEl.textContent = 'select a file';
    }
  }

  // Build the list of files to show for the current state (folder + search).
  function currentList() {
    const q = query.trim().toLowerCase();
    const matches = (f) =>
      !q || f.name.toLowerCase().includes(q) || (f.title || '').toLowerCase().includes(q);

    if (q && searchAll) {
      const out = [];
      FOLDERS.forEach(folder => {
        folderFiles(folder).forEach(f => { if (matches(f)) out.push({ file: f, folderId: folder.id }); });
      });
      return out;
    }
    const folder = FOLDERS.find(f => f.id === active);
    if (!folder) return [];
    return folderFiles(folder).filter(matches).map(f => ({ file: f, folderId: folder.id }));
  }

  function paintGrid() {
    // tear down old scrubbers
    scrubbers.length = 0;

    const folder = FOLDERS.find(f => f.id === active);
    const q = query.trim();
    const list = currentList();

    if (q && searchAll) {
      pathEl.textContent = `search: "${q}" // all folders`;
    } else if (q) {
      pathEl.textContent = `search: "${q}" // ${folder ? folder.label : ''}`;
    } else {
      pathEl.textContent = folder ? `C:\\COZYFILES\\${folder.label}` : 'C:\\COZYFILES';
    }
    const n = list.length;
    countEl.textContent = `${n} item${n === 1 ? '' : 's'}`;

    const draggable = !q; // only allow reorder in a plain (unfiltered) folder view
    grid.innerHTML = list.map(({ file, folderId }) => `
      <li class="fx-file${file.cryptic ? ' fx-file--cryptic' : ''}${file.hidden ? ' fx-file--hidden' : ''}"
          role="option" tabindex="0" data-slug="${escapeHtml(file.slug)}" data-folder="${escapeHtml(folderId)}"
          ${draggable ? 'draggable="true"' : ''}
          title="${escapeHtml(file.title)}">
        ${thumbMarkup(file)}
        <span class="fx-file__name">${escapeHtml(file.name)}</span>
      </li>
    `).join('');

    // wire hover-scrub on any video thumbs (fine pointer only)
    if (canHoverScrub()) {
      grid.querySelectorAll('.fx-file__thumb[data-scrub]').forEach(el => {
        attachScrub(el);
        scrubbers.push(el);
      });
    }

    // re-apply selection highlight if the selected file is still visible
    if (selectedSlug && !list.some(x => x.file.slug === selectedSlug)) {
      setSelected(null);
    } else {
      setSelected(selectedSlug);
    }

    if (draggable) enableDragReorder();
  }

  function selectFolder(folderId) {
    active = folderId;
    treeUl.querySelectorAll('.fx-tree__item').forEach(b =>
      b.setAttribute('aria-selected', String(b.dataset.folder === folderId)));
    // mark progress; if this newly unlocks the hidden file, repaint the tree
    const before = getProgress().unlocked;
    const p = markFolderOpened(folderId);
    paintGrid();
    if (!before && p.unlocked) {
      // a hidden file just became reachable - nudge the user toward it
      hintEl.textContent = 'something new appeared in SECRETS';
    }
  }

  // ---- delete -> recycle ----
  function deleteFile(slug) {
    const folderId = folderOfFile(slug);
    const file = findFile(slug);
    if (!file || !folderId) return;
    const bin = getRecycle();
    if (bin.some(r => r.slug === slug)) return;
    bin.push({ ...file, _folder: folderId, _ts: Date.now() });
    setRecycle(bin);
    // also drop it from saved order so it does not linger
    const all = lsRead(LS.order, {});
    if (all[folderId]) { all[folderId] = all[folderId].filter(s => s !== slug); lsWrite(LS.order, all); }
    setSelected(null);
    paintGrid();
  }

  delBtn.addEventListener('click', () => { if (selectedSlug) deleteFile(selectedSlug); });

  // ---- grid interactions ----
  grid.addEventListener('click', (e) => {
    const li = e.target.closest('.fx-file');
    if (!li) return;
    if (isTapToOpen()) { openViewer(li.dataset.slug); return; }
    setSelected(li.dataset.slug); // single click selects on desktop
  });
  grid.addEventListener('dblclick', (e) => {
    const li = e.target.closest('.fx-file');
    if (li) openViewer(li.dataset.slug);
  });
  grid.addEventListener('keydown', (e) => {
    const li = e.target.closest('.fx-file');
    if (!li) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openViewer(li.dataset.slug); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteFile(li.dataset.slug); }
  });

  // ---- drag-to-reorder (HTML5 DnD, fine pointer / desktop) ----
  let dragSlug = null;
  function enableDragReorder() {
    grid.querySelectorAll('.fx-file[draggable="true"]').forEach(li => {
      li.addEventListener('dragstart', (e) => {
        dragSlug = li.dataset.slug;
        li.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', dragSlug); } catch (_e) { /* ie */ }
      });
      li.addEventListener('dragend', () => {
        li.classList.remove('is-dragging');
        grid.querySelectorAll('.fx-file').forEach(x => x.classList.remove('is-drop-before', 'is-drop-after'));
        dragSlug = null;
      });
    });
  }

  grid.addEventListener('dragover', (e) => {
    if (!dragSlug) return;
    const li = e.target.closest('.fx-file');
    if (!li || li.dataset.slug === dragSlug) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = li.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    grid.querySelectorAll('.fx-file').forEach(x => x.classList.remove('is-drop-before', 'is-drop-after'));
    li.classList.add(after ? 'is-drop-after' : 'is-drop-before');
  });

  grid.addEventListener('drop', (e) => {
    if (!dragSlug) return;
    const li = e.target.closest('.fx-file');
    if (!li) return;
    e.preventDefault();
    const targetSlug = li.dataset.slug;
    if (targetSlug === dragSlug) return;

    // current visual order of slugs in this folder
    const slugs = [...grid.querySelectorAll('.fx-file')].map(x => x.dataset.slug);
    const from = slugs.indexOf(dragSlug);
    if (from === -1) return;
    slugs.splice(from, 1);
    let to = slugs.indexOf(targetSlug);
    const rect = li.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    if (after) to += 1;
    slugs.splice(to, 0, dragSlug);

    saveOrder(active, slugs);
    paintGrid();
  });

  // ---- search ----
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = searchInput.value; paintGrid(); }, 80);
  });
  searchAllBox.addEventListener('change', () => {
    searchAll = searchAllBox.checked;
    if (query.trim()) paintGrid();
  });

  // ---- live refresh when RECYCLE restores/empties (same tab + other tabs) ----
  const onRecycleChange = () => { paintGrid(); };
  window.addEventListener('cozyfiles:recycle', onRecycleChange);
  const onStorage = (e) => { if (e.key === LS.recycle) paintGrid(); };
  window.addEventListener('storage', onStorage);

  // ---- cleanup: stop preview videos + drop listeners when the window closes.
  // Guard so a re-render (e.g. after the JSON loads post-open) does not wrap
  // close twice and stack the cleanup.
  if (!handle._filesCloseWrapped) {
    handle._filesCloseWrapped = true;
    const origClose = handle.close;
    handle.close = () => {
      window.removeEventListener('cozyfiles:recycle', onRecycleChange);
      window.removeEventListener('storage', onStorage);
      const w = wm.get('files');
      const gridEl = w && w.contentEl && w.contentEl.querySelector('.fx-grid');
      if (gridEl) gridEl.querySelectorAll('video').forEach(v => { try { v.pause(); v.removeAttribute('src'); } catch (_e) {} });
      origClose();
    };
  }

  paintTree();
  selectFolder(active);
}

registerApp({
  id: 'files', name: 'FILES.EXE', icon: '📁', desktop: true,
  open: () => {
    const handle = wm.open({
      id: 'files', title: 'FILES.EXE', icon: '📁', width: 600, height: 460,
      className: 'app-files',
      render,
    });
    // If the JSON loads after first paint, re-render with the fresh data.
    if (!loaded) {
      loadPortfolio().then(() => {
        const w = wm.get('files');
        if (w && w.contentEl) render(w.contentEl, w);
      });
    }
    return handle;
  },
});

// kick off the fetch eagerly so the data is usually ready before first open
loadPortfolio();
