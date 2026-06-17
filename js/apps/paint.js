// paint.js - PAINT.EXE (tiny MS-Paint style canvas, on-aesthetic).
// Self-contained: strokes paint to a <canvas>, SAVE exports a PNG download AND
// stores the dataURL in a localStorage gallery rendered as clickable thumbs.
import { wm, onTap } from '../window-manager.js';
import { registerApp } from '../desktop.js';

const LS_GALLERY = 'cozyfiles.paint.gallery';
const LS_COLOR   = 'cozyfiles.paint.color';
const LS_SIZE    = 'cozyfiles.paint.size';
const GALLERY_CAP = 8;

// Palette built from the site tokens plus the usual paint staples. Token-backed
// swatches resolve to their CSS variable at render time; the rest are literal.
const SWATCHES = [
  { label: 'acid lime', token: '--accent',    value: '#b6ff3c' },
  { label: 'warm',      token: '--accent-2',  value: '#ff5e3a' },
  { label: 'crt green', token: '--crt-green', value: '#2bff8a' },
  { label: 'bone',      token: '--ink',       value: '#e8e6df' },
  { label: 'black',     value: '#0a0a0a' },
  { label: 'white',     value: '#ffffff' },
  { label: 'sky',       value: '#3aa0ff' },
  { label: 'magenta',   value: '#ff3ce0' },
  { label: 'gold',      value: '#ffd23c' },
  { label: 'violet',    value: '#9b6cff' },
];

const BRUSH_SIZES = [2, 6, 14, 28];
const PAPER = '#161616';   // canvas background (drawn so PNG is not transparent)

