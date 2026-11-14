// The jukebox's selector panel and the small music chip in the HUD.

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

export class JukeboxPanel {
  constructor(audio) {
    this.audio = audio;
    this.onClose = null;

    const root = this.root = el('aside', 'jukebox');
    root.id = 'jukebox';
    root.setAttribute('aria-hidden', 'true');
    root.inert = true;
    const card = el('div', 'jb-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Jukebox');

    const close = el('button', 'panel-close', '✕');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.onClose?.());

    this.now = el('h2', 'jb-now');
    this.status = el('p', 'jb-status');

    const transport = el('div', 'jb-row');
    const prev = el('button', 'btn btn-ghost', 'Previous');
    this.playBtn = el('button', 'btn btn-primary', 'Play');
    const next = el('button', 'btn btn-ghost', 'Next');
    prev.addEventListener('click', () => audio.next(-1));
    next.addEventListener('click', () => audio.next(1));
    this.playBtn.addEventListener('click', () => audio.toggle());
    transport.append(prev, this.playBtn, next);

    const volRow = el('label', 'jb-volume');
    volRow.append(el('span', 'label', 'Volume'));
    this.vol = el('input');
    this.vol.type = 'range'; this.vol.min = '0'; this.vol.max = '100'; this.vol.step = '1';
    this.vol.addEventListener('input', () => audio.setVolume(this.vol.value / 100));
    volRow.append(this.vol);

    const orderRow = el('div', 'jb-row jb-order');
    this.orderBtns = [['playlist', 'In order'], ['shuffle', 'Shuffle'], ['loop', 'Repeat one']].map(([key, label]) => {
      const b = el('button', 'btn btn-ghost', label);
      b.addEventListener('click', () => audio.setOrder(key));
      b.dataset.order = key;
      orderRow.append(b);
      return b;
    });

    this.list = el('ul', 'jb-list');

    const add = el('div', 'jb-add');
    add.append(el('p', 'label', 'Add a link'));
    const form = el('form', 'jb-link');
    this.url = el('input');
    this.url.type = 'url'; this.url.placeholder = 'https://…  link to an audio file or stream';
    this.url.setAttribute('aria-label', 'Link to an audio file or stream');
    const addLink = el('button', 'btn btn-ghost', 'Add link');
    addLink.type = 'submit';
    form.append(this.url, addLink);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.url.value.trim()) return;
      if (audio.addLink(this.url.value)) this.url.value = '';
      else this.status.textContent = 'That does not look like a link to an audio file.';
    });
    add.append(form, el('p', 'fineprint jb-note', 'Links are remembered on this device.'));

    card.append(close, el('p', 'kicker', 'Jukebox'), this.now, this.status, transport, volRow, orderRow, this.list, add);
    root.append(card);
    root.addEventListener('pointerdown', (e) => { if (e.target === root) this.onClose?.(); });
    document.body.append(root);

    // music chip: what is playing, click to mute
    this.chip = el('button', 'music-chip');
    this.chip.id = 'music-chip';
    this.chip.addEventListener('click', () => this.toggleSound());
    document.getElementById('hud').append(this.chip);

    audio.addEventListener('change', () => this.render());
    this.render();
  }

  get isOpen() { return this.root.classList.contains('is-open'); }

  /** The J key and the chip: silence or restore the music without losing your place. */
  toggleSound() {
    const a = this.audio;
    if (!a.tracks.length) return;
    if (!a.playing) a.play(); else a.setMuted(!a.muted);
  }

  open(onClose) {
    this.onClose = onClose;
    this.root.classList.add('is-open');
    this.root.setAttribute('aria-hidden', 'false');
    this.root.inert = false;
    this.render();
    this.playBtn.focus({ preventScroll: true });
  }
  close() {
    if (this.root.contains(document.activeElement)) document.activeElement.blur();
    this.root.classList.remove('is-open');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.inert = true;
    this.onClose = null;
  }

  render() {
    const a = this.audio, t = a.current;
    const name = t ? (t.artist ? `${t.artist} – ${t.title}` : t.title) : '';
    this.now.textContent = t ? name : 'No music yet';
    this.status.textContent = a.error || (!a.tracks.length ? 'Add a link below and it will play through the club speakers.'
      : a.flat ? 'Playing without room sound: this host does not let the page process its audio.'
        : a.playing ? (a.muted ? 'Muted' : 'Now playing') : 'Paused');
    this.playBtn.textContent = a.playing ? 'Pause' : 'Play';
    this.playBtn.disabled = !a.tracks.length;
    if (document.activeElement !== this.vol) this.vol.value = String(Math.round(a.volume * 100));
    for (const b of this.orderBtns) b.setAttribute('aria-pressed', String(b.dataset.order === a.order));

    this.list.replaceChildren();
    a.tracks.forEach((track, i) => {
      const li = el('li', 'jb-track' + (i === a.index ? ' is-current' : ''));
      const play = el('button', 'jb-play');
      play.append(el('span', 'jb-num', String(i + 1).padStart(2, '0')), el('span', 'jb-title', track.title));
      if (track.artist) play.append(el('span', 'jb-artist', track.artist));
      play.addEventListener('click', () => a.play(i));
      li.append(play);
      if (track.kind !== 'list') {
        li.append(el('span', 'jb-kind', 'link'));
        const rm = el('button', 'jb-remove', '✕');
        rm.setAttribute('aria-label', `Remove ${track.title}`);
        rm.addEventListener('click', () => a.remove(i));
        li.append(rm);
      }
      this.list.append(li);
    });

    const on = a.playing && !a.muted;
    this.chip.textContent = !a.tracks.length ? 'No music yet · find the jukebox' : `${on ? '♪' : a.error ? 'No sound ·' : a.playing ? 'Muted ·' : 'Paused ·'} ${name}`;
    this.chip.classList.toggle('is-off', !on);
    this.chip.setAttribute('aria-label', on ? 'Mute the music' : 'Turn the music on');
  }
}
