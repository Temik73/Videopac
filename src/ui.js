(() => {
'use strict';
const $ = id => document.getElementById(id);
const emu = new Videopac();
window.vpEmu = emu;   // handy for debugging in the browser console

/* ---------------- storage (best effort) ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = n => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

/* ---------------- keys ---------------- */
const KEY_LABEL = ['0','1','2','3','4','5','6','7','8','9','YES','NO','SPACE','?','L','P','+','W','E','R','T','U','I','O',
  'Q','S','D','F','G','H','J','K','A','Z','X','C','V','B','M','.','−','×','÷','=','Y','N','CLEAR','ENTER'];
const LAYOUT = [
  [1,2,3,4,5,6,7,8,9,0,16,40],
  [24,17,18,19,20,44,21,22,23,15,41,42],
  [32,25,26,27,28,29,30,31,14,13,43,46],
  [33,34,35,36,37,45,38,39,10,11,12,47]
];
// phone layout: 10 columns, SPACE and ENTER two keys wide
const MOBILE_ORDER = [1,2,3,4,5,6,7,8,9,0, 24,17,18,19,20,44,21,22,23,15, 32,25,26,27,28,29,30,31,14,13,
  33,34,35,36,37,45,38,39,16,40, 41,42,43,10,11,12,46,47];
const MOBILE_WIDE = [12, 47];
const CODE_KEY = { Space: 12, Slash: 13, Equal: 43, Minus: 40, Period: 39, Enter: 47, NumpadEnter: 47, Backspace: 46, Delete: 46,
  NumpadAdd: 16, NumpadMultiply: 41, NumpadDivide: 42, NumpadSubtract: 40, F1: 10, F2: 11, BracketRight: 16, Quote: 41, Backslash: 42 };
for (let i = 0; i < 10; i++) CODE_KEY['Digit' + i] = i;
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(ch => { const k = KEY_LABEL.indexOf(ch); if (k >= 0) CODE_KEY['Key' + ch] = k; });
const JOY_CODES = {
  ArrowUp: [0, 1], ArrowRight: [0, 2], ArrowDown: [0, 4], ArrowLeft: [0, 8], ShiftRight: [0, 16], ControlRight: [0, 16],
  Numpad8: [1, 1], Numpad6: [1, 2], Numpad2: [1, 4], Numpad5: [1, 4], Numpad4: [1, 8], Numpad0: [1, 16]
};

/* ---------------- settings ---------------- */
const PAD_BUTTONS = [['A', 0], ['B', 1], ['X', 2], ['Y', 3], ['LB', 4], ['RB', 5], ['LT', 6], ['RT', 7], ['Select', 8], ['Start', 9]];
const DEFAULT_MAP = { 0: 'fire', 1: 'fire', 2: 'fire', 3: 'fire', 4: 3, 5: 4, 6: 46, 7: 47, 8: 2, 9: 1 };
const S = Object.assign({ region: 'PAL', plus: 'auto', touch: 'auto', vol: 70, scan: true, smooth: false, both: true, swap: false,
  spaceFire: true, map: DEFAULT_MAP }, store.get('vp.settings', {}));
S.map = Object.assign({}, DEFAULT_MAP, S.map);
const saveSettings = () => store.set('vp.settings', S);

/* ---------------- toast ---------------- */
let toastT = 0;
function toast(msg, err) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, err ? 5200 : 2600);
}

/* ---------------- machine state ---------------- */
let realBios = null, cart = null, paused = false;

function applyPlus() {
  const info = emu.biosInfo || { plus: false };
  emu.plusMode = realBios ? (S.plus === 'auto' ? !!info.plus : S.plus === 'on') : false;
  emu.setPalette();
  $('chipPlus').textContent = emu.plusMode ? 'Videopac+ on' : 'Videopac+ off';
  $('chipPlus').className = 'chip' + (emu.plusMode ? ' on' : '');
}
function applyRegion() {
  emu.setRegion(S.region);
  if (actx) emu.setSampleRate(actx.sampleRate);
  $('chipRegion').textContent = S.region === 'PAL' ? 'PAL 50 Hz' : 'NTSC 60 Hz';
}

