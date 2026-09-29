// Renders a decoded Spore .spui layout (see tools/spore/spui.py) as DOM.
// Geometry, anchoring, 8-state button images, 9-slice scaling, text, sliders and
// tooltips follow the layout data. Images are cut from the original texture sheets by
// UV, so upscaled sheets (upscale/ui/sheets/) drop in without changes.

const STATE = { normal: 0, disabled: 1, hover: 2, active: 3, checked: 4, checkedDisabled: 5, checkedHover: 6, checkedActive: 7 };

export class SheetStore {
  constructor(ui, root) { this.ui = ui; this.root = root; this.images = new Map(); this.crops = new Map(); }
  async load() {
    await Promise.all(Object.entries(this.ui.sheets).map(async ([inst, s]) => {
      const img = await loadImage(this.root + (s.override || s.url));
      this.images.set(inst, { img, baseW: s.size[0], baseH: s.size[1] });
    }));
  }
  // Crop a sprite by UV into a data URL (cached). Works at any sheet resolution.
  crop(inst, uv) {
    const key = inst + ':' + uv.join(',');
    if (this.crops.has(key)) return this.crops.get(key);
    const s = this.images.get(inst);
    if (!s) return null;
    const W = s.img.naturalWidth, H = s.img.naturalHeight;
    const x1 = Math.max(0, Math.round(uv[0] * W)), y1 = Math.max(0, Math.round(uv[1] * H));
    const x2 = Math.min(W, Math.round(uv[2] * W)), y2 = Math.min(H, Math.round(uv[3] * H));
    const w = Math.max(1, x2 - x1), h = Math.max(1, y2 - y1);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(s.img, x1, y1, w, h, 0, 0, w, h);
    const out = { url: c.toDataURL(), w, h, scale: W / s.baseW };
    this.crops.set(key, out);
    return out;
  }
}

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

export class SpuiLayout {
  constructor(data, { sheets, text, onTooltip }) {
    this.d = data; this.sheets = sheets; this.text = text; this.onTooltip = onTooltip;
    this.base = data.reference_base;
    this.byControl = new Map();   // ControlID -> [widget]
    this.widgets = [];
  }
  el(i) { return i >= this.base ? this.d.elements[i - this.base] : null; }
  v(e, k) { const p = e.props[k]; return p && p.value !== undefined ? p.value : p; }
  str(ref) {
    if (!ref) return '';
    const r = Array.isArray(ref) ? ref[0] : ref;
    if (!r) return '';
    if (r.text !== undefined) return r.text;
    return this.text(r.table, r.id);
  }

  // Resolve an image reference (Image Atlas element) to a crop.
  image(ref) {
    if (ref === undefined || ref === null || ref < 0) return null;
    const e = this.el(ref);
    if (!e || e.class !== 'Image Atlas') return null;
    const ai = this.v(e, 'Atlas')[0];
    const inst = this.d.atlases[ai] && this.d.atlases[ai].instance;
    const crop = this.sheets.crop(inst, this.v(e, 'UV Coordinates')[0]);
    if (crop) crop.dims = this.v(e, 'Dimensions')?.[0];
    return crop;
  }
  drawable(ref) {
    const e = this.el(ref);
    if (!e) return null;
    if (e.class === 'StdDrawable' || e.class === 'ImageDrawable') {
      const imgs = (this.v(e, 'Image') || []).map(r => this.image(r));
      const sa = this.v(e, 'ScaleArea');
      const border = sa && sa[0] ? [1, 2, 3, 4].map(k => (sa[0]['0x0000000' + k] || { value: [0.333] }).value[0]) : null;
      return { kind: 'std', imgs, scaleType: (this.v(e, 'ScaleType') || ['Stretch Image'])[0], border };
    }
    if (e.class === 'FrameDrawable') return { kind: 'frame' };
    if (e.class === 'SliderDrawable') return { kind: 'slider', imgs: (this.v(e, 'Images') || []).map(r => this.image(r)) };
    return null;
  }

