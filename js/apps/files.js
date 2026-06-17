// files.js - FILES.EXE (file-explorer portfolio, the centerpiece app).
import { wm } from '../window-manager.js';
import { registerApp } from '../desktop.js';

// Placeholder portfolio content. Swap these out for real work later.
// Each "file" has: slug, name (filename), title, type (extension), accent
// (which palette token tints the cover), and a short cryptic blurb.
const FOLDERS = [
  {
    id: 'projects',
    label: 'PROJECTS',
    glyph: '📂',
    files: [
      {
        slug: 'chase-atlantic-fillmore', name: 'CHASE_ATLANTIC_FILLMORE.mp4', title: 'Chase Atlantic // Fillmore',
        type: '.mp4', accent: 'accent', kind: 'video',
        media: 'assets/media/chase-atlantic-fillmore.mp4', poster: 'assets/media/chase-atlantic-fillmore.jpg',
        blurb: 'Recap cut from the Fillmore Minneapolis show.',
      },
      {
        slug: 'tiesto', name: 'TIESTO.mp4', title: 'Tiesto',
        type: '.mp4', accent: 'accent-2', kind: 'video',
        media: 'assets/media/tiesto.mp4', poster: 'assets/media/tiesto.jpg',
        blurb: 'Live visual recap.',
      },
      {
        slug: 'cozyfiles-live', name: 'COZYFILES_LIVE.jpg', title: 'Cozyfiles // Live',
        type: '.jpg', accent: 'crt-green', kind: 'image',
        media: 'assets/media/cozyfiles-live.jpg',
        blurb: 'Still from the floor.',
      },
      {
        slug: 'ghost-grid', name: 'GHOST_GRID.jpg', title: 'Ghost Grid',
        type: '.jpg', accent: 'accent',
        blurb: 'A typeface drawn entirely from the gaps between billboards.',
      },
      {
        slug: 'paper-saints', name: 'PAPER_SAINTS.mov', title: 'Paper Saints',
        type: '.mov', accent: 'accent-2',
        blurb: 'Stop-motion saints folded from receipts. They blink when you leave the room.',
      },
      {
        slug: 'velvet-error', name: 'VELVET_ERROR.psd', title: 'Velvet Error',
        type: '.psd', accent: 'crt-green',
        blurb: 'A poster series for a band that has never agreed to exist.',
      },
    ],
  },
  {
    id: 'archive',
    label: 'ARCHIVE',
    glyph: '🗃️',
    files: [
      {
        slug: 'dial-tone-89', name: 'DIAL_TONE_89.jpg', title: 'Dial Tone 89',
        type: '.jpg', accent: 'accent',
        blurb: 'Our first job. Everyone who saw it has since changed their number.',
      },
      {
        slug: 'concrete-lullaby', name: 'CONCRETE_LULLABY.mov', title: 'Concrete Lullaby',
        type: '.mov', accent: 'accent-2',
        blurb: 'Shelved campaign for a city that was repaved before it shipped.',
      },
      {
        slug: 'untitled-final-2', name: 'UNTITLED_FINAL_v2.psd', title: 'Untitled (final) (2)',
        type: '.psd', accent: 'crt-green',
        blurb: 'We swear this was the last revision. It was not.',
      },
    ],
  },
  {
    id: 'secrets',
    label: 'SECRETS',
    glyph: '🔒',
    locked: true,
    files: [
      {
        slug: 'do-not-open', name: 'DO_NOT_OPEN.bin', title: 'do_not_open',
        type: '.bin', accent: 'accent-2', cryptic: true,
        blurb: 'You opened it. Of course you did. There is nothing here yet. Keep watching.',
      },
      {
        slug: 'readme-soon', name: 'README_SOON.txt', title: 'readme_soon',
        type: '.txt', accent: 'accent', cryptic: true,
        blurb: 'Three more files are coming. We have not made them yet. Neither have you.',
      },
    ],
  },
];

