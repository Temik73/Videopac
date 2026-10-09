'use strict';
/* ==========================================================================
   Videopac G7000 / G7400 (Odyssey² / Videopac+) emulation core
   Intel 8048 CPU, Intel 8244/8245 VDC (grid, chars, quads, sprites,
   collisions, sound), EF9340/41 Videopac+ text/graphics chip, keyboard
   matrix, joysticks and cartridge bank switching.
   Hardware behaviour cross-checked against O2EM (Artistic License 2.0),
   whose 8244 and EF9341 character tables are used (charsets.js).
   ========================================================================== */

const VP_W = 340, VP_H = 250, VP_VBL_LINE = 241;

const VP_PAL_O2 = [
  0x000000, 0x0e3dd4, 0x00981b, 0x00bbd9, 0xc70008, 0xcc16b3, 0x9d8710, 0xe1dee1,
  0x5f6e6b, 0x6aa1ff, 0x3df07a, 0x31ffff, 0xff4255, 0xff98ff, 0xd9ad5d, 0xffffff];
const VP_PAL_PLUS = [
  0x000000, 0x0000b6, 0x00b600, 0x00b6b6, 0xb60000, 0xb600b6, 0xb6b600, 0xb6b6b6,
  0x494949, 0x4949ff, 0x49ff49, 0x49ffff, 0xff4949, 0xff49ff, 0xffff49, 0xffffff];

const VP_BIOS_INFO = {
  0x8016A315: { name: 'Odyssey² / Videopac G7000', plus: false, region: 'auto' },
  0xE20A9F41: { name: 'Videopac+ G7400', plus: true, region: 'PAL' },
  0xA318E8D6: { name: 'Videopac C52 (France)', plus: false, region: 'PAL' },
  0x11647CA5: { name: 'Jopac JO7400 (France)', plus: true, region: 'PAL' }
};