  applyImage(node, dr, state) {
    if (!dr || dr.kind !== 'std') return;
    let img = dr.imgs[state] || null;
    if (!img && state >= 4) img = dr.imgs[state - 4] || dr.imgs[4];
    if (!img) img = dr.imgs[0];
    if (!img) { node.style.backgroundImage = ''; node.style.borderImage = ''; return; }
    if (dr.scaleType === 'Stretch Center' && dr.border) {
      // 9-slice on its own layer so the border widths don't offset child windows
      let bg = node.querySelector(':scope > .bg9');
      if (!bg) { bg = document.createElement('div'); bg.className = 'bg9'; node.prepend(bg); }
      const [l, t, r, b] = dr.border;
      const px = (f, n) => Math.round(f * n);
      const cw = img.w / img.scale, ch = img.h / img.scale;
      const W = parseFloat(node.style.width) || cw, H = parseFloat(node.style.height) || ch;
      // the fixed edges can never be larger than the window itself
      const k = Math.min(1, W / Math.max(1, px(l, cw) + px(r, cw)), H / Math.max(1, px(t, ch) + px(b, ch)));
      bg.style.borderWidth = `${px(t, ch) * k}px ${px(r, cw) * k}px ${px(b, ch) * k}px ${px(l, cw) * k}px`;
      bg.style.borderImage = `url(${img.url}) ${px(t, img.h)} ${px(r, img.w)} ${px(b, img.h)} ${px(l, img.w)} fill stretch`;
      node.style.backgroundImage = '';
    } else if (dr.scaleType === 'Tile Image') {
      node.style.backgroundImage = `url(${img.url})`;
      node.style.backgroundSize = `${img.w / img.scale}px ${img.h / img.scale}px`;
      node.style.backgroundRepeat = 'repeat';
    } else {
      node.style.backgroundImage = `url(${img.url})`;
      node.style.backgroundSize = '100% 100%';
      node.style.backgroundRepeat = 'no-repeat';
    }
  }

  // SimpleLayout anchoring (SporeModder FX SimpleLayout.applyLayout).
  rect(e, pw, ph) {
    let [x1, y1, x2, y2] = this.v(e, 'Area')[0];
    for (const wp of this.v(e, 'WinProcs') || []) {
      const p = this.el(wp);
      if (!p || p.class !== 'SimpleLayout') continue;
      const a = this.v(p, 'Anchor')[0];
      if (a & 8) { x2 += pw; if (!(a & 4)) x1 += pw; }
      if (a & 2) { y2 += ph; if (!(a & 1)) y1 += ph; }
    }
    return [x1, y1, x2, y2];
  }

  // rootIndex: element index (as printed by tools/spui_tree.py), not a reference index
  render(rootIndex, parentNode, pw, ph) {
    const e = this.d.elements[rootIndex];
    const w = this.build(e, parentNode, pw, ph);
    w.node.style.display = '';   // the game shows its root windows with a Glide/Fade effect
    w.node.style.opacity = '';
    return w;
  }

