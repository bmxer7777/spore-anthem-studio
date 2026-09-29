// The anthem note editor inside the Music tab's melody box.
//
// Pieces taken from the game:
//   - each note is the game's note widget (layout f1839789): a 12x18 note glyph button
//     with normal / hover / checked art, tinted by code
//   - tint colours, pitch range (C-major rows, MIDI minPitch..maxPitch), max notes and
//     durations come from the tuning file "playercitymusic"
// Matched from in-game screenshots: notes are evenly spaced and centred, pitch moves a
// note up/down a few pixels per scale step, and each note sits in a translucent rounded
// box whose width shows its length; the selected note's box is outlined in white.
// Which duration gets which of the colours is our reading (short = orange, long = green).
export const DURATIONS = [0.25, 0.5, 1, 2, 4];

export class MelodyEditor {
  constructor(host, tuning, sprites, { onChange, onPreview, onPlay, onSelect }) {
    this.t = tuning; this.sprites = sprites;
    this.onChange = onChange; this.onPreview = onPreview; this.onPlay = onPlay; this.onSelect = onSelect;
    this.notes = [];
    this.selected = -1; this.active = -1; this.hover = -1;
    this.rows = [];
    for (let p = tuning.minPitch; p <= tuning.maxPitch; p++) if (tuning.scale.includes(((p - tuning.basePitch) % 12 + 12) % 12)) this.rows.push(p);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'melody-canvas';
    host.appendChild(this.canvas);
    this.host = host;
    this.tintCache = new Map();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    this.bind();
  }
  resize() {
    const r = this.host.getBoundingClientRect();
    const cssW = this.host.clientWidth || 190, cssH = this.host.clientHeight || 70;
    const dpr = Math.max(1, (r.width / cssW) * (window.devicePixelRatio || 1));
    this.W = cssW; this.H = cssH; this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr); this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px'; this.canvas.style.height = cssH + 'px';
    this.tintCache.clear();
    this.draw();
  }
  set(notes) { this.notes = notes.map(n => ({ ...n })); if (this.selected >= this.notes.length) this.selected = this.notes.length - 1; this.draw(); }
  setActive(i) { if (i !== this.active) { this.active = i; this.draw(); } }

  // ---- geometry
  get gw() { return this.sprites ? this.sprites.w : 12; }
  get gh() { return this.sprites ? this.sprites.h : 18; }
  get slot() { return Math.min(this.gw + 1, (this.W - 8) / Math.max(1, this.notes.length)); }
  get x0() { return (this.W - this.slot * this.notes.length) / 2; }
  rowStep() { return (this.H - this.gh - 10) / (this.rows.length - 1); }
  rowOf(pitch) { let k = this.rows.indexOf(pitch); if (k < 0) k = this.rows.reduce((b, p, i) => (Math.abs(p - pitch) < Math.abs(this.rows[b] - pitch) ? i : b), 0); return k; }
  glyphRect(i) {
    const n = this.notes[i];
    const x = this.x0 + i * this.slot;
    const y = 5 + (this.rows.length - 1 - this.rowOf(n.pitch)) * this.rowStep();
    return { x, y, w: this.gw, h: this.gh };
  }
  boxRect(i) {
    const g = this.glyphRect(i);
    const w = Math.max(this.gw + 4, this.slot * this.notes[i].duration * 1.5 + 4);
    return { x: g.x - 2, y: g.y - 2, w, h: this.gh + 4 };
  }
  hit(px, py) {
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const r = this.glyphRect(i);
      if (px >= r.x - 1 && px <= r.x + r.w + 1 && py >= r.y - 2 && py <= r.y + r.h + 2) return i;
    }
    return -1;
  }
  local(ev) {
    const r = this.canvas.getBoundingClientRect();
    return [(ev.clientX - r.left) * this.W / r.width, (ev.clientY - r.top) * this.H / r.height];
  }

  // ---- input
  bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', ev => {
      ev.stopPropagation();
      const [x, y] = this.local(ev);
      const i = this.hit(x, y);
      if (i < 0) { this.selected = -1; this.draw(); this.onSelect && this.onSelect(-1); this.onPlay && this.onPlay(); return; }
      this.selected = i; this.onSelect && this.onSelect(i);
      this.drag = { i, y0: y, row0: this.rowOf(this.notes[i].pitch), moved: false };
      c.setPointerCapture(ev.pointerId);
      this.onPreview && this.onPreview(i);
      this.draw();
    });
    c.addEventListener('pointermove', ev => {
      const [x, y] = this.local(ev);
      if (!this.drag) {
        const h = this.hit(x, y);
        if (h !== this.hover) { this.hover = h; this.draw(); }
        c.style.cursor = h >= 0 ? 'ns-resize' : 'pointer';
        return;
      }
      const dRow = Math.round((this.drag.y0 - y) / this.rowStep());
      const row = Math.max(0, Math.min(this.rows.length - 1, this.drag.row0 + dRow));
      const p = this.rows[row];
      if (p !== this.notes[this.drag.i].pitch) {
        this.notes[this.drag.i].pitch = p;
        this.drag.moved = true;
        this.draw();
        this.onChange && this.onChange(this.notes, 'drag');
        this.onPreview && this.onPreview(this.drag.i);
      }
    });
    c.addEventListener('pointerleave', () => { if (this.hover !== -1) { this.hover = -1; this.draw(); } });
    const end = () => { if (this.drag && this.drag.moved) this.onChange && this.onChange(this.notes, 'commit'); this.drag = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('click', ev => ev.stopPropagation());
    c.addEventListener('wheel', ev => {
      const [x, y] = this.local(ev);
      const i = this.hit(x, y);
      if (i < 0) return;
      ev.preventDefault();
      const k = DURATIONS.indexOf(this.notes[i].duration);
      const nk = Math.max(0, Math.min(DURATIONS.length - 1, (k < 0 ? 2 : k) + (ev.deltaY < 0 ? 1 : -1)));
      if (DURATIONS[nk] !== this.notes[i].duration) {
        this.notes[i].duration = DURATIONS[nk];
        this.selected = i;
        this.draw();
        this.onChange && this.onChange(this.notes, 'commit');
      }
    }, { passive: false });
  }

  // ---- drawing
  color(i) {
    const c = this.t.colors;
    if (i === this.active) return c.c;               // yellow: playing
    return this.notes[i].duration >= 1 ? c.a : c.b;  // green: long, orange: short
  }
  tinted(img, color) {
    const key = (img && img.src.length) + color;
    if (this.tintCache.has(key)) return this.tintCache.get(key);
    const cv = document.createElement('canvas');
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = color; g.fillRect(0, 0, cv.width, cv.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img, 0, 0);
    this.tintCache.set(key, cv);
    return cv;
  }
  draw() {
    const g = this.canvas.getContext('2d');
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    // duration boxes first (translucent), then glyphs on top
    this.notes.forEach((n, i) => {
      const b = this.boxRect(i);
      const sel = i === this.selected;
      g.fillStyle = sel ? 'rgba(255, 110, 60, 0.30)' : 'rgba(190, 210, 255, 0.07)';
      g.strokeStyle = sel ? 'rgba(255, 255, 255, 0.95)' : 'rgba(190, 210, 255, 0.22)';
      g.lineWidth = sel ? 1.5 : 1;
      roundRect(g, b.x + 0.5, b.y + 0.5, b.w, b.h, 4); g.fill(); g.stroke();
    });
    const sp = this.sprites;
    this.notes.forEach((n, i) => {
      const r = this.glyphRect(i);
      if (sp && sp.normal) {
        const sel = i === this.selected, hov = i === this.hover;
        const img = sel ? (hov ? sp.checkedHover : sp.checked) : (hov ? sp.hover : sp.normal);
        g.drawImage(this.tinted(img || sp.normal, this.color(i)), r.x, r.y, r.w, r.h);
      } else {
        g.fillStyle = this.color(i);
        g.fillRect(r.x + 3, r.y + 12, 6, 5);
      }
    });
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
  g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
  g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath();
}