function boot() {
  if (realBios) emu.loadBios(realBios); else emu.loadBios(DEMO_BIOS);
  if (cart) emu.loadCart(cart.data); else emu.ejectCart();
  applyPlus(); applyRegion();
  emu.reset();
  renderSlots();
}

function setBios(data, quiet) {
  if (data.length !== 1024) throw new Error('A Videopac BIOS is exactly 1024 bytes. This file is ' + data.length + ' bytes.');
  realBios = data;
  store.set('vp.bios', toB64(data));
  boot();
  if (!quiet) toast('BIOS loaded: ' + emu.biosInfo.name + (cart ? '' : '. Insert a cartridge to play.'));
}

function setCart(name, data, quiet) {
  const probe = new Videopac();
  probe.loadCart(data);               // validates size, throws a readable error
  cart = { name: name.replace(/\.(bin|rom|o2|zip)$/i, ''), data, crc: probe.cartCrc };
  boot();
  rememberCart(cart);
  if (!quiet) toast(realBios ? 'Inserted ' + cart.name : 'Cartridge inserted. Load a BIOS to play it.');
}

function ejectCart() { cart = null; boot(); toast('Cartridge ejected'); }

function renderSlots() {
  const bn = $('biosName'), bm = $('biosMeta');
  if (realBios) {
    bn.textContent = emu.biosInfo.name; bn.className = 'val';
    bm.textContent = 'CRC ' + hex(emu.biosCrc); $('slotBios').classList.add('loaded');
  } else {
    bn.textContent = 'Not loaded, showing the controller test'; bn.className = 'val empty';
    bm.textContent = 'o2rom.bin or g7400.bin, 1 KB'; $('slotBios').classList.remove('loaded');
  }
  const cn = $('cartName'), cm = $('cartMeta');
  if (cart) {
    cn.textContent = cart.name; cn.className = 'val';
    cm.textContent = (cart.data.length / 1024) + ' KB · CRC ' + hex(cart.crc); $('slotCart').classList.add('loaded');
  } else {
    cn.textContent = 'Empty'; cn.className = 'val empty'; cm.textContent = '.bin, .rom or .zip'; $('slotCart').classList.remove('loaded');
  }
  $('btnEject').disabled = !cart;
  renderRecent();
}

/* recent cartridges */
function rememberCart(c) {
  let list = store.get('vp.recent', []).filter(r => r.crc !== c.crc);
  list.unshift({ name: c.name, crc: c.crc, b64: toB64(c.data) });
  list = list.slice(0, 12);
  while (list.length && !store.set('vp.recent', list)) list.pop();
  renderRecent();
}
function renderRecent() {
  const list = store.get('vp.recent', []), ul = $('recent');
  ul.textContent = '';
  $('recentWrap').hidden = list.length === 0;
  list.forEach(r => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pick' + (cart && cart.crc === r.crc ? ' cur' : ''); b.textContent = r.name; b.title = 'Insert ' + r.name;
    b.onclick = () => { try { setCart(r.name, fromB64(r.b64)); } catch (e) { toast(e.message, true); } };
    const x = document.createElement('button');
    x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove ' + r.name + ' from recent');
    x.onclick = () => { store.set('vp.recent', store.get('vp.recent', []).filter(q => q.crc !== r.crc)); renderRecent(); };
    li.append(b, x); ul.append(li);
  });
}

/* ---------------- file loading ---------------- */
async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('This zip file could not be read.');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const list = [];
  for (let k = 0; k < n && dv.getUint32(p, true) === 0x02014b50; k++) {
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    list.push({ method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true),
      lo: dv.getUint32(p + 42, true), name: new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)) });
    p += 46 + nl + xl + cl;
  }
  const files = list.filter(f => !f.name.endsWith('/') && f.usize > 0 && f.usize <= 16384);
  files.sort((a, b) => (/\.(bin|rom|o2)$/i.test(b.name) - /\.(bin|rom|o2)$/i.test(a.name)) || b.usize - a.usize);
  const f = files[0];
  if (!f) throw new Error('No cartridge or BIOS image found inside the zip file.');
  const h = f.lo, start = h + 30 + dv.getUint16(h + 26, true) + dv.getUint16(h + 28, true);
  const raw = u8.subarray(start, start + f.csize);
  const name = f.name.split('/').pop();
  if (f.method === 0) return { name, data: raw.slice() };
  if (f.method !== 8) throw new Error('This zip uses a compression method the browser cannot unpack.');
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack zip files. Unzip the file first.');
  const out = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  return { name, data: new Uint8Array(out) };
}