const TYPE_GLYPH = {
  '.mov': '🎞️', '.mp4': '🎬', '.mp3': '🎵', '.jpg': '🖼️',
  '.psd': '🎨', '.txt': '📄', '.bin': '⬛',
};

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

function findFile(slug) {
  for (const folder of FOLDERS) {
    const f = folder.files.find(x => x.slug === slug);
    if (f) return f;
  }
  return null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

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
    },
  });
}

function render(contentEl) {
  let active = FOLDERS[0].id;

  const treeHtml = FOLDERS.map(f => `
    <li>
      <button class="fx-tree__item" type="button" role="tab"
              data-folder="${f.id}" aria-selected="${f.id === active}">
        <span class="fx-tree__glyph" aria-hidden="true">${f.glyph}</span>
        <span class="fx-tree__label">${escapeHtml(f.label)}</span>
        ${f.locked ? '<span class="fx-tree__lock" aria-hidden="true">🔒</span>' : ''}
      </button>
    </li>
  `).join('');

  contentEl.innerHTML = `
    <div class="fx">
      <nav class="fx-tree" aria-label="folders">
        <p class="fx-tree__head">C:\\COZYFILES</p>
        <ul role="tablist">${treeHtml}</ul>
      </nav>
      <section class="fx-main" aria-label="files">
        <div class="fx-statusbar"><span class="fx-statusbar__path"></span><span class="fx-statusbar__count"></span></div>
        <ul class="fx-grid" role="listbox" aria-label="file list"></ul>
      </section>
    </div>
  `;

  const treeItems = [...contentEl.querySelectorAll('.fx-tree__item')];
  const grid = contentEl.querySelector('.fx-grid');
  const pathEl = contentEl.querySelector('.fx-statusbar__path');
  const countEl = contentEl.querySelector('.fx-statusbar__count');

  function paintGrid(folderId) {
    const folder = FOLDERS.find(f => f.id === folderId);
    if (!folder) return;
    pathEl.textContent = `C:\\COZYFILES\\${folder.label}`;
    const n = folder.files.length;
    countEl.textContent = `${n} item${n === 1 ? '' : 's'}`;

    grid.innerHTML = folder.files.map(file => `
      <li class="fx-file${file.cryptic ? ' fx-file--cryptic' : ''}"
          role="option" tabindex="0" data-slug="${file.slug}"
          title="${escapeHtml(file.title)}">
        <span class="fx-file__icon" aria-hidden="true">${TYPE_GLYPH[file.type] || '🗎'}</span>
        <span class="fx-file__name">${escapeHtml(file.name)}</span>
      </li>
    `).join('');
  }

  function selectFolder(folderId) {
    active = folderId;
    treeItems.forEach(b => b.setAttribute('aria-selected', String(b.dataset.folder === folderId)));
    paintGrid(folderId);
  }

  treeItems.forEach(btn => {
    btn.addEventListener('click', () => selectFolder(btn.dataset.folder));
  });

  // delegated open: double-click (desktop) or single tap (touch/small-screen),
  // plus keyboard. Touch capability OR a small viewport both count as "tap to open"
  // so phones and touch tablets get a single-tap target.
  const isTapToOpen = () => (
    window.matchMedia('(max-width: 640px)').matches ||
    window.matchMedia('(hover: none) and (pointer: coarse)').matches
  );
  grid.addEventListener('dblclick', (e) => {
    const li = e.target.closest('.fx-file');
    if (li) openViewer(li.dataset.slug);
  });
  grid.addEventListener('click', (e) => {
    const li = e.target.closest('.fx-file');
    if (li && isTapToOpen()) openViewer(li.dataset.slug);
  });
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const li = e.target.closest('.fx-file');
    if (li) { e.preventDefault(); openViewer(li.dataset.slug); }
  });

  selectFolder(active);
}

registerApp({
  id: 'files', name: 'FILES.EXE', icon: '📁', desktop: true,
  open: () => wm.open({
    id: 'files', title: 'FILES.EXE', icon: '📁', width: 600, height: 420,
    className: 'app-files',
    render,
  }),
});
