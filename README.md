# Videopac G7400 Emulator

A browser emulator for the Philips Videopac G7000 and G7400 (Magnavox Odyssey² / Videopac+). It runs entirely in your browser: open the page, load a BIOS and a cartridge image, and play.

**Play it here: https://temik73.github.io/Videopac/**

## What it emulates

- Intel 8048 CPU, with bank-switched cartridges up to 16 KB
- Intel 8244/8245 video and sound chip: grid, characters, quads, sprites, collisions and sound
- EF9340/41 text and graphics chip of the G7400, used by Videopac+ games
- Alphanumeric keyboard (including the G7400 YES and NO keys) and both joystick ports

## Using it

1. Load a BIOS dumped from your own console: `o2rom.bin` (G7000 / Odyssey²) or `g7400.bin` (G7400).
2. Insert a cartridge image (`.bin`, `.rom`, or a `.zip` that contains one).
3. When the screen says SELECT GAME, press a number key. On a game controller, Start is 1 and Select is 2.

The BIOS and recent cartridges are remembered in your browser. Nothing is uploaded anywhere.

### Controls

- **Game controller:** d-pad or left stick moves, A, B, X or Y fires. Other buttons can be mapped to any Videopac key.
- **Keyboard:** arrow keys and Space (player 1), Numpad 8 4 6 2 and Numpad 0 (player 2). Letters and digits type on the Videopac keyboard.
- **Phones and tablets:** on-screen joystick and fire button. Turn the phone sideways to fill the screen.

### iPhone and iPad

Open the site in Safari, tap Share, then **Add to Home Screen**. Launched from the Home Screen it runs full screen without the Safari bars, and it keeps working offline.

## Source and building

The site is a single self-contained `index.html` built from the files in `src/`:

| File | Contents |
| --- | --- |
| `src/core.js` | 8048 CPU, 8244/8245 video and sound, EF9340/41 Videopac+ chip, cartridge banking |
| `src/charsets.js` | 8244 and EF9341 character tables |
| `src/ui.js` | Page logic: loading files, controllers, touch controls, audio, save states |
| `src/template.html` | Page layout and styles |
| `src/demo.js` | Built-in controller test that runs when no BIOS is loaded |
| `src/site_head.html`, `src/site_tail.html` | Standalone page head (Home Screen and offline settings) |
| `src/make_icons.py` | Draws the Home Screen icons |

To rebuild after changing a source file, run `node src/build.js` from the repository root. It rewrites `index.html`.

## Not included

No BIOS or game ROMs are included or distributed. Use dumps of hardware and cartridges you own.

## Credits

Hardware behaviour was cross-checked against [O2EM](https://github.com/libretro/libretro-o2em) (Daniel Boris, Andre de la Rocha, Arlindo M. de Oliveira and contributors). The 8244 and EF9341 character tables in this emulator are taken from O2EM, which is distributed under the Artistic License 2.0. Philips, Videopac and Odyssey² are trademarks of their respective owners; this project is not affiliated with them.