async function readFile(file) {
  const buf = await file.arrayBuffer();
  if (/\.zip$/i.test(file.name) || (buf.byteLength > 4 && new DataView(buf).getUint32(0, true) === 0x04034b50)) return unzip(buf);
  return { name: file.name, data: new Uint8Array(buf) };
}

async function handleFile(file, kind) {
  try {
    const { name, data } = await readFile(file);
    if (kind === 'bios' || (kind === 'auto' && data.length === 1024)) setBios(data);
    else setCart(name, data);
  } catch (e) { toast(e.message, true); }
  unlockAudio();
}
$('fileBios').onchange = e => { const f = e.target.files[0]; if (f) handleFile(f, 'bios'); e.target.value = ''; };
$('fileCart').onchange = e => { const f = e.target.files[0]; if (f) handleFile(f, 'cart'); e.target.value = ''; };
$('btnEject').onclick = ejectCart;

/* Files load only through the Load BIOS and Insert buttons. A file dropped on the page is
   ignored, so the browser does not open it in place of the emulator. */
window.addEventListener('dragover', e => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; });
window.addEventListener('drop', e => e.preventDefault());

/* ---------------- audio ----------------
   iPhone/iPad notes:
   - The audio context may only start from a tap, and iOS only honours touchend/click, so every
     gesture retries until the context reports 'running' (it can also drop to 'interrupted' after
     a call, Siri or switching apps).
   - The ring/silent switch mutes Web Audio unless the page plays as media: Safari's Audio Session
     API is used where present, otherwise a silent looping <audio> element does the same job.
   - Samples go to an AudioWorklet; ScriptProcessor is only a fallback (unreliable in Safari). */
let actx = null, muted = false, workletPort = null, spNode = null, outReady = false, silentEl = null;
const RING = 16384, ring = new Float32Array(RING);
let rHead = 0, rTail = 0, lastOut = 0, hpX = 0, hpY = 0, lp = 0;
const WORKLET_SRC = `
class VPOut extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(32768); this.h = 0; this.t = 0; this.last = 0;
    this.port.onmessage = e => {
      const d = e.data, b = this.buf, n = b.length; let h = this.h;
      for (let i = 0; i < d.length; i++) { b[h] = d[i]; h = (h + 1) % n; }
      this.h = h;
      if ((h - this.t + n) % n > sampleRate * 0.15) this.t = (h - Math.floor(sampleRate * 0.05) + n) % n;
    };
  }
  process(inputs, outputs) {
    const out = outputs[0], o = out[0], b = this.buf, n = b.length;
    for (let i = 0; i < o.length; i++) {
      if (this.t !== this.h) { this.last = b[this.t]; this.t = (this.t + 1) % n; } else this.last *= 0.98;
      o[i] = this.last;
    }
    for (let c = 1; c < out.length; c++) out[c].set(o);
    return true;
  }
}
registerProcessor('vp-out', VPOut);`;

