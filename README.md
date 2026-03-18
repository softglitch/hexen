# hexen

A browser-based hex editor for glitch artists. Load a JPEG or PNG, poke around in the raw bytes, and watch the image break in (hopefully) interesting ways.

## Features

- **Hex editor** — the full image as editable hex, color-coded by segment
- **Structure map** — visual byte map of the file's segments (hover for details, click to jump)
- **Glitch tools** — apply mathematical operations across any segment
- **Live preview** — image re-renders as you edit (debounced for large files)
- **Download** — save the glitched result

## Usage

Open `index.html` in a browser. No build step, no dependencies.

Drop a JPEG or PNG onto the upload screen (or click Browse). The file is parsed locally — nothing is uploaded anywhere.

## Understanding the colors

The structure map and editor use the same color coding:

| Color | Meaning |
|-------|---------|
| Red | Structural markers — changing these will likely break the file entirely |
| Peach / Yellow | Interesting to modify — produces visible artifacts |
| Green / Teal / Blue | Metadata — safe to change or remove |

**JPEG segments of note:**
- `DQT` — quantization tables. Modifying these changes how compression artifacts look. Great for subtle corruption.
- `Scan data` — the actual compressed image data. Flipping individual bytes here produces classic glitch patterns.
- `DHT` — Huffman tables. Touching these will corrupt large swathes of the image because the decoder loses sync.

**PNG segments of note:**
- `IDAT` — compressed image data, equivalent to JPEG scan data.
- `IHDR` — image dimensions and color type. Changing width/height produces interesting reinterpretation artifacts.

## Glitch tools

| Operation | Effect |
|-----------|--------|
| XOR | Flip bits. `XOR ff` inverts bytes, smaller values create subtle patterns |
| ADD / SUB | Shift byte values up or down |
| SET | Force every Nth byte to a fixed value |
| NULL | Zero out a range — blobs it out |
| Reverse | Mirror the bytes in a segment |
| Sort | Sort bytes ascending — creates smooth banding |
| Shuffle | Randomize bytes in a segment |

**Stride** controls which bytes are affected: `every 1 byte` hits everything, `every 16 bytes` creates a repeating pattern with most of the image intact.

Hit **Randomize** to get a random op/value/stride combination, then **Apply** to see what happens. **Undo** steps back through your history.

## Tips

- Start with `Scan data` / `IDAT` and a large stride (16–64) for subtle effects
- XOR with a low value like `01` or `03` every few bytes creates fine-grained noise
- Sort on a small range produces gradient bands
- Stack multiple operations with Undo as a safety net
- The header segments are worth exploring once you know what you're doing — changing `DQT` values in a JPEG can produce oil-painting-like softness

## License

GLWTS