const VP_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function vpCrc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = VP_CRC_TABLE[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/* char/sprite 3-bit colour field (bit0 = R, bit1 = G, bit2 = B) -> palette index */
function vpSwapRB(v) { return (v & 2) | ((v & 1) << 2) | ((v & 4) >> 2); }

/* ------------------------------------------------------------------------ */
/* EF9340/41 Videopac+ (G7400) chip                                          */
/* ------------------------------------------------------------------------ */
class VideopacPlus {
  constructor() {
    this.bmp = new Uint8Array(320 * 250);
    this.mem = new Uint8Array(40 * 32 * 4);
    this.dchars = [new Uint8Array(960), new Uint8Array(960)];
    this.reset();
  }
  reset() {
    this.lum = 0xFF; this.tra = 0xFF;
    this.cx = 0; this.cy = 0; this.y0 = 0; this.r = 0; this.data = 0;
    this.incCurs = 1; this.slice = 0; this.sliceMode = 0;
    this.frameCnt = 0; this.blink = 0; this.dirty = 1;
    this.ta = 0; this.tb = 0; this.wta = 0;
    this.mem.fill(0); this.dchars[0].fill(0); this.dchars[1].fill(0); this.bmp.fill(0);
  }
  get active() { return this.tra !== 0xFF; }
  m(x, y, k) { return (x * 32 + y) * 4 + k; }
  advance() { if (++this.cx >= 40) { this.cx = 0; if (++this.cy >= 24) this.cy = 0; } }
  static flip(t) {
    return ((t & 0x80) >> 7) | ((t & 0x40) >> 5) | ((t & 0x20) >> 3) | ((t & 0x10) >> 1) |
      ((t & 0x08) << 1) | ((t & 0x04) << 3) | ((t & 0x02) << 5) | ((t & 0x01) << 7);
  }
  readPB(p) {
    switch (p & 3) { case 0: return this.lum >> 4; case 1: return this.lum & 15; case 2: return this.tra >> 4; default: return this.tra & 15; }
  }
  writePB(p, v) {
    v &= 15;
    switch (p & 3) {
      case 0: this.lum = (v << 4) | (this.lum & 15); break;
      case 1: this.lum = (this.lum & 0xF0) | v; break;
      case 2: this.tra = (v << 4) | (this.tra & 15); break;
      default: this.tra = (this.tra & 0xF0) | v;
    }
    this.dirty = 1;
  }
  read(a) {
    if (a === 4) return this.ta;
    if (a !== 5) return 0;
    const t = this.tb, i = this.m(this.cx, this.cy, 0);
    if (this.sliceMode) {
      const chr = this.mem[i], ext = (this.mem[i + 1] & 0x80) ? 1 : 0;
      this.ta = chr < 0xA0 ? 0 : VideopacPlus.flip(this.dchars[ext][(chr - 0xA0) * 10 + this.slice]);
      this.tb = 0xFF;
      this.slice = (this.slice + 1) % 10;
    } else {
      this.ta = this.mem[i + 1]; this.tb = this.mem[i];
      if (this.incCurs) this.advance();
    }
    return t;
  }
  write(d, a) {
    const i = this.m(this.cx, this.cy, 0), mem = this.mem;
    switch (a) {
      case 0: if (!this.sliceMode) mem[i + 1] = d; else this.wta = d; break;
      case 1:
        if (this.sliceMode) {
          const chr = mem[i], ext = (mem[i + 1] & 0x80) ? 1 : 0;
          if (chr >= 0xA0) this.dchars[ext][(chr - 0xA0) * 10 + this.slice] = VideopacPlus.flip(this.wta);
          this.slice = (this.slice + 1) % 10;
        } else {
          mem[i] = d;
          if (d > 0x7F && d < 0xA0 && !(mem[i + 1] & 0x80)) { mem[i + 2] = d; mem[i + 3] = mem[i + 1]; }
          else mem[i + 2] = mem[i + 3] = 0;
          if (this.incCurs) this.advance();
        }
        break;
      case 2: this.data = d; break;
      case 3: {
        const v = this.data;
        switch (d & 0xE0) {
          case 0x00: this.cy = v & 0x1F; this.cx = 0; break;
          case 0x20: this.cy = v & 0x1F; break;
          case 0x40: this.cx = (v & 0x3F) % 40; break;
          case 0x60: this.advance(); break;
          case 0x80:
            this.sliceMode = 0; this.slice = (v & 0x1F) % 10;
            switch (v & 0xE0) {
              case 0x00: case 0x20: this.incCurs = 1; break;
              case 0x40: case 0x60: this.incCurs = 0; break;
              case 0x80: case 0xA0: this.sliceMode = 1; break;
            }
            break;
          case 0xA0: this.r = v; break;
          case 0xC0: this.y0 = (v & 0x1F) % 24; break;
        }
        break;
      }
    }
    this.dirty = 1;
  }
  drawChar(x, y, ch, c0, c1, ext, dw, dh, ul) {
    if (x > 39 || y > 24 || ext > 1) return;
    let d = dh === 2 ? 5 : 0;
    const bmp = this.bmp;
    for (let yy = 0; yy < 10; yy++) {
      let k;
      if (ul && d === 9) k = 255;
      else if (ch >= 0xA0) k = this.dchars[ext][(ch - 0xA0) * 10 + d];
      else if (ch >= 0x80) k = 255;
      else k = VPP_CSET[ext][ch * 10 + d];
      let m = dw === 2 ? 0x08 : 0x80;
      const row = (y * 10 + yy) * 320 + x * 8;
      for (let xx = 0; xx < 8; xx++) {
        bmp[row + xx] = (k & m) ? c1 : c0;
        if ((xx & 1) || dw === 0) m >>= 1;
      }
      if ((yy & 1) || dh === 0) d++;
    }
  }
  update() {
    const mk = [0x01, 0x10, 0x04, 0x40, 0x02, 0x20, 0x08, 0x80], tlum = new Array(8);
    for (let i = 0; i < 8; i++) tlum[i] = (this.lum & mk[i]) ? 0 : 8;
    const mem = this.mem, r = this.r;
    let vpar = 0, lvd = 0;
    for (let y = 0; y < 25; y++) {
      let c0 = 0, lhd = 0, hpar = 0, ul = 0, conc = 0, box = 0;
      vpar = lvd === 0 ? 0 : 1 - vpar;
      const l = y === 0 ? 31 : (y - 1 + this.y0) % 24;
      for (let x = 0; x < 40; x++) {
        hpar = lhd === 0 ? 0 : 1 - hpar;
        const i = this.m(x, l, 0);
        const chr = mem[i], attr = mem[i + 1];
        let c1 = vpSwapRB(attr & 7);
        const ext = (attr & 0x80) ? 1 : 0;
        const serChr = mem[i + 2], serAtr = mem[i + 3];
        if (serChr) { c0 = vpSwapRB((serAtr >> 4) & 7); ul = serChr & 4; conc = serChr & 1; box = serChr & 2; }
        let dw, dh;
        if (ext) { c0 = vpSwapRB((attr >> 4) & 7); dw = dh = 0; }
        else {
          dw = (attr & 0x20) ? (hpar ? 2 : 1) : 0;
          dh = (attr & 0x10) ? (vpar ? 2 : 1) : 0;
          if (dw) lhd = 1;
          if (dh) lvd = 1;
        }
        let swap = false;
        if (x === this.cx && l === this.cy && (r & 0x10)) { swap = !swap; if ((r & 0x80) && this.blink) swap = !swap; }
        if (!ext && (attr & 0x40)) swap = !swap;
        if ((r & 0x80) && !(attr & 8) && !this.blink) {
          if (!(r & 0x10) || x !== this.cx || l !== this.cy) c1 = c0;
        }
        if ((y === 0 && (r & 8)) || (y !== 0 && (r & 1))) {
          if (!conc || !(r & 4)) {
            if (box || !(r & 2)) {
              if (swap) this.drawChar(x, y, chr, c1 | tlum[c1], c0 | tlum[c0], ext, dw, dh, ul);
              else this.drawChar(x, y, chr, c0 | tlum[c0], c1 | tlum[c1], ext, dw, dh, ul);
            } else this.drawChar(x, y, 255, 0, 0, 0, 0, 0, 0);
          }
        }
      }
    }
    if (r & 0x20) {
      const b = this.bmp;
      for (let y = 249; y >= 10; y--) b.copyWithin(y * 320, (((y - 10) >> 1) + 10) * 320, (((y - 10) >> 1) + 10) * 320 + 320);
    }
    this.dirty = 0;
  }
  frame() {
    if (!this.active) return;
    if (--this.frameCnt <= 0) { this.frameCnt = 100; this.blink = 1 - this.blink; this.dirty = 1; }
    if (this.dirty) this.update();
  }
  getState() {
    return { lum: this.lum, tra: this.tra, cx: this.cx, cy: this.cy, y0: this.y0, r: this.r, data: this.data,
      incCurs: this.incCurs, slice: this.slice, sliceMode: this.sliceMode, ta: this.ta, tb: this.tb, wta: this.wta,
      mem: Array.from(this.mem), d0: Array.from(this.dchars[0]), d1: Array.from(this.dchars[1]) };
  }
  setState(s) {
    Object.assign(this, { lum: s.lum, tra: s.tra, cx: s.cx, cy: s.cy, y0: s.y0, r: s.r, data: s.data, incCurs: s.incCurs,
      slice: s.slice, sliceMode: s.sliceMode, ta: s.ta, tb: s.tb, wta: s.wta });
    this.mem.set(s.mem); this.dchars[0].set(s.d0); this.dchars[1].set(s.d1); this.dirty = 1;
  }
}

/* ------------------------------------------------------------------------ */
/* Console                                                                   */
/* ------------------------------------------------------------------------ */
class Videopac {
  constructor() {
    this.bios = new Uint8Array(1024);
    this.biosLoaded = false; this.biosCrc = 0; this.biosInfo = null;
    this.cartLoaded = false; this.cartCrc = 0;
    this.ram = new Uint8Array(64);
    this.extRam = new Uint8Array(256);
    this.extRom = new Uint8Array(1024);
    this.vdc = new Uint8Array(256);
    this.fb = new Uint32Array(VP_W * VP_H);
    this.lineCol = new Uint8Array(VP_W);
    this.lineMask = new Uint8Array(VP_W);
    this.coltab = new Uint8Array(8);
    this.keys = new Uint8Array(48);    // keyboard matrix, index = row*8+col (= character code)
    this.joy = [0, 0];                  // [player 1 (scan line 1), player 2 (scan line 0)]; bits: 1 up 2 right 4 down 8 left 16 fire
    this.vpp = new VideopacPlus();
    this.plusMode = false;
    this.pal32 = new Uint32Array(16);
    this.sampleRate = 48000;
    this.aBuf = new Float32Array(4096);
    this.aLen = 0;
    this.cartBanks = [new Uint8Array(3072).fill(0xFF)];
    this.bankMode = 1; this.romLatch = 0; this.exrom = false;
    this.setPalette();
    this.setRegion('PAL');
    this.buildBanks();
    this.reset();
  }

  get ready() { return this.biosLoaded; }

  setPalette() {
    const p = this.plusMode ? VP_PAL_PLUS : VP_PAL_O2;
    for (let i = 0; i < 16; i++) {
      const c = p[i];
      this.pal32[i] = (0xFF000000 | ((c & 0xFF) << 16) | (c & 0xFF00) | ((c >> 16) & 0xFF)) >>> 0;
    }
  }

  setRegion(r) {
    this.region = r === 'NTSC' ? 'NTSC' : 'PAL';
    this.lines = this.region === 'PAL' ? 312 : 262;
    this.fps = this.region === 'PAL' ? 50 : 60;
    const clk = this.region === 'PAL' ? 17734476 / 3 / 15 : 3579545 * 1.5 / 15;
    this.cpl = clk / this.fps / this.lines;
    this.aStep = this.sampleRate / (this.lines * this.fps);
  }
  setSampleRate(sr) { this.sampleRate = sr; this.aStep = sr / (this.lines * this.fps); }

  loadBios(data) {
    if (data.length !== 1024) throw new Error('A Videopac BIOS is exactly 1024 bytes; this file is ' + data.length + ' bytes.');
    this.bios.set(data);
    this.biosLoaded = true;
    this.biosCrc = vpCrc32(data);
    this.biosInfo = VP_BIOS_INFO[this.biosCrc] || { name: 'Unknown BIOS', plus: false, region: 'auto' };
    this.plusMode = this.biosInfo.plus;
    this.setPalette();
    this.buildBanks();
  }

  ejectCart() {
    this.cartBanks = [new Uint8Array(3072).fill(0xFF)];
    this.bankMode = 1; this.cartLoaded = false; this.cartCrc = 0; this.exrom = false;
    this.buildBanks();
  }

  loadCart(data) {
    if (!data.length) throw new Error('The cartridge file is empty.');
    if (data.length > 16384) throw new Error('Cartridges larger than 16 KB (MegaCART) are not supported.');
    if (data.length % 1024) {
      const n = new Uint8Array(Math.ceil(data.length / 1024) * 1024).fill(0xFF);
      n.set(data); data = n;
    }
    const crc = vpCrc32(data);
    this.exrom = crc === 0xAFB23F89 || crc === 0x3BFEF56B || crc === 0x9B5E9356; // Musician, Four in 1 Row
    const banks = [];
    let nb;
    if (data.length % 3072 === 0) {                     // 3K-per-bank layout
      nb = data.length / 3072;
      for (let i = 0; i < nb; i++) banks.unshift(data.slice(i * 3072, (i + 1) * 3072));
    } else if (data.length === 4096 && this.exrom) {    // 1K external ROM + 3K program
      this.extRom.set(data.subarray(0, 1024));
      banks.push(data.slice(1024, 4096)); nb = 1;
    } else {
      if (data.length < 2048) { const n = new Uint8Array(2048).fill(0xFF); n.set(data, 2048 - data.length); data = n; }
      nb = data.length / 2048;
      for (let i = 0; i < nb; i++) {
        const c = data.subarray(i * 2048, (i + 1) * 2048), b = new Uint8Array(3072);
        b.set(c, 0); b.set(c.subarray(1024, 2048), 2048);  // A10 not connected: mirror upper KB
        banks.unshift(b);
      }
    }
    this.cartBanks = banks;
    this.bankMode = nb === 1 ? 1 : nb === 2 ? (this.exrom ? 1 : 2) : nb === 4 ? 3 : 4;
    this.cartLoaded = true; this.cartCrc = crc;
    this.buildBanks();
  }

  buildBanks() {
    this.banks = this.cartBanks.map(c => {
      const b = new Uint8Array(4096);
      b.set(this.bios, 0); b.set(c, 0x400);
      return b;
    });
    while (this.banks.length < 8) this.banks.push(this.banks[this.banks.length - 1]);
    this.selectBank();
  }

  selectBank() {
    const p1 = this.p1 === undefined ? 0xFF : this.p1;
    let i = 0;
    if (this.bankMode === 2) i = ~p1 & 1;
    else if (this.bankMode === 3) i = ~p1 & 3;
    else if (this.bankMode === 4) i = (p1 & 1) ? 0 : this.romLatch;
    this.rom = this.banks[i];
  }

  reset() {
    this.pc = 0; this.A = 0; this.sp = 0;
    this.cy = 0; this.ac = 0; this.f0 = 0; this.f1 = 0; this.bs = 0;
    this.mb = 0; this.savedMb = 0;
    this.xien = 0; this.tien = 0; this.inIrq = false; this.tirq = 0;
    this.tf = 0; this.timer = 0; this.tmode = 0; this.presc = 0;
    this.p1 = 0xFF; this.p2 = 0xFF; this.romLatch = 0;
    this.ram.fill(0); this.vdc.fill(0); this.extRam.fill(0);
    this.intActive = 0; this.xpend = false; this.line = 0; this.hpos = 0; this.inVbl = false;
    this.coltab.fill(0); this.xLatch = 0; this.yLatch = 0;
    this.sndDiv = 0; this.sndCnt = 0; this.sndIrq = 0; this.level = 0; this.aPhase = 0;
    this.vpp.reset();
    this.fb.fill(this.pal32[0]);
    this.selectBank();
  }

  /* ---------------- I/O ---------------- */
  writeP1(d) { this.p1 = d & 0xFF; if (this.bankMode > 1) this.selectBank(); }

  readP2() {
    const p2 = this.p2;
    if (!(this.p1 & 0x04)) {
      const si = p2 & 7;
      let so = -1;
      if (si < 6) for (let i = 0; i < 8; i++) if (this.keys[si * 8 + i]) so = i ^ 7;
      if (so >= 0) return (p2 & 0x0F) | (so << 5);
    }
    return p2 | 0xF0;
  }

  inBus() {
    const p1 = this.p1;
    if ((p1 & 0x08) && (p1 & 0x10)) {
      const si = (p1 & 0x04) ? 0 : (this.p2 & 7);
      return (~this.joy[si === 1 ? 0 : 1]) & 0xFF;
    }
    return 0;
  }

  t1() { return (this.inVbl || this.hpos > this.cpl * 0.76) ? 1 : 0; }

  extRead(a) {
    const p1 = this.p1;
    if (!(p1 & 0x08) && !(p1 & 0x40)) return this.vdcRead(a);
    if (!(p1 & 0x10)) return this.extRam[a];
    if (!(p1 & 0x20)) return this.plusMode ? this.vpp.read(a) : 0;
    if (this.exrom && (p1 & 0x02)) return this.extRom[((this.p2 & 3) << 8) | a];
    return 0;
  }

  extWrite(a, d) {
    const p1 = this.p1;
    if (!(p1 & 0x08)) { this.vdcWrite(a, d); return; }
    if (!(p1 & 0x10) && !(p1 & 0x40)) {
      if (a < 0x80) this.extRam[a] = d;
      else if (this.bankMode === 4) { this.romLatch = (~d) & 7; this.selectBank(); }
      return;
    }
    if (!(p1 & 0x20) && this.plusMode) this.vpp.write(d, a);
  }

  latchPos() {
    this.yLatch = this.line > VP_VBL_LINE ? 0xFF : this.line;
    this.xLatch = Math.min(255, (this.hpos / this.cpl * 252) | 0);
  }

  vdcRead(a) {
    const v = this.vdc;
    if ((a & 0xE0) === 0xA0) a &= ~0x10;
    switch (a) {
      case 0xA1: {
        let d = v[0xA0] & 0x02;
        if (this.inVbl) d |= 0x08;
        if (this.hpos < this.cpl * 0.667) d |= 0x01;
        if (this.sndIrq) d |= 0x04;
        this.sndIrq = 0;
        return d;
      }
      case 0xA2: {
        const si = v[0xA2], ct = this.coltab;
        let d = 0;
        for (let b = 0; b < 8; b++) if (si & (1 << b)) d |= ct[b] & ~(1 << b);
        ct.fill(0);
        return d & 0xFF;
      }
      case 0xA4: if (v[0xA0] & 0x02) this.latchPos(); return this.yLatch;
      case 0xA5: if (v[0xA0] & 0x02) this.latchPos(); return this.xLatch;
      case 0x02: case 0x06: case 0x0A: case 0x0E: case 0xA3: case 0xA7: case 0xA8: case 0xA9: return 0;
      default:
        if (a < 0x80 && (v[0xA0] & 0x20)) return 0;
        if (a >= 0xC0 && (v[0xA0] & 0x08)) return 0;
        return v[a];
    }
  }

  vdcWrite(a, d) {
    const v = this.vdc;
    if ((a & 0xE0) === 0xA0) a &= ~0x10;
    if (a < 0x80 && (v[0xA0] & 0x20)) return;               // objects locked while displayed
    if ((a >= 0xC0 && (v[0xA0] & 0x08)) || a >= 0xF0) return; // grid locked while displayed
    if (a === 0xA1 || a === 0xA4 || a === 0xA5 || a === 0xA6 || (a < 0x10 && (a & 3) === 3) ||
      (a >= 0xAB && a <= 0xAF) || (a >= 0xC9 && a <= 0xCF) || (a >= 0xD9 && a <= 0xDF) || (a >= 0xEA && a <= 0xEF)) return;
    if (a >= 0x10 && a < 0x80) {
      if ((a & 3) === 3) d &= 0x0F; else if ((a & 3) === 0) d &= 0xFE;
    } else if ((a & 0xF0) === 0xD0) d &= 1;
    if (a === 0xA0) { if ((v[0xA0] & 0x02) && !(d & 0x02)) this.latchPos(); }
    else if (a === 0xAA) d &= 0xBF;
    else if (a >= 0x40 && a < 0x80 && !(a & 2)) {         // quad position registers are shared
      const b = a & 0x71;
      v[b] = v[b + 4] = v[b + 8] = v[b + 12] = d;
      return;
    }
    v[a] = d;
  }

  /* ---------------- CPU ---------------- */
  imm() { const d = this.rom[this.pc]; this.pc = (this.pc & 0x800) | ((this.pc + 1) & 0x7FF); return d; }
  ind(i) { return this.ram[(this.bs ? 0x18 : 0) + i] & 0x3F; }
  rr(n) { return (this.bs ? 0x18 : 0) + n; }
  getPSW() { return (this.cy << 7) | (this.ac << 6) | (this.f0 << 5) | (this.bs << 4) | 0x08 | this.sp; }
  setPSW(v) { this.cy = (v >> 7) & 1; this.ac = (v >> 6) & 1; this.f0 = (v >> 5) & 1; this.bs = (v >> 4) & 1; this.sp = v & 7; }
  push() {
    const p = 8 + this.sp * 2;
    this.ram[p] = this.pc & 0xFF;
    this.ram[p + 1] = ((this.pc >> 8) & 0x0F) | (this.getPSW() & 0xF0);
    this.sp = (this.sp + 1) & 7;
  }
  pop() {
    this.sp = (this.sp - 1) & 7;
    const p = 8 + this.sp * 2;
    this.pc = this.ram[p] | ((this.ram[p + 1] & 0x0F) << 8);
    return this.ram[p + 1];
  }
  add(v, c) {
    const a = this.A, r = a + v + c;
    this.ac = ((a & 0x0F) + (v & 0x0F) + c) > 0x0F ? 1 : 0;
    this.cy = r > 0xFF ? 1 : 0;
    this.A = r & 0xFF;
  }
  jcc(cond) {
    const d = this.rom[this.pc];
    if (cond) this.pc = (this.pc & 0xF00) | d;
    else this.pc = (this.pc & 0x800) | ((this.pc + 1) & 0x7FF);
  }
  incTimer() {
    this.timer = (this.timer + 1) & 0xFF;
    if (this.timer === 0) { this.tf = 1; if (this.tien) this.tirq = 1; }
  }
  doIrq(vec) { this.push(); this.savedMb = this.mb; this.mb = 0; this.inIrq = true; this.pc = vec; }
  extIrq() { this.intActive = 6; this.xpend = true; }

  step() {
    const op = this.rom[this.pc];
    this.pc = (this.pc & 0x800) | ((this.pc + 1) & 0x7FF);
    const ram = this.ram;
    switch (op) {
      case 0x00: return 1;                                         // NOP
      case 0x02: return 2;                                         // OUTL BUS,A (unconnected)
      case 0x03: this.add(this.imm(), 0); return 2;                // ADD A,#
      case 0x04: case 0x24: case 0x44: case 0x64:
      case 0x84: case 0xA4: case 0xC4: case 0xE4: {                // JMP
        const d = this.imm();
        this.pc = (this.mb << 11) | ((op & 0xE0) << 3) | d; return 2;
      }
      case 0x05: this.xien = 1; return 1;                          // EN I
      case 0x07: this.A = (this.A - 1) & 0xFF; return 1;           // DEC A
      case 0x08: this.A = this.inBus(); return 2;                  // INS A,BUS
      case 0x09: this.A = this.p1; return 2;                       // IN A,P1
      case 0x0A: this.A = this.readP2(); return 2;                 // IN A,P2
      case 0x0C: case 0x0D: case 0x0E: case 0x0F: this.A = this.vpp.readPB(op & 3); return 2; // MOVD A,Pp
      case 0x10: case 0x11: { const a = this.ind(op & 1); ram[a] = ram[a] + 1; return 1; } // INC @Ri
      case 0x12: case 0x32: case 0x52: case 0x72:
      case 0x92: case 0xB2: case 0xD2: case 0xF2:
        this.jcc(this.A & (1 << (op >> 5))); return 2;            // JBb
      case 0x13: this.add(this.imm(), this.cy); return 2;          // ADDC A,#
      case 0x14: case 0x34: case 0x54: case 0x74:
      case 0x94: case 0xB4: case 0xD4: case 0xF4: {                // CALL
        const d = this.imm(); this.push();
        this.pc = (this.mb << 11) | ((op & 0xE0) << 3) | d; return 2;
      }
      case 0x15: this.xien = 0; return 1;                          // DIS I
      case 0x16: { const t = this.tf; this.tf = 0; this.jcc(t); return 2; } // JTF
      case 0x17: this.A = (this.A + 1) & 0xFF; return 1;           // INC A
      case 0x18: case 0x19: case 0x1A: case 0x1B:
      case 0x1C: case 0x1D: case 0x1E: case 0x1F: { const r = this.rr(op & 7); ram[r] = ram[r] + 1; return 1; }
      case 0x20: case 0x21: { const a = this.ind(op & 1), t = ram[a]; ram[a] = this.A; this.A = t; return 1; }
      case 0x23: this.A = this.imm(); return 2;                    // MOV A,#
      case 0x25: this.tien = 1; return 1;                          // EN TCNTI
      case 0x26: this.jcc(1); return 2;                            // JNT0 (T0 tied low)
      case 0x27: this.A = 0; return 1;                             // CLR A
      case 0x28: case 0x29: case 0x2A: case 0x2B:
      case 0x2C: case 0x2D: case 0x2E: case 0x2F: { const r = this.rr(op & 7), t = ram[r]; ram[r] = this.A; this.A = t; return 1; }
      case 0x30: case 0x31: {                                      // XCHD A,@Ri
        const a = this.ind(op & 1), t = ram[a];
        ram[a] = (t & 0xF0) | (this.A & 0x0F); this.A = (this.A & 0xF0) | (t & 0x0F); return 1;
      }
      case 0x35: this.tien = 0; this.tirq = 0; return 1;           // DIS TCNTI
      case 0x36: this.jcc(0); return 2;                            // JT0
      case 0x37: this.A ^= 0xFF; return 1;                         // CPL A
      case 0x39: this.writeP1(this.A); return 2;                   // OUTL P1,A
      case 0x3A: this.p2 = this.A; return 2;                       // OUTL P2,A
      case 0x3C: case 0x3D: case 0x3E: case 0x3F: this.vpp.writePB(op & 3, this.A); return 2; // MOVD Pp,A
      case 0x40: case 0x41: this.A |= ram[this.ind(op & 1)]; return 1;
      case 0x42: this.A = this.timer; return 1;                    // MOV A,T
      case 0x43: this.A |= this.imm(); return 2;
      case 0x45: this.tmode = 2; return 1;                         // STRT CNT
      case 0x46: this.jcc(!this.t1()); return 2;                   // JNT1
      case 0x47: this.A = ((this.A << 4) | (this.A >> 4)) & 0xFF; return 1; // SWAP
      case 0x48: case 0x49: case 0x4A: case 0x4B:
      case 0x4C: case 0x4D: case 0x4E: case 0x4F: this.A |= ram[this.rr(op & 7)]; return 1;
      case 0x50: case 0x51: this.A &= ram[this.ind(op & 1)]; return 1;
      case 0x53: this.A &= this.imm(); return 2;
      case 0x55: this.tmode = 1; this.presc = 0; return 1;         // STRT T
      case 0x56: this.jcc(this.t1()); return 2;                    // JT1
      case 0x57: {                                                 // DA A
        let a = this.A, c = this.cy;
        if ((a & 0x0F) > 9 || this.ac) { a += 6; if (a > 0xFF) c = 1; a &= 0xFF; }
        if ((a & 0xF0) > 0x90 || c) { a += 0x60; c = 1; }
        this.A = a & 0xFF; this.cy = c; return 1;
      }
      case 0x58: case 0x59: case 0x5A: case 0x5B:
      case 0x5C: case 0x5D: case 0x5E: case 0x5F: this.A &= ram[this.rr(op & 7)]; return 1;
      case 0x60: case 0x61: this.add(ram[this.ind(op & 1)], 0); return 1;
      case 0x62: this.timer = this.A; return 1;                    // MOV T,A
      case 0x65: this.tmode = 0; return 1;                         // STOP TCNT
      case 0x67: { const c = this.A & 1; this.A = (this.A >> 1) | (this.cy << 7); this.cy = c; return 1; } // RRC
      case 0x68: case 0x69: case 0x6A: case 0x6B:
      case 0x6C: case 0x6D: case 0x6E: case 0x6F: this.add(ram[this.rr(op & 7)], 0); return 1;
      case 0x70: case 0x71: this.add(ram[this.ind(op & 1)], this.cy); return 1;
      case 0x75: return 1;                                         // ENT0 CLK
      case 0x76: this.jcc(this.f1); return 2;                      // JF1
      case 0x77: this.A = ((this.A >> 1) | (this.A << 7)) & 0xFF; return 1; // RR
      case 0x78: case 0x79: case 0x7A: case 0x7B:
      case 0x7C: case 0x7D: case 0x7E: case 0x7F: this.add(ram[this.rr(op & 7)], this.cy); return 1;
      case 0x80: case 0x81: this.A = this.extRead(ram[this.rr(op & 1)]); return 2; // MOVX A,@Ri
      case 0x83: this.pop(); return 2;                             // RET
      case 0x85: this.f0 = 0; return 1;
      case 0x86: this.jcc(this.intActive > 0); return 2;           // JNI
      case 0x88: this.imm(); return 2;                             // ORL BUS,#
      case 0x89: this.writeP1(this.p1 | this.imm()); return 2;
      case 0x8A: this.p2 |= this.imm(); return 2;
      case 0x8C: case 0x8D: case 0x8E: case 0x8F: this.vpp.writePB(op & 3, this.vpp.readPB(op & 3) | this.A); return 2; // ORLD
      case 0x90: case 0x91: this.extWrite(ram[this.rr(op & 1)], this.A); return 2; // MOVX @Ri,A
      case 0x93: {                                                 // RETR
        const h = this.pop();
        this.cy = (h >> 7) & 1; this.ac = (h >> 6) & 1; this.f0 = (h >> 5) & 1; this.bs = (h >> 4) & 1;
        if (this.inIrq) { this.inIrq = false; this.mb = this.savedMb; }
        return 2;
      }
      case 0x95: this.f0 ^= 1; return 1;
      case 0x96: this.jcc(this.A !== 0); return 2;                 // JNZ
      case 0x97: this.cy = 0; return 1;
      case 0x98: this.imm(); return 2;                             // ANL BUS,#
      case 0x99: this.writeP1(this.p1 & this.imm()); return 2;
      case 0x9A: this.p2 &= this.imm(); return 2;
      case 0x9C: case 0x9D: case 0x9E: case 0x9F: this.vpp.writePB(op & 3, this.vpp.readPB(op & 3) & this.A); return 2; // ANLD
      case 0xA0: case 0xA1: ram[this.ind(op & 1)] = this.A; return 1;
      case 0xA3: this.A = this.rom[(this.pc & 0xF00) | this.A]; return 2; // MOVP A,@A
      case 0xA5: this.f1 = 0; return 1;
      case 0xA7: this.cy ^= 1; return 1;
      case 0xA8: case 0xA9: case 0xAA: case 0xAB:
      case 0xAC: case 0xAD: case 0xAE: case 0xAF: ram[this.rr(op & 7)] = this.A; return 1;
      case 0xB0: case 0xB1: { const a = this.ind(op & 1); ram[a] = this.imm(); return 2; }
      case 0xB3: this.pc = (this.pc & 0xF00) | this.rom[(this.pc & 0xF00) | this.A]; return 2; // JMPP @A
      case 0xB5: this.f1 ^= 1; return 1;
      case 0xB6: this.jcc(this.f0); return 2;                      // JF0
      case 0xB8: case 0xB9: case 0xBA: case 0xBB:
      case 0xBC: case 0xBD: case 0xBE: case 0xBF: { const r = this.rr(op & 7); ram[r] = this.imm(); return 2; }
      case 0xC5: this.bs = 0; return 1;
      case 0xC6: this.jcc(this.A === 0); return 2;                 // JZ
      case 0xC7: this.A = this.getPSW(); return 1;
      case 0xC8: case 0xC9: case 0xCA: case 0xCB:
      case 0xCC: case 0xCD: case 0xCE: case 0xCF: { const r = this.rr(op & 7); ram[r] = ram[r] - 1; return 1; }
      case 0xD0: case 0xD1: this.A ^= ram[this.ind(op & 1)]; return 1;
      case 0xD3: this.A ^= this.imm(); return 2;
      case 0xD5: this.bs = 1; return 1;
      case 0xD7: this.setPSW(this.A); return 1;
      case 0xD8: case 0xD9: case 0xDA: case 0xDB:
      case 0xDC: case 0xDD: case 0xDE: case 0xDF: this.A ^= ram[this.rr(op & 7)]; return 1;
      case 0xE3: this.A = this.rom[0x300 | this.A]; return 2;      // MOVP3 A,@A
      case 0xE5: this.mb = 0; return 1;
      case 0xE6: this.jcc(!this.cy); return 2;                     // JNC
      case 0xE7: this.A = ((this.A << 1) | (this.A >> 7)) & 0xFF; return 1; // RL
      case 0xE8: case 0xE9: case 0xEA: case 0xEB:
      case 0xEC: case 0xED: case 0xEE: case 0xEF: {                // DJNZ
        const r = this.rr(op & 7); ram[r] = ram[r] - 1; this.jcc(ram[r] !== 0); return 2;
      }
      case 0xF0: case 0xF1: this.A = ram[this.ind(op & 1)]; return 1;
      case 0xF5: this.mb = 1; return 1;
      case 0xF6: this.jcc(this.cy); return 2;                      // JC
      case 0xF7: { const c = this.A >> 7; this.A = ((this.A << 1) | this.cy) & 0xFF; this.cy = c; return 1; } // RLC
      case 0xF8: case 0xF9: case 0xFA: case 0xFB:
      case 0xFC: case 0xFD: case 0xFE: case 0xFF: this.A = ram[this.rr(op & 7)]; return 1;
      default: return 1;                                           // unused opcodes
    }
  }

  /* ---------------- frame ---------------- */
  runFrame() {
    this.aLen = 0;
    if (!this.ready) return;
    const cpl = this.cpl;
    if (this.plusMode) this.vpp.frame();
    for (let line = 0; line < this.lines; line++) {
      this.line = line;
      if (line === 0) this.inVbl = false;
      if (line === VP_VBL_LINE) { this.inVbl = true; this.extIrq(); }
      else if (this.vdc[0xA0] & 0x01) this.extIrq();             // horizontal (line) interrupt
      while (this.hpos < cpl) {
        let c = this.step();
        if (!this.inIrq) {
          if (this.xien && this.xpend) { this.xpend = false; this.doIrq(3); c += 2; }
          else if (this.tien && this.tirq) { this.tirq = 0; this.doIrq(7); c += 2; }
        }
        this.hpos += c;
        if (this.intActive > 0) { this.intActive -= c; if (this.intActive <= 0) this.xpend = false; }
        if (this.tmode === 1) {
          this.presc += c;
          while (this.presc >= 32) { this.presc -= 32; this.incTimer(); }
        }
      }
      this.hpos -= cpl;
      if (line < VP_H) this.renderLine(line);
      if (this.tmode === 2 && !this.inVbl) this.incTimer();     // event counter counts visible lines
      this.soundLine();
    }
  }

  soundLine() {
    const v = this.vdc, ctl = v[0xAA];
    if (++this.sndDiv >= ((ctl & 0x20) ? 4 : 16)) {
      this.sndDiv = 0;
      if (ctl & 0x80) {
        let r = (v[0xA7] << 16) | (v[0xA8] << 8) | v[0xA9];
        let fb = r & 1;
        r >>>= 1;
        if (ctl & 0x10) { fb ^= (r >> 4) & 1; r = (r & ~0x8000) | (fb << 15); }
        r |= fb << 23;
        v[0xA7] = (r >> 16) & 0xFF; v[0xA8] = (r >> 8) & 0xFF; v[0xA9] = r & 0xFF;
        if (++this.sndCnt >= 24) {
          this.sndCnt = 0;
          if ((v[0xA0] & 0x04) && !this.sndIrq) { this.sndIrq = 1; this.extIrq(); }
        }
      }
    }
    this.level = (ctl & 0x80) && (v[0xA9] & 1) ? (ctl & 0x0F) / 15 : 0;
    this.aPhase += this.aStep;
    while (this.aPhase >= 1) {
      this.aPhase -= 1;
      if (this.aLen < this.aBuf.length) this.aBuf[this.aLen++] = this.level;
    }
  }

  /* ---------------- video ---------------- */
  fillSeg(x, w, c, m) {
    const col = this.lineCol, msk = this.lineMask, end = Math.min(VP_W, x + w);
    for (let p = Math.max(0, x); p < end; p++) { col[p] = c; msk[p] |= m; }
  }

  plot(px, w, c, m) {
    const col = this.lineCol, msk = this.lineMask;
    for (let k = 0; k < w; k++) { const p = px + k; if (p >= 0 && p < VP_W) { col[p] = c; msk[p] |= m; } }
  }

  charLine(l, yr, xr, lo, attr) {
    const y = yr & 0xFE;
    if (!(y > 0 && y < 232 && xr < 157) || l < y) return;
    const yh = yr >> 1;
    let n = 7 - ((yh + lo) & 7); if (n === 0) n = 8;
    const row = (l - y) >> 1;
    if (row >= n) return;
    const d = VP_CSET[(lo + ((attr & 1) << 8) + yh + row) & 0x1FF];
    if (!d) return;
    const cl = vpSwapRB((attr >> 1) & 7) + 8, x0 = (xr - 8) * 2 + 20;
    for (let b = 0; b < 8; b++) if ((d & (0x80 >> b)) && xr - 8 + b < 160) this.plot(x0 + b * 2, 2, cl, 0x80);
  }

  quadLine(l, q) {
    const v = this.vdc, yr = v[q], xr = v[q + 1], y = yr & 0xFE;
    if (l < y) return;
    const yh = yr >> 1;
    let n = 7 - ((yh + v[q + 14]) & 7); if (n === 0) n = 8;    // height set by the 4th character
    const row = (l - y) >> 1;
    if (row >= n) return;
    const x0 = (xr - 8) * 2 + 20;
    for (let k = 0; k < 4; k++) {
      const lo = v[q + 2 + k * 4], at = v[q + 3 + k * 4];
      const d = VP_CSET[(lo + ((at & 1) << 8) + yh + row) & 0x1FF];
      if (!d) continue;
      const cl = vpSwapRB((at >> 1) & 7) + 8, xs = x0 + k * 32;
      for (let b = 0; b < 8; b++) if (d & (0x80 >> b)) this.plot(xs + b * 2, 2, cl, 0x80);
    }
  }

  spriteLine(l, s) {
    const v = this.vdc, base = s * 4;
    const y = v[base], x = v[base + 1] - 8, t = v[base + 2];
    if (!(x < 164 && y > 0 && y < 232)) return;
    const zoom = t & 0x04, rh = zoom ? 4 : 2, pw = zoom ? 4 : 2;
    const rel = l - y;
    if (rel < 0 || rel >= 8 * rh) return;
    const j = (rel / rh) | 0;
    let d = v[0x80 + s * 8 + j];
    if (!d) return;
    const sm = (((j & 1) === 0 && ((t >> 1) & 1) !== (t & 1)) || ((j & 1) === 1 && (t & 1))) ? 1 : 0;
    const cl = vpSwapRB((t >> 3) & 7) + 8, bit = 1 << s, x0 = x * 2 + 20 + sm, lim = zoom ? 159 : 160;
    for (let b = 0; b < 8; b++, d >>= 1) if ((d & 1) && x + b + sm < lim) this.plot(x0 + b * pw, pw, cl, bit);
  }

  renderLine(l) {
    const v = this.vdc, col = this.lineCol, msk = this.lineMask;
    const a0 = v[0xA0], a3 = v[0xA3], lum = (this.p1 & 0x80) ? 0 : 8;
    col.fill(((a3 >> 3) & 7) | lum);
    msk.fill(0);

    if (a0 & 0x08) {
      const gc = (a3 & 7) | ((a3 & 0x40) >> 3) | lum;
      const rel = l - 24;
      if (rel >= 0) {
        const j = (rel / 24) | 0, off = rel - j * 24;
        if (j <= 8 && off < 3) {
          if (a0 & 0x40) for (let i = 0; i < 9; i++) this.fillSeg(20 + i * 32, 4, gc, 0x20);
          for (let i = 0; i < 9; i++) {
            const on = j < 8 ? (v[0xC0 + i] >> j) & 1 : v[0xD0 + i] & 1;
            if (on) this.fillSeg(20 + i * 32, 36, gc, 0x20);
          }
        }
        if (j < 8) {
          const w = (a0 & 0x80) ? 32 : 4;
          for (let i = 0; i < 10; i++) if ((v[0xE0 + i] >> j) & 1) this.fillSeg(20 + i * 32, w, gc, 0x10);
        }
      }
    }

    if (a0 & 0x20) {
      for (let i = 0x10; i < 0x40; i += 4) this.charLine(l, v[i], v[i + 1], v[i + 2], v[i + 3]);
      for (let q = 0x40; q < 0x80; q += 0x10) this.quadLine(l, q);
      for (let s = 3; s >= 0; s--) this.spriteLine(l, s);
    }

    const fb = this.fb, pal = this.pal32, o = l * VP_W;
    const vpp = this.vpp;
    if (this.plusMode && vpp.active && l >= 5) {
      const mk = [0x01, 0x10, 0x04, 0x40, 0x02, 0x20, 0x08, 0x80], tra = vpp.tra;
      const vrow = (l - 5) * 320, vb = vpp.bmp;
      for (let x = 9; x < VP_W; x++) {
        const c = col[x], nc = vb[vrow + x - 9];
        if (!(tra & mk[c & 7])) col[x] = nc;
        else if (nc & 8) msk[x] |= 0x40;
      }
    }

    const ct = this.coltab;
    for (let x = 0; x < VP_W; x++) {
      const m = msk[x];
      if (m & (m - 1)) for (let b = 0; b < 8; b++) if (m & (1 << b)) ct[b] |= m;
      fb[o + x] = pal[col[x]];
    }
  }

  /* ---------------- save states ---------------- */
  getState() {
    const s = {};
    for (const k of ['pc', 'A', 'sp', 'cy', 'ac', 'f0', 'f1', 'bs', 'mb', 'savedMb', 'xien', 'tien', 'inIrq', 'tirq', 'tf',
      'timer', 'tmode', 'presc', 'p1', 'p2', 'romLatch', 'intActive', 'hpos', 'xLatch', 'yLatch', 'sndDiv', 'sndCnt', 'sndIrq'])
      s[k] = this[k];
    s.ram = Array.from(this.ram); s.extRam = Array.from(this.extRam); s.vdc = Array.from(this.vdc); s.coltab = Array.from(this.coltab);
    s.vpp = this.vpp.getState(); s.cartCrc = this.cartCrc; s.biosCrc = this.biosCrc; s.region = this.region;
    return s;
  }
  setState(s) {
    for (const k in s) if (typeof s[k] !== 'object' && !['cartCrc', 'biosCrc', 'region'].includes(k)) this[k] = s[k];
    this.ram.set(s.ram); this.extRam.set(s.extRam); this.vdc.set(s.vdc); this.coltab.set(s.coltab);
    this.vpp.setState(s.vpp);
    this.selectBank();
  }
}

if (typeof module !== 'undefined') module.exports = { Videopac, VideopacPlus, VP_W, VP_H, vpCrc32 };