function silentWavUrl() {
  const n = 4410, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
function playbackMode() {
  if (navigator.audioSession) {
    try { if (navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; return; } catch (e) {}
  }
  const iOS = /iP(hone|ad|od)/.test(navigator.platform) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!iOS) return;
  try {
    if (!silentEl) { silentEl = document.createElement('audio'); silentEl.setAttribute('playsinline', ''); silentEl.setAttribute('x-webkit-airplay', 'deny'); silentEl.loop = true; silentEl.src = silentWavUrl(); }
    if (silentEl.paused) silentEl.play().catch(() => {});
  } catch (e) {}
}
function buildOutput() {
  if (actx.audioWorklet && window.AudioWorkletNode) {
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    actx.audioWorklet.addModule(url).then(() => {
      const node = new AudioWorkletNode(actx, 'vp-out', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      node.connect(actx.destination);
      workletPort = node.port; outReady = true; updateSoundNote();
    }).catch(() => scriptOutput());
  } else scriptOutput();
}
function scriptOutput() {
  spNode = actx.createScriptProcessor(2048, 1, 1);      // kept referenced; Safari drops unreferenced nodes
  spNode.onaudioprocess = ev => {
    const out = ev.outputBuffer.getChannelData(0);
    for (let i = 0; i < out.length; i++) {
      if (rTail !== rHead) { lastOut = ring[rTail]; rTail = (rTail + 1) % RING; } else lastOut *= 0.98;
      out[i] = lastOut;
    }
  };
  spNode.connect(actx.destination);
  outReady = true; updateSoundNote();
}
function updateSoundNote() {
  const on = !!(actx && actx.state === 'running' && outReady);
  $('soundNote').hidden = on;
  $('soundNote').textContent = actx ? 'Tap to turn on sound' : 'Tap, click or press a key to turn on sound';
}
function unlockAudio() {
  playbackMode();
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { actx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { actx = new AC(); } catch (e2) { actx = null; return; } }
    emu.setSampleRate(actx.sampleRate);
    actx.onstatechange = updateSoundNote;
    buildOutput();
  }
  if (actx.state !== 'running') {
    actx.resume().then(updateSoundNote, () => {});
    try {                                                 // a one-sample buffer, played inside the tap, unlocks older iOS
      const s = actx.createBufferSource(); s.buffer = actx.createBuffer(1, 1, actx.sampleRate); s.connect(actx.destination); s.start(0);
    } catch (e) {}
  }
  updateSoundNote();
}
function pushAudio() {
  if (!actx || actx.state !== 'running' || !outReady) return;
  const n = emu.aLen, buf = emu.aBuf, g = muted || paused ? 0 : (S.vol / 100) * 0.35;
  const chunk = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = buf[i];
    hpY = x - hpX + 0.995 * hpY; hpX = x;          // remove DC
    lp += (hpY - lp) * 0.45;                        // soften the square wave edges
    chunk[i] = lp * g;
  }
  if (workletPort) { workletPort.postMessage(chunk, [chunk.buffer]); return; }
  if ((rHead - rTail + RING) % RING > actx.sampleRate * 0.15) rTail = (rHead - Math.floor(actx.sampleRate * 0.05) + RING) % RING;
  for (let i = 0; i < n; i++) { ring[rHead] = chunk[i]; rHead = (rHead + 1) % RING; }
}
['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'].forEach(t => window.addEventListener(t, unlockAudio, { capture: true }));
document.addEventListener('visibilitychange', () => { if (!document.hidden && actx && actx.state !== 'running') actx.resume().then(updateSoundNote, () => {}); updateSoundNote(); });
window.vpAudioInfo = () => ({ state: actx ? actx.state : 'none', output: workletPort ? 'worklet' : spNode ? 'script' : 'none', rate: actx ? actx.sampleRate : 0 });

/* ---------------- input ---------------- */
const kbJoy = [0, 0];
const heldKeys = new Map();     // vp key -> Set of sources
const minHold = new Map();      // vp key -> release-not-before timestamp
function keyDown(k, src) { if (!heldKeys.has(k)) heldKeys.set(k, new Set()); heldKeys.get(k).add(src); minHold.set(k, performance.now() + 90); keyVisual(k); }
function keyUp(k, src) { const s = heldKeys.get(k); if (s) { s.delete(src); if (!s.size) heldKeys.delete(k); } keyVisual(k); }

const editable = el => el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
window.addEventListener('keydown', e => {
  if (editable(e.target) || e.metaKey || e.ctrlKey && e.code !== 'ControlRight') return;
  let used = false;
  if (S.spaceFire && e.code === 'Space') { kbJoy[0] |= 16; used = true; }
  else if (JOY_CODES[e.code]) { const [p, b] = JOY_CODES[e.code]; kbJoy[p] |= b; used = true; }
  else if (e.code in CODE_KEY) { if (!e.repeat) keyDown(CODE_KEY[e.code], 'kb:' + e.code); used = true; }
  if (used) e.preventDefault();
});
window.addEventListener('keyup', e => {
  if (S.spaceFire && e.code === 'Space') kbJoy[0] &= ~16;
  else if (JOY_CODES[e.code]) { const [p, b] = JOY_CODES[e.code]; kbJoy[p] &= ~b; }
  else if (e.code in CODE_KEY) keyUp(CODE_KEY[e.code], 'kb:' + e.code);
});
window.addEventListener('blur', () => { kbJoy[0] = kbJoy[1] = 0; heldKeys.clear(); document.querySelectorAll('.key.down').forEach(k => k.classList.remove('down')); });