  build(e, parent, pw, ph) {
    const [x1, y1, x2, y2] = this.rect(e, pw, ph);
    const w = x2 - x1, h = y2 - y1;
    const node = document.createElement('div');
    node.className = 'spui ' + e.class.replace(/\s+/g, '-');
    Object.assign(node.style, { left: x1 + 'px', top: y1 + 'px', width: w + 'px', height: h + 'px' });
    const flags = (this.v(e, 'WindowFlags') || [3])[0];
    if (!(flags & 1)) node.style.display = 'none';
    const cid = (this.v(e, 'ControlID') || [0])[0] >>> 0;
    node.dataset.cid = cid.toString(16);
    node.dataset.index = e.index;
    const shade = (this.v(e, 'ShadeColor') || [0xffffffff])[0] >>> 0;
    const widget = { e, node, cid, w, h, state: 0, checked: false, enabled: true, layout: this };

    // Fill (windows, text)
    const fill = this.v(e, 'FillDrawable');
    if (fill && fill[0] >= 0) { widget.fill = this.drawable(fill[0]); this.applyImage(node, widget.fill, 0); }
    // ShadeColor alpha is the starting point of the game's fade/modulate animations,
    // so it is not applied as a static opacity.

    if (e.class === 'Button') this.makeButton(widget);
    else if (e.class === 'Slider') this.makeSlider(widget);
    else if (e.class === 'Text' || e.class === 'Outlined Text') this.makeText(widget);
    else if (e.class === 'TextEdit') this.makeTextEdit(widget);
    else if (e.class === 'Animated Icon') this.makeAnimIcon(widget);

    // Tooltip
    for (const wp of this.v(e, 'WinProcs') || []) {
      const p = this.el(wp);
      if (p && p.class === 'Tooltip') {
        const tip = this.str(this.v(p, 'Tooltip string'));
        if (tip) {
          node.addEventListener('mouseenter', ev => this.onTooltip && this.onTooltip(tip, node, true));
          node.addEventListener('mouseleave', ev => this.onTooltip && this.onTooltip(tip, node, false));
        }
      }
    }

    parent.appendChild(node);
    this.widgets.push(widget);
    if (!this.byControl.has(cid)) this.byControl.set(cid, []);
    this.byControl.get(cid).push(widget);
    // Spore draws the first child on top: build in reverse so DOM order matches.
    for (const c of [...(this.v(e, 'Children') || [])].reverse()) {
      const ce = this.el(c);
      if (ce) this.build(ce, node, w, h);
    }
    return widget;
  }

  makeButton(wd) {
    const { e, node } = wd;
    wd.type = (this.v(e, 'ButtonType') || ['Standard'])[0];
    wd.group = (this.v(e, 'ButtonGroupID') || [0])[0];
    const dr = this.v(e, 'ButtonDrawable');
    wd.draw = dr && dr[0] >= 0 ? this.drawable(dr[0]) : null;
    if (wd.draw && wd.draw.kind === 'frame') node.classList.add('frame');
    const cap = this.str(this.v(e, 'Caption'));
    if (cap) { const s = document.createElement('span'); s.className = 'caption'; s.textContent = cap; node.appendChild(s); }
    const upd = () => {
      let st = !wd.enabled ? 1 : wd.pressed ? 3 : wd.hover ? 2 : 0;
      if (wd.checked) st += 4;
      this.applyImage(node, wd.draw, st);
      node.classList.toggle('checked', wd.checked);
    };
    wd.update = upd;
    node.addEventListener('mouseenter', () => { wd.hover = true; upd(); });
    node.addEventListener('mouseleave', () => { wd.hover = false; wd.pressed = false; upd(); });
    node.addEventListener('mousedown', ev => { if (ev.button === 0) { wd.pressed = true; upd(); } });
    node.addEventListener('mouseup', () => { wd.pressed = false; upd(); });
    node.addEventListener('click', ev => {
      if (!wd.enabled) return;
      if (wd.type === 'Toggle') wd.checked = !wd.checked;
      else if (wd.type === 'Radio') wd.checked = true;
      upd();
      if (wd.onClick) wd.onClick(ev, wd);
    });
    upd();
  }

