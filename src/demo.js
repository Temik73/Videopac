// Builds the built-in "controller test" program that runs when no BIOS is loaded.
// Tiny 8048 assembler with labels; conditional jumps are checked for page crossings.
const CSET_CODE = { ' ': 12, '?': 13, L: 14, P: 15, '+': 16, W: 17, E: 18, R: 19, T: 20, U: 21, I: 22, O: 23, Q: 24, S: 25,
  D: 26, F: 27, G: 28, H: 29, J: 30, K: 31, A: 32, Z: 33, X: 34, C: 35, V: 36, B: 37, M: 38, '.': 39, '-': 40, '=': 43, Y: 44, N: 45, ':': 10 };
for (let i = 0; i < 10; i++) CSET_CODE[String(i)] = i;

function buildDemo() {
  const rom = new Uint8Array(1024);
  let pc = 0;
  const labels = {}, fix = [];
  const used = new Uint8Array(1024);
  const b = (...x) => { for (const v of x) { if (used[pc]) throw new Error('overlap at ' + pc.toString(16)); used[pc] = 1; rom[pc++] = v & 0xFF; } };
  const L = n => { labels[n] = pc; };
  const org = a => { pc = a; };
  const jmp = n => { fix.push({ at: pc, n, kind: 'jmp', op: 0x04 }); b(0, 0); };
  const call = n => { fix.push({ at: pc, n, kind: 'jmp', op: 0x14 }); b(0, 0); };
  const jc = (op, n) => { fix.push({ at: pc, n, kind: 'jc', op }); b(op, 0); };
  const JB = bit => 0x12 | (bit << 5), JNZ = 0x96, JZ = 0xC6;
  // instructions
  const movR = (r, v) => b(0xB8 + r, v), movA = v => b(0x23, v), movxW = () => b(0x90), movxR = () => b(0x80);
  const vdc = (reg, val) => { movR(0, reg); movA(val); movxW(); };

  const charPtr = (code, y) => { const p = (code * 8 - (y >> 1)) & 0x1FF; return [p & 0xFF, p >> 8]; };
  const single = (slot, y, x, ch, color) => {
    const [lo, hi] = charPtr(CSET_CODE[ch], y), r = 0x10 + slot * 4;
    vdc(r, y); vdc(r + 1, x); vdc(r + 2, lo); vdc(r + 3, (color << 1) | hi);
  };
  const quad = (n, y, x, text, color) => {
    const r = 0x40 + n * 16;
    vdc(r, y); vdc(r + 1, x);
    for (let k = 0; k < 4; k++) { const [lo, hi] = charPtr(CSET_CODE[text[k]], y); vdc(r + 2 + k * 4, lo); vdc(r + 3 + k * 4, (color << 1) | hi); }
  };

  const KEY_Y = 0xB0, KEY_X = 0x5E;

  org(0); jmp('start');
  org(3); b(0x93);           // RETR
  org(7); b(0x93);
  org(0x10); L('start');
  b(0x15, 0x35);             // DIS I, DIS TCNTI
  movA(0xB7); b(0x39);       // P1: select VDC
  vdc(0xA0, 0x00);
  vdc(0xA3, (1 << 3) | 7 | 0x40);  // blue background, bright white grid
  for (let i = 0; i < 9; i++) { vdc(0xC0 + i, 0x01); vdc(0xD0 + i, 0x01); }
  vdc(0xE0, 0xFF); vdc(0xE9, 0xFF);
  'NO BIOS'.split('').forEach((c, i) => single(i, 0x2C, 0x30 + i * 10, c, 6));
  quad(0, 0x50, 0x1E, 'JOYS', 7); quad(1, 0x50, 0x5E, 'TICK', 7);
  quad(2, 0x70, 0x1E, 'TEST', 3); quad(3, KEY_Y, 0x1E, 'KEY=', 7);
  single(11, KEY_Y, KEY_X, ' ', 6);
  [0x3C, 0x7E, 0xDB, 0xFF, 0xFF, 0xDB, 0x66, 0x3C].forEach((v, i) => vdc(0x80 + i, v));
  movR(2, 0x58); movR(3, 0x8C); movR(4, 12);   // R2 = x, R3 = y, R4 = key code (space)
  jmp('main');

  if (pc > 0x228) throw new Error('init too long ' + pc.toString(16));
  org(0x228); L('main');
  movR(0, 0xA1);
  L('w1'); movxR(); jc(JB(3), 'w1');          // wait until outside VBL
  L('w2'); movxR(); jc(JB(3), 'vbl'); jmp('w2');
  L('vbl');
  vdc(0xA0, 0x08);                             // foreground off while updating
  movA(0xFF); b(0x39); b(0x08); b(0xAE);       // P1=FF, INS A,BUS -> R6   (player 2 line)
  movA(0xFB); b(0x39); movA(0x01); b(0x3A); b(0x08, 0x5E, 0xAE); // P2=1, INS, ANL A,R6, MOV R6,A
  // keyboard scan (P1 bit2 low)
  movR(7, 0);
  L('kl'); b(0xFF, 0x3A, 0x0A);                // MOV A,R7; OUTL P2,A; IN A,P2
  jc(JB(4), 'kn');
  b(0x47, 0x77); b(0x53, 0x07); b(0xD3, 0x07); b(0xAD);   // SWAP, RR, ANL #7, XRL #7, MOV R5,A
  b(0xFF, 0xE7, 0xE7, 0xE7, 0x6D, 0xAC);       // MOV A,R7; RL x3; ADD A,R5; MOV R4,A
  jmp('kd');
  L('kn'); b(0x1F, 0xFF); b(0xD3, 0x06); jc(JNZ, 'kl');  // INC R7; MOV A,R7; XRL #6; JNZ
  L('kd');
  movA(0xB7); b(0x39);                         // select VDC again
  // movement (active-low bits: 0 up, 1 right, 2 down, 3 left, 4 fire)
  b(0xFE); jc(JB(0), 'nu'); b(0xCB, 0xCB);
  L('nu'); b(0xFE); jc(JB(2), 'nd'); b(0x1B, 0x1B);
  L('nd'); b(0xFE); jc(JB(3), 'nl'); b(0xCA);
  L('nl'); b(0xFE); jc(JB(1), 'nr'); b(0x1A);
  L('nr');
  movR(0, 0x00); b(0xFB, 0x90);                // sprite y = R3
  movR(0, 0x01); b(0xFA, 0x90);                // sprite x = R2
  movR(0, 0x02); b(0xFE); jc(JB(4), 'nf');
  movA(5 << 3); movxW();                       // fire: magenta sprite + tone
  vdc(0xA7, 0xF0); vdc(0xA8, 0xF0); vdc(0xA9, 0xF0); vdc(0xAA, 0xAA);
  jmp('kc');
  L('nf'); movA(2 << 3); movxW(); vdc(0xAA, 0x00);
  L('kc');
  movR(0, 0x3E); b(0xFC, 0xE3, 0x90);          // key char pointer from table
  movR(0, 0x3F); b(0xFC); b(0x03, 0x40); b(0xE3, 0x90);
  vdc(0xA0, 0x28);                             // grid + foreground on
  jmp('main'); L('endmain');

  // key-code -> character pointer tables (page 3)
  for (let code = 0; code < 64; code++) {
    let ch = code < 48 ? code : 12;
    if (code === 10 || code === 11) ch = { 10: 44, 11: 45 }[code];  // YES/NO keys shown as Y/N
    if (code === 46) ch = 41; if (code === 47) ch = 47;          // CLEAR -> x, ENTER -> block
    const [lo, hi] = charPtr(ch, KEY_Y);
    rom[0x300 + code] = lo; rom[0x340 + code] = (6 << 1) | hi;
  }

  for (const f of fix) {
    const t = labels[f.n];
    if (t === undefined) throw new Error('label ' + f.n);
    if (f.kind === 'jmp') { rom[f.at] = f.op | ((t >> 3) & 0xE0); rom[f.at + 1] = t & 0xFF; }
    else {
      if (((f.at + 1) & 0xF00) !== (t & 0xF00)) throw new Error('page cross ' + f.n);
      rom[f.at + 1] = t & 0xFF;
    }
  }
  if (labels.endmain > 0x300) throw new Error('main loop overflow');
  return rom;
}
if (typeof module !== 'undefined') module.exports = { buildDemo };