/* on-screen membrane keyboard */
const keyEls = new Map();
(() => {
  const m = $('membrane');
  LAYOUT.forEach(row => row.forEach(k => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'key' + (KEY_LABEL[k].length > 1 ? ' sm' : '') + (k === 10 || k === 11 ? ' g74' : '');
    const SHORT = { 46: 'CLR' };
    if (SHORT[k]) b.innerHTML = '<span class="ml">' + KEY_LABEL[k] + '</span><span class="ms">' + SHORT[k] + '</span>';
    else b.textContent = KEY_LABEL[k];
    b.style.setProperty('--mo', MOBILE_ORDER.indexOf(k));
    if (MOBILE_WIDE.includes(k)) b.classList.add('w2m');
    b.setAttribute('aria-label', 'Videopac key ' + KEY_LABEL[k]);
    const src = 'scr:' + k;
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture && b.setPointerCapture(e.pointerId); keyDown(k, src); });
    const up = () => keyUp(k, src);
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    b.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.repeat) { e.stopPropagation(); e.preventDefault(); keyDown(k, src); } });
    b.addEventListener('keyup', e => { if (e.key === 'Enter') up(); });
    keyEls.set(k, b); m.append(b);
  }));
})();
function keyVisual(k) { const el = keyEls.get(k); if (el) el.classList.toggle('down', heldKeys.has(k)); }

/* touch controls */
let touchJoy = 0, touchFire = 0;
(() => {
  const pad = $('dpad'), knob = $('knob'), arrows = { 1: pad.querySelector('.u'), 2: pad.querySelector('.r'), 4: pad.querySelector('.d'), 8: pad.querySelector('.l') };
  const setDir = (bits, dx, dy) => {
    touchJoy = bits;
    for (const b in arrows) arrows[b].classList.toggle('lit', !!(bits & b));
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };
  const track = e => {
    const r = pad.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy; const d = Math.hypot(dx, dy), max = r.width * 0.3;
    if (d < r.width * 0.12) return setDir(0, 0, 0);
    const a = Math.atan2(dy, dx), oct = Math.round(a / (Math.PI / 4)) & 7;
    const bits = [2, 2 | 4, 4, 4 | 8, 8, 8 | 1, 1, 1 | 2][oct];
    if (d > max) { dx *= max / d; dy *= max / d; }
    setDir(bits, dx, dy);
  };
  pad.addEventListener('pointerdown', e => { e.preventDefault(); pad.setPointerCapture(e.pointerId); track(e); });
  pad.addEventListener('pointermove', e => { if (pad.hasPointerCapture(e.pointerId)) track(e); });
  const end = () => setDir(0, 0, 0);
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  const fire = $('fireBtn');
  fire.addEventListener('pointerdown', e => { e.preventDefault(); fire.setPointerCapture(e.pointerId); touchFire = 16; fire.classList.add('lit'); });
  const fup = () => { touchFire = 0; fire.classList.remove('lit'); };
  fire.addEventListener('pointerup', fup); fire.addEventListener('pointercancel', fup);
  document.querySelectorAll('[data-tkey]').forEach(b => {
    const k = +b.dataset.tkey, src = 'tch:' + k;
    b.addEventListener('pointerdown', e => { e.preventDefault(); keyDown(k, src); });
    b.addEventListener('pointerup', () => keyUp(k, src)); b.addEventListener('pointercancel', () => keyUp(k, src));
  });
})();
function isTouchDevice() { return !!(window.matchMedia && (matchMedia('(pointer: coarse)').matches || matchMedia('(any-pointer: coarse)').matches)) || (navigator.maxTouchPoints > 0 && !(window.matchMedia && matchMedia('(hover: hover)').matches)); }
function applyTouch() {
  const coarse = isTouchDevice();
  $('touchpad').hidden = !(S.touch === 'on' || (S.touch === 'auto' && coarse));
  if (typeof setGameClasses === 'function') setGameClasses();
}