  makeSlider(wd) {
    const { e, node } = wd;
    const dr = this.drawable(this.v(e, 'SliderDrawable')[0]);
    wd.min = this.v(e, 'MinValue')[0]; wd.max = this.v(e, 'MaxValue')[0]; wd.value = this.v(e, 'Value')[0];
    const track = document.createElement('div'); track.className = 'track';
    const thumb = document.createElement('div'); thumb.className = 'thumb';
    if (dr) {
      if (dr.imgs[2]) Object.assign(track.style, { backgroundImage: `url(${dr.imgs[2].url})`, backgroundSize: '100% 100%' });
      if (dr.imgs[1]) {
        // The thumb art is a horizontal strip of states (normal, hover, pressed, disabled).
        const t = dr.imgs[1];
        const tw = t.dims ? t.dims[0] : t.w / t.scale, th = t.dims ? t.dims[1] : t.h / t.scale;
        const frames = tw / th >= 3.5 ? 4 : 1;
        wd.thumbFrames = frames;
        Object.assign(thumb.style, { backgroundImage: `url(${t.url})`, width: (tw / frames) + 'px', height: th + 'px',
          backgroundSize: `${frames * 100}% 100%`, backgroundPosition: '0 0' });
        const st = k => { if (frames > 1) thumb.style.backgroundPosition = `${(k / (frames - 1)) * 100}% 0`; };
        node.addEventListener('mouseenter', () => st(1));
        node.addEventListener('mouseleave', () => st(0));
        node.addEventListener('pointerdown', () => st(2));
        node.addEventListener('pointerup', () => st(1));
      }
    }
    node.appendChild(track); node.appendChild(thumb);
    const place = () => {
      const tw = parseFloat(thumb.style.width) || 8;
      const f = (wd.value - wd.min) / (wd.max - wd.min || 1);
      thumb.style.left = (f * (wd.w - tw)) + 'px';
      thumb.style.top = ((wd.h - (parseFloat(thumb.style.height) || wd.h)) / 2) + 'px';
    };
    wd.set = v => { wd.value = Math.max(wd.min, Math.min(wd.max, Math.round(v))); place(); };
    const drag = ev => {
      const r = node.getBoundingClientRect();
      const tw = (parseFloat(thumb.style.width) || 8) * (r.width / wd.w);
      const f = (ev.clientX - r.left - tw / 2) / (r.width - tw);
      wd.set(wd.min + f * (wd.max - wd.min));
      if (wd.onChange) wd.onChange(wd.value);
    };
    node.addEventListener('pointerdown', ev => { node.setPointerCapture(ev.pointerId); drag(ev); node.onpointermove = drag; });
    node.addEventListener('pointerup', () => { node.onpointermove = null; });
    place();
  }

  makeText(wd) {
    const { e, node } = wd;
    const cap = this.str(this.v(e, 'Caption'));
    const s = document.createElement('span'); s.className = 'caption'; s.textContent = cap;
    const tb = this.v(e, 'TextBorder');
    if (tb && tb[0]) s.style.paddingLeft = ((tb[0]['0x00000001'] || { value: [0] }).value[0]) + 'px';
    const col = (this.v(e, 'TextColor') || [0xff000000])[0] >>> 0;
    s.style.color = '#' + (col & 0xffffff).toString(16).padStart(6, '0');
    const outline = this.v(e, 'Text Outline');
    if (outline && outline[0] && outline[0].Size && outline[0].Size.value[0] !== 'User Defined') s.classList.add('outlined');
    node.appendChild(s);
  }

  makeTextEdit(wd) {
    const inp = document.createElement(wd.h > 40 ? 'textarea' : 'input');
    inp.className = 'textedit';
    inp.placeholder = this.str(this.v(wd.e, 'Caption'));
    wd.node.appendChild(inp);
    wd.input = inp;
  }

  makeAnimIcon(wd) {
    const anim = this.v(wd.e, 'Animation');
    const img = anim ? this.image(anim[0]) : null;
    const fw = (this.v(wd.e, 'Frame Width') || [36])[0];
    if (img) {
      const frames = Math.max(1, Math.round((img.dims ? img.dims[0] : img.w / img.scale) / fw));
      wd.frames = frames;
      wd.node.style.backgroundImage = `url(${img.url})`;
      wd.node.style.backgroundSize = `${frames * 100}% 100%`;
      wd.setFrame = k => { wd.node.style.backgroundPosition = `${(Math.max(0, Math.min(frames - 1, k)) / Math.max(1, frames - 1)) * 100}% 0`; };
      wd.setFrame(0);
    }
  }

  find(cid) { return this.byControl.get(cid >>> 0) || []; }
  byIndex(i) { return this.widgets.find(w => w.e.index === i); }
}