function readGallery() {
  try {
    const raw = localStorage.getItem(LS_GALLERY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function writeGallery(arr) {
  try { localStorage.setItem(LS_GALLERY, JSON.stringify(arr.slice(0, GALLERY_CAP))); }
  catch { /* quota or disabled storage: gallery just will not persist */ }
}

function render(el, win) {
  el.innerHTML = `
    <div class="paint">
      <div class="paint__toolbar">
        <div class="paint__tools" role="group" aria-label="tools">
          <button class="paint__tool is-active" data-tool="brush" type="button" title="brush" aria-label="brush">✎</button>
          <button class="paint__tool" data-tool="eraser" type="button" title="eraser" aria-label="eraser">▱</button>
          <button class="paint__tool" data-tool="fill" type="button" title="fill" aria-label="fill bucket">▣</button>
          <button class="paint__tool paint__tool--danger" data-act="clear" type="button" title="clear canvas" aria-label="clear canvas">✖</button>
        </div>
        <div class="paint__sizes" role="group" aria-label="brush size"></div>
        <button class="paint__save" data-act="save" type="button" title="save as PNG">SAVE</button>
      </div>

      <div class="paint__palette" role="group" aria-label="colors"></div>

      <div class="paint__stage">
        <canvas class="paint__canvas" aria-label="drawing canvas"></canvas>
      </div>

      <div class="paint__gallery" aria-label="saved paintings">
        <span class="paint__gallery-label">SAVED</span>
        <div class="paint__strip"></div>
      </div>
    </div>
  `;

  const stage    = el.querySelector('.paint__stage');
  const canvas   = el.querySelector('.paint__canvas');
  const ctx      = canvas.getContext('2d', { willReadFrequently: true });
  const toolBtns = [...el.querySelectorAll('.paint__tool[data-tool]')];
  const sizesEl  = el.querySelector('.paint__sizes');
  const paletteEl = el.querySelector('.paint__palette');
  const stripEl  = el.querySelector('.paint__strip');

  // Resolve token-backed swatches to their live computed value.
  const cs = getComputedStyle(el);
  const colors = SWATCHES.map(s => ({
    label: s.label,
    value: (s.token && cs.getPropertyValue(s.token).trim()) || s.value,
  }));

  // ---- state ------------------------------------------------------------
  let tool = 'brush';
  let color = localStorage.getItem(LS_COLOR) || colors[0].value;
  let size = Number(localStorage.getItem(LS_SIZE)) || BRUSH_SIZES[1];
  let drawing = false;
  let lastX = 0, lastY = 0;
  let activePointer = null;

  // Logical (CSS-pixel) dimensions; backing buffer is scaled by DPR so strokes
  // stay crisp on HiDPI displays and full-screen mobile sheets. We snapshot the
  // bitmap before a resize and repaint it after so art survives window resizing.
  let cw = 1, ch = 1;
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

  function paintPaper() {
    ctx.save();
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }

  function resizeCanvas() {
    const rect = stage.getBoundingClientRect();
    const newW = Math.max(1, Math.round(rect.width));
    const newH = Math.max(1, Math.round(rect.height));
    if (newW === cw && newH === ch && canvas.width) return;

    // Snapshot current art (if any) so a resize does not wipe the drawing.
    let snap = null;
    if (canvas.width && canvas.height) {
      snap = document.createElement('canvas');
      snap.width = canvas.width;
      snap.height = canvas.height;
      snap.getContext('2d').drawImage(canvas, 0, 0);
    }

    const ratio = dpr();
    cw = newW; ch = newH;
    canvas.width = Math.round(newW * ratio);
    canvas.height = Math.round(newH * ratio);
    canvas.style.width = newW + 'px';
    canvas.style.height = newH + 'px';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    paintPaper();
    if (snap) {
      // Re-stretch the prior bitmap into the new logical box.
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(snap, 0, 0, canvas.width, canvas.height);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.restore();
    }
  }

  // ---- drawing helpers --------------------------------------------------
  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (cw / rect.width),
      y: (e.clientY - rect.top) * (ch / rect.height),
    };
  }

  function strokeStyle() {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size;
    if (tool === 'eraser') {
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = size * 2;   // eraser reads a touch wider, like Paint
    } else {
      ctx.strokeStyle = color;
    }
  }

  function dot(x, y) {
    strokeStyle();
    ctx.beginPath();
    ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }

  // Smooth line between the last and current point (interpolation is implicit
  // in lineTo, and round caps keep fast moves from looking dashed).
  function segment(x0, y0, x1, y1) {
    strokeStyle();
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // ---- flood fill -------------------------------------------------------
  function hexToRGBA(hex) {
    let h = hex.trim();
    if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }

  function floodFill(sx, sy, fill) {
    const W = canvas.width, H = canvas.height;
    const ratio = dpr();
    const px = Math.floor(sx * ratio);
    const py = Math.floor(sy * ratio);
    if (px < 0 || py < 0 || px >= W || py >= H) return;

    const img = ctx.getImageData(0, 0, W, H);
    const data = img.data;
    const at = (x, y) => (y * W + x) * 4;
    const start = at(px, py);
    const tr = data[start], tg = data[start + 1], tb = data[start + 2], ta = data[start + 3];
    const [fr, fg, fb] = fill;
    // Already the fill color: nothing to do.
    if (tr === fr && tg === fg && tb === fb && ta === 255) return;

    const tol = 32;
    const match = (i) =>
      Math.abs(data[i] - tr) <= tol &&
      Math.abs(data[i + 1] - tg) <= tol &&
      Math.abs(data[i + 2] - tb) <= tol &&
      Math.abs(data[i + 3] - ta) <= tol;

    const stack = [px, py];
    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      let nx = x;
      // walk left to the span start
      while (nx >= 0 && match(at(nx, y))) nx--;
      nx++;
      let up = false, down = false;
      while (nx < W && match(at(nx, y))) {
        const i = at(nx, y);
        data[i] = fr; data[i + 1] = fg; data[i + 2] = fb; data[i + 3] = 255;
        if (y > 0 && match(at(nx, y - 1))) { if (!up) { stack.push(nx, y - 1); up = true; } }
        else up = false;
        if (y < H - 1 && match(at(nx, y + 1))) { if (!down) { stack.push(nx, y + 1); down = true; } }
        else down = false;
        nx++;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---- pointer wiring ---------------------------------------------------
  function onDown(e) {
    if (activePointer !== null) return;
    activePointer = e.pointerId;
    canvas.setPointerCapture?.(e.pointerId);
    const { x, y } = pointerPos(e);

    if (tool === 'fill') {
      floodFill(x, y, hexToRGBA(color));
      activePointer = null;
      return;
    }
    drawing = true;
    lastX = x; lastY = y;
    dot(x, y);            // a single tap still leaves a mark
    e.preventDefault();
  }

  function onMove(e) {
    if (!drawing || e.pointerId !== activePointer) return;
    // coalesced events give smoother lines on fast moves where supported
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (events.length ? events : [e])) {
      const { x, y } = pointerPos(ev);
      segment(lastX, lastY, x, y);
      lastX = x; lastY = y;
    }
    e.preventDefault();
  }

  function onUp(e) {
    if (e.pointerId !== activePointer) return;
    drawing = false;
    activePointer = null;
    try { canvas.releasePointerCapture?.(e.pointerId); } catch { /* not captured */ }
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onUp);
  // Block the page from scrolling/zooming while drawing on touch.
  canvas.style.touchAction = 'none';

  // ---- tool / size / palette UI ----------------------------------------
  function setTool(next) {
    tool = next;
    toolBtns.forEach(b => b.classList.toggle('is-active', b.dataset.tool === next));
  }
  toolBtns.forEach(b => onTap(b, () => setTool(b.dataset.tool)));

  BRUSH_SIZES.forEach(s => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'paint__size' + (s === size ? ' is-active' : '');
    b.dataset.size = String(s);
    b.title = `${s}px brush`;
    b.setAttribute('aria-label', `${s} pixel brush`);
    b.innerHTML = `<span class="paint__size-dot" style="width:${Math.min(s, 22)}px;height:${Math.min(s, 22)}px"></span>`;
    onTap(b, () => {
      size = s;
      localStorage.setItem(LS_SIZE, String(s));
      [...sizesEl.children].forEach(c => c.classList.toggle('is-active', c === b));
    });
    sizesEl.appendChild(b);
  });

  function setColor(value, btn) {
    color = value;
    localStorage.setItem(LS_COLOR, value);
    [...paletteEl.children].forEach(c => c.classList.toggle('is-active', c === btn));
    // Picking a color implies you want to draw with it.
    if (tool === 'eraser') setTool('brush');
  }
  colors.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'paint__swatch' + (c.value === color ? ' is-active' : '');
    b.style.setProperty('--sw', c.value);
    b.title = c.label;
    b.setAttribute('aria-label', c.label);
    onTap(b, () => setColor(c.value, b));
    paletteEl.appendChild(b);
  });

  // ---- clear ------------------------------------------------------------
  onTap(el.querySelector('[data-act="clear"]'), () => {
    paintPaper();
  });

  // ---- gallery ----------------------------------------------------------
  function loadDataURL(url) {
    const img = new Image();
    img.onload = () => {
      paintPaper();
      // Fit the saved image into the current logical canvas, preserving aspect.
      const scale = Math.min(cw / img.width, ch / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    };
    img.src = url;
  }

  function renderStrip() {
    const items = readGallery();
    stripEl.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('span');
      empty.className = 'paint__strip-empty';
      empty.textContent = 'no saves yet';
      stripEl.appendChild(empty);
      return;
    }
    items.forEach((url, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'paint__thumb';
      const img = document.createElement('img');
      img.src = url;
      img.alt = `saved painting ${i + 1}`;
      onTap(img, () => loadDataURL(url));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'paint__thumb-del';
      del.title = 'delete';
      del.setAttribute('aria-label', 'delete painting');
      del.textContent = '×';
      onTap(del, () => {
        const arr = readGallery();
        arr.splice(i, 1);
        writeGallery(arr);
        renderStrip();
      });
      wrap.appendChild(img);
      wrap.appendChild(del);
      stripEl.appendChild(wrap);
    });
  }

  // ---- save -------------------------------------------------------------
  onTap(el.querySelector('[data-act="save"]'), () => {
    let url;
    try { url = canvas.toDataURL('image/png'); }
    catch { return; }   // tainted canvas (should not happen, all draws are local)

    // 1) trigger a browser download
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `cozyfiles-paint-${stamp}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    // 2) store a thumbnail-friendly copy in the gallery (newest first, capped)
    const arr = readGallery();
    arr.unshift(url);
    writeGallery(arr);
    renderStrip();
  });

  // ---- resize observation ----------------------------------------------
  let ro = null;
  if (window.ResizeObserver) {
    ro = new ResizeObserver(() => resizeCanvas());
    ro.observe(stage);
  }
  const onWinResize = () => resizeCanvas();
  window.addEventListener('resize', onWinResize);
  window.addEventListener('orientationchange', onWinResize);

  // ---- cleanup on close -------------------------------------------------
  const origClose = win.close;
  win.close = () => {
    if (ro) { ro.disconnect(); ro = null; }
    window.removeEventListener('resize', onWinResize);
    window.removeEventListener('orientationchange', onWinResize);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('pointerleave', onUp);
    origClose();
  };

  // ---- init -------------------------------------------------------------
  resizeCanvas();   // sizes buffer + paints the paper background
  renderStrip();
}

registerApp({
  id: 'paint', name: 'PAINT.EXE', icon: '🎨', desktop: true,
  open: () => wm.open({
    id: 'paint', title: 'PAINT.EXE', icon: '🎨', width: 520, height: 460,
    className: 'app-paint',
    render,
  }),
});