/* gamepads */
let padBlocked = false, padNames = [];
const padKeyHeld = new Set();
function readPads() {
  let pads = [];
  try { pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(p => p && p.connected) : []; }
  catch (e) { padBlocked = true; }
  const bits = [0, 0], nowKeys = new Set();
  pads.slice(0, 2).forEach((p, i) => {
    let b = 0;
    const btn = n => p.buttons[n] && (p.buttons[n].pressed || p.buttons[n].value > 0.5);
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    if (btn(12) || ay < -0.45) b |= 1;
    if (btn(15) || ax > 0.45) b |= 2;
    if (btn(13) || ay > 0.45) b |= 4;
    if (btn(14) || ax < -0.45) b |= 8;
    for (const [, n] of PAD_BUTTONS) {
      if (!btn(n)) continue;
      const act = S.map[n];
      if (act === 'fire') b |= 16; else if (act !== 'none' && act !== undefined && act !== '') nowKeys.add(+act);
    }
    bits[i] = b;
  });
  for (const k of nowKeys) if (!padKeyHeld.has(k)) { padKeyHeld.add(k); keyDown(k, 'pad'); }
  for (const k of [...padKeyHeld]) if (!nowKeys.has(k)) { padKeyHeld.delete(k); keyUp(k, 'pad'); }
  const names = pads.slice(0, 2).map(p => p.id.replace(/\(.*$/, '').replace(/\s+/g, ' ').trim());
  if (names.join('|') !== padNames.join('|')) { padNames = names; updatePadUi(); }
  return bits;
}
window.addEventListener('gamepadconnected', e => { toast('Controller connected: ' + e.gamepad.id.split('(')[0].trim()); });
window.addEventListener('gamepaddisconnected', () => toast('Controller disconnected'));
function updatePadUi() {
  const n = padNames.length;
  $('chipPads').textContent = n ? (n === 1 ? '1 controller' : '2 controllers') : 'No controller';
  $('chipPads').className = 'chip' + (n ? ' on' : '');
  const kb1 = S.spaceFire ? 'Arrows + Space' : 'Arrows + Right Shift', kb2 = 'Numpad 8 4 6 2 + 0';
  const p1 = [padNames[0] ? 'Controller 1' : null, kb1, !$('touchpad').hidden ? 'touch' : null].filter(Boolean);
  const p2 = [padNames[1] ? 'Controller 2' : null, kb2].filter(Boolean);
  let a = p1, b = p2;
  if (S.swap) [a, b] = [b, a];
  if (S.both) { $('src0').textContent = 'Every controller and the keyboard'; $('src1').textContent = 'Same as player 1'; }
  else { $('src0').textContent = a.join(', '); $('src1').textContent = b.join(', '); }
  const list = $('padList');
  list.hidden = !n;
  list.textContent = padNames.map((nm, i) => 'Controller ' + (i + 1) + ': ' + (nm.length > 40 ? nm.slice(0, 40) + '…' : nm)).join(' · ');
  const note = $('padNote');
  let blocked = padBlocked;
  try { if (document.featurePolicy && !document.featurePolicy.allowsFeature('gamepad')) blocked = true; } catch (e) {}
  if (blocked) { note.hidden = false; note.textContent = 'This embedded view blocks game controllers. Open the page in its own browser tab to use one.'; }
  else if (!n) { note.hidden = false; note.textContent = 'Connect a controller and press any button on it to wake it up.'; }
  else note.hidden = true;
}

/* port indicators */
const crossEls = [0, 1].map(i => {
  const c = $('cross' + i), cells = {};
  ['n', 'u', 'n', 'l', 'f', 'r', 'n', 'd', 'n'].forEach(t => { const b = document.createElement('b'); b.className = t === 'n' ? 'n' : t === 'f' ? 'f' : ''; c.append(b); if (t !== 'n') cells[t] = b; });
  return cells;
});
const lastJoy = [-1, -1];
function showJoy(i, v) {
  if (lastJoy[i] === v) return; lastJoy[i] = v;
  const c = crossEls[i];
  c.u.classList.toggle('lit', !!(v & 1)); c.r.classList.toggle('lit', !!(v & 2)); c.d.classList.toggle('lit', !!(v & 4));
  c.l.classList.toggle('lit', !!(v & 8)); c.f.classList.toggle('lit', !!(v & 16));
}

function pollInput() {
  const pb = readPads();
  let p1 = kbJoy[0] | pb[0] | touchJoy | touchFire, p2 = kbJoy[1] | pb[1];
  if (S.both) p1 = p2 = p1 | p2;
  else if (S.swap) [p1, p2] = [p2, p1];
  emu.joy[0] = p1; emu.joy[1] = p2;
  showJoy(0, p1); showJoy(1, p2);
  const now = performance.now(), keys = emu.keys;
  keys.fill(0);
  for (const k of heldKeys.keys()) keys[k] = 1;
  for (const [k, t] of minHold) { if (t > now) keys[k] = 1; else { minHold.delete(k); } }
}

/* ---------------- controller mapping UI ---------------- */
(() => {
  const grid = $('mapGrid');
  PAD_BUTTONS.forEach(([name, n]) => {
    const id = 'map' + n, lab = document.createElement('label'); lab.htmlFor = id; lab.textContent = name;
    const sel = document.createElement('select'); sel.id = id;
    const opts = [['fire', 'Fire'], ['none', 'Nothing']].concat(KEY_LABEL.map((l, i) => [String(i), 'Key ' + l]));
    for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.append(o); }
    sel.value = String(S.map[n]);
    sel.onchange = () => { S.map[n] = sel.value === 'fire' || sel.value === 'none' ? sel.value : +sel.value; saveSettings(); };
    grid.append(lab, sel);
  });
})();

