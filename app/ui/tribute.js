// Tribute page: icon portraits, in-game sound clips, click-to-load video embeds.
const ROOT = '../';
const fetchJSON = p => fetch(p).then(r => r.json());

async function main() {
  const [ui, samples, instruments] = await Promise.all(['ui', 'samples', 'instruments'].map(n => fetchJSON(`data/${n}.json`).catch(() => null)));

  // background tile from Spore's loading screens
  if (ui && ui.images && ui.images.loading_pattern)
    document.getElementById('backdrop').style.setProperty('--pattern', `url(${new URL(ROOT + ui.images.loading_pattern, location.href).href})`);

  // portrait orbs: anthem editor icons
  if (ui && ui.icons) {
    const hero = document.getElementById('hero-icon');
    if (ui.icons.instruments) hero.src = ROOT + ui.icons.instruments[6];
    document.querySelectorAll('.photo.icon').forEach(f => {
      const [kind, k] = f.dataset.icon.split(':');
      const src = ui.icons[kind] && ui.icons[kind][+k];
      if (src) f.querySelector('img').src = ROOT + src;
    });
  }

  // sound clips straight from the archive
  let current = null;
  const sampleUrl = btn => {
    if (!samples) return null;
    let id = btn.dataset.sample;
    if (btn.dataset.instrument && instruments) {
      const inst = Object.values(instruments).find(i => i.name === btn.dataset.instrument);
      if (inst) id = inst.zones[0].sample;
    }
    const s = samples[id];
    return s ? ROOT + s.url : null;
  };
  document.querySelectorAll('button.hear').forEach(btn => {
    const url = sampleUrl(btn);
    if (!url) { btn.disabled = true; btn.title = 'Sound not found in your Spore install'; return; }
    btn.addEventListener('click', () => {
      if (current && current.btn === btn) { current.audio.pause(); current.btn.classList.remove('playing'); current = null; return; }
      if (current) { current.audio.pause(); current.btn.classList.remove('playing'); }
      const audio = new Audio(url);
      audio.play();
      btn.classList.add('playing');
      audio.onended = () => { btn.classList.remove('playing'); if (current && current.audio === audio) current = null; };
      current = { audio, btn };
    });
  });

  // YouTube: show the thumbnail, load the player only on click
  document.querySelectorAll('.embed[data-youtube]').forEach(el => {
    const id = el.dataset.youtube;
    el.innerHTML = `<button class="yt" aria-label="Play video"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy"><span class="play">▶</span></button>`;
    el.querySelector('button').addEventListener('click', () => {
      el.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1" title="YouTube video" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
    });
  });
}
main();