/* ---------------- settings wiring ---------------- */
function bindSelect(id, key, after) { const el = $(id); el.value = S[key]; el.onchange = () => { S[key] = el.value; saveSettings(); after && after(); }; }
function bindCheck(id, key, after) { const el = $(id); el.checked = !!S[key]; el.onchange = () => { S[key] = el.checked; saveSettings(); after && after(); }; }
bindSelect('optRegion', 'region', () => { applyRegion(); toast(S.region === 'PAL' ? 'PAL timing, 50 frames per second' : 'NTSC timing, 60 frames per second'); });
bindSelect('optPlus', 'plus', () => { applyPlus(); emu.reset(); });
bindSelect('optTouch', 'touch', () => { applyTouch(); updatePadUi(); });
bindCheck('optScan', 'scan', () => $('tv').classList.toggle('scan', S.scan));
bindCheck('optSmooth', 'smooth', () => $('tv').classList.toggle('smooth', S.smooth));
bindCheck('optBoth', 'both', updatePadUi);
bindCheck('optSwap', 'swap', updatePadUi);
bindCheck('optSpaceFire', 'spaceFire', updatePadUi);
$('optVol').value = S.vol; $('optVol').oninput = e => { S.vol = +e.target.value; saveSettings(); };
$('tv').classList.toggle('scan', S.scan); $('tv').classList.toggle('smooth', S.smooth);

/* ---------------- transport ---------------- */
function togglePause() {
  paused = !paused;
  $('btnPause').setAttribute('aria-pressed', paused);
  $('btnPause').querySelector('span').textContent = paused ? 'Resume' : 'Pause';
  $('pausedBadge').hidden = !paused;
}
$('btnPause').onclick = togglePause;
$('btnReset').onclick = () => { emu.reset(); if (paused) togglePause(); toast('Console reset'); };
$('btnMute').onclick = () => { muted = !muted; $('btnMute').setAttribute('aria-pressed', muted); $('btnMute').textContent = muted ? 'Sound off' : 'Sound on'; };
/* play mode: console fills the screen; real full screen where the browser allows it,
   otherwise (iPhone) a fixed full-window layout. Phones enter it automatically in landscape. */
const consoleEl = $('console');
let gameMode = null;   // null, 'user' or 'auto'
function setGameClasses() {
  consoleEl.classList.toggle('game', !!gameMode);
  consoleEl.classList.toggle('notouch', $('touchpad').hidden);
  document.body.classList.toggle('gaming', !!gameMode);
  $('fullLabel').textContent = gameMode ? 'Exit play mode' : (isTouch() ? 'Play mode' : 'Full screen');
}
const isTouch = () => !!(window.matchMedia && (matchMedia('(pointer: coarse)').matches || matchMedia('(any-pointer: coarse)').matches)) || (navigator.maxTouchPoints > 0 && !(window.matchMedia && matchMedia('(hover: hover)').matches));
function enterGame(how) {
  gameMode = how; setGameClasses();
  if (how === 'user') {
    const req = consoleEl.requestFullscreen || consoleEl.webkitRequestFullscreen;
    if (req) { try { const p = req.call(consoleEl); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
  }
}
function exitGame() {
  gameMode = null; setGameClasses();
  const fe = document.fullscreenElement || document.webkitFullscreenElement;
  if (fe) { const x = document.exitFullscreen || document.webkitExitFullscreen; try { const p = x.call(document); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
}
$('btnFull').onclick = () => { gameMode ? exitGame() : enterGame('user'); };
$('btnExitGame').onclick = exitGame;
['fullscreenchange', 'webkitfullscreenchange'].forEach(t => document.addEventListener(t, () => {
  if (!(document.fullscreenElement || document.webkitFullscreenElement) && gameMode === 'user' && !isTouch()) { gameMode = null; setGameClasses(); }
}));
window.addEventListener('keydown', e => { if (e.key === 'Escape' && gameMode) exitGame(); });
const phoneLandscape = window.matchMedia ? matchMedia('(orientation: landscape)') : null;
function onOrientation() {
  const land = window.innerWidth > window.innerHeight && window.innerHeight <= 520 && isTouch();
  if (land && !gameMode) enterGame('auto');
  else if (!land && gameMode === 'auto') exitGame();
}
if (phoneLandscape) (phoneLandscape.addEventListener ? phoneLandscape.addEventListener('change', onOrientation) : phoneLandscape.addListener(onOrientation));
window.addEventListener('resize', onOrientation);
window.addEventListener('orientationchange', () => setTimeout(onOrientation, 200));
let memState = null;
const stateKey = () => 'vp.state.' + hex(emu.biosCrc) + '.' + hex(emu.cartCrc);
$('btnSave').onclick = () => {
  if (!realBios) { toast('Load a BIOS first. There is nothing to save in the controller test.', true); return; }
  const s = emu.getState(); memState = { key: stateKey(), s };
  toast(store.set(stateKey(), s) ? 'State saved for ' + (cart ? cart.name : 'this BIOS') : 'State saved until you close this page');
};
$('btnLoad').onclick = () => {
  const s = store.get(stateKey(), null) || (memState && memState.key === stateKey() ? memState.s : null);
  if (!s) { toast('No saved state for this cartridge yet.', true); return; }
  try { emu.setState(s); toast('State loaded'); } catch (e) { toast('That saved state could not be loaded.', true); }
};

/* ---------------- main loop ---------------- */
const canvas = $('screen'), ctx = canvas.getContext('2d', { alpha: false });
const img = new ImageData(new Uint8ClampedArray(emu.fb.buffer), VP_W, VP_H);
let last = performance.now(), acc = 0, frames = 0, fpsT = last;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(200, t - last); last = t;
  if (paused) { pollInput(); return; }
  acc += dt;
  const fd = 1000 / emu.fps; let n = 0;
  while (acc >= fd && n < 4) { pollInput(); emu.runFrame(); pushAudio(); acc -= fd; n++; frames++; }
  if (n === 4) acc = 0;
  if (n) ctx.putImageData(img, -9, -5);
  if (t - fpsT >= 1000) { $('chipFps').textContent = Math.round(frames * 1000 / (t - fpsT)) + ' fps'; frames = 0; fpsT = t; }
}

/* ---------------- start ---------------- */
try { const b = store.get('vp.bios', null); if (b) realBios = fromB64(b); if (realBios && realBios.length !== 1024) realBios = null; } catch (e) { realBios = null; }
try { const r = store.get('vp.recent', []); if (r.length) { const d = fromB64(r[0].b64); const pr = new Videopac(); pr.loadCart(d); cart = { name: r[0].name, data: d, crc: pr.cartCrc }; } } catch (e) { cart = null; }
if (window.matchMedia && matchMedia('(max-width: 600px)').matches) document.querySelectorAll('details.fold[data-mobile-closed]').forEach(d => { d.open = false; });
applyTouch();
setGameClasses();
onOrientation();
boot();
updatePadUi();
if (realBios) toast(cart ? 'Ready: ' + cart.name : 'BIOS ready. Insert a cartridge.');
requestAnimationFrame(frame);
setInterval(() => { if (!padNames.length) updatePadUi(); }, 2000);
})();
