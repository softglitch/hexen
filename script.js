const fileInput = document.getElementById('fileInput');
const editor = document.getElementById('editor');
const output = document.getElementById('output');
const errorMessage = document.getElementById('errorMessage');
const uploadScreen = document.getElementById('uploadScreen');
const mainLayout = document.getElementById('mainLayout');
const dropZone = document.getElementById('dropZone');
const structureMap = document.getElementById('structureMap');
let imageType;
let currentSegments = [];
let undoStack = [];

// ── Segment colours ───────────────────────────────────────────

// Catppuccin Mocha palette
const SEGMENT_COLORS = {
    // JPEG
    'SOI':       '#f38ba8', // red
    'EOI':       '#f38ba8', // red
    'DHT':       '#eba0ac', // maroon
    'SOS':       '#fab387', // peach
    'Scan data': '#f9e2af', // yellow
    'DQT':       '#fab387', // peach
    'SOF':       '#cba6f7', // mauve
    'APP0':      '#89dceb', // sky
    'APP1':      '#89b4fa', // blue
    'COM':       '#b4befe', // lavender
    // PNG
    'Signature': '#f38ba8', // red
    'IHDR':      '#cba6f7', // mauve
    'IDAT':      '#f9e2af', // yellow
    'IEND':      '#f38ba8', // red
    'gAMA':      '#94e2d5', // teal
    'cHRM':      '#94e2d5', // teal
    'sRGB':      '#94e2d5', // teal
    'iCCP':      '#94e2d5', // teal
    'tEXt':      '#a6e3a1', // green
    'iTXt':      '#a6e3a1', // green
    'zTXt':      '#a6e3a1', // green
    'bKGD':      '#f5c2e7', // pink
    'pHYs':      '#f5e0dc', // rosewater
};

function segmentColor(name) {
    if (SEGMENT_COLORS[name]) return SEGMENT_COLORS[name];
    if (name.startsWith('APP')) return '#74c7ec'; // sapphire
    if (name.startsWith('FF'))  return '#9399b2'; // overlay2
    return '#bac2de'; // subtext1
}

// ── Structure map ──────────────────────────────────────────────

function buildStructureJPEG(hex) {
    const seg = (name, start, end, safety, tip) =>
        ({ name, start, end, safety, tip, color: segmentColor(name) });

    const segments = [];
    segments.push(seg('SOI', 0, 4, 'danger', 'Magic bytes — do not touch'));
    let offset = 4;

    while (offset < hex.length - 2) {
        if (hex.substr(offset, 2).toLowerCase() !== 'ff') break;

        const markerByte = hex.substr(offset + 2, 2).toLowerCase();

        if (markerByte === 'd9') {
            segments.push(seg('EOI', offset, offset + 4, 'danger', 'End of image — do not touch'));
            break;
        }

        const length = parseInt(hex.substr(offset + 4, 4), 16) * 2;
        const end = offset + 4 + length;

        let name, safety, tip;
        if (markerByte === 'db') {
            name = 'DQT'; safety = 'interesting';
            tip = 'Quantization table — modifying changes compression artifacts in interesting ways';
        } else if (markerByte === 'c0' || markerByte === 'c2') {
            name = 'SOF'; safety = 'interesting';
            tip = 'Frame header — contains image dimensions and color components';
        } else if (markerByte === 'c4') {
            name = 'DHT'; safety = 'danger';
            tip = 'Huffman table — changing this will corrupt large regions of the image';
        } else if (markerByte === 'da') {
            segments.push(seg('SOS', offset, end, 'danger', 'Start of scan header — leave alone'));
            segments.push(seg('Scan data', end, hex.length - 4, 'interesting', 'Compressed scan data — flip individual bytes for glitch effects, large changes will corrupt'));
            segments.push(seg('EOI', hex.length - 4, hex.length, 'danger', 'End of image — do not touch'));
            break;
        } else if (markerByte.startsWith('e')) {
            const n = parseInt(markerByte[1], 16);
            name = `APP${n}`; safety = 'safe';
            tip = n === 1 ? 'EXIF metadata — safe to modify' : 'Application metadata — safe to modify';
        } else if (markerByte === 'fe') {
            name = 'COM'; safety = 'safe'; tip = 'Comment — safe to modify';
        } else {
            name = `FF${markerByte.toUpperCase()}`; safety = 'safe'; tip = 'Segment';
        }

        segments.push(seg(name, offset, end, safety, tip));
        offset = end;
    }
    return segments;
}

function buildStructurePNG(hex) {
    const seg = (name, start, end, safety, tip) =>
        ({ name, start, end, safety, tip, color: segmentColor(name) });

    const segments = [];
    segments.push(seg('Signature', 0, 16, 'danger', 'PNG magic bytes — do not touch'));
    let offset = 16;

    while (offset < hex.length) {
        const dataLen = parseInt(hex.substr(offset, 8), 16) * 2;
        const chunkType = hex.substr(offset + 8, 8);
        const typeName = chunkType.match(/.{2}/g)
            .map(h => String.fromCharCode(parseInt(h, 16))).join('');
        const end = offset + 8 + 8 + dataLen + 8;

        let safety, tip;
        switch (typeName) {
            case 'IHDR': safety = 'interesting'; tip = 'Image header — dimensions, bit depth, color type'; break;
            case 'IDAT': safety = 'interesting'; tip = 'Compressed image data — flip bytes for glitch effects, large changes will corrupt'; break;
            case 'IEND': safety = 'danger';      tip = 'End of file marker — do not touch'; break;
            case 'gAMA':
            case 'cHRM':
            case 'sRGB':
            case 'iCCP': safety = 'safe'; tip = 'Color profile metadata — safe to modify'; break;
            case 'tEXt':
            case 'iTXt':
            case 'zTXt': safety = 'safe'; tip = 'Text metadata — safe to modify or remove'; break;
            case 'bKGD': safety = 'safe'; tip = 'Background color hint — safe to modify'; break;
            case 'pHYs': safety = 'safe'; tip = 'Pixel dimensions/DPI — safe to modify'; break;
            default:      safety = 'safe'; tip = `${typeName} chunk`;
        }

        segments.push(seg(typeName, offset, end, safety, tip));
        offset = end;
    }
    return segments;
}

function renderStructureMap(segments) {
    structureMap.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'smap-bar';

    segments.forEach(seg => {
        const size = seg.end - seg.start;
        const block = document.createElement('div');
        block.className = 'smap-block';
        block.style.flexGrow = size;
        block.style.color = seg.color;
        block.style.background = seg.color + '22';
        block.style.border = `1px solid ${seg.color}55`;

        const label = document.createElement('span');
        label.className = 'smap-label';
        label.textContent = seg.name;
        block.appendChild(label);

        const tooltip = document.createElement('div');
        tooltip.className = 'smap-tooltip';
        tooltip.textContent = `${seg.name}  ${seg.start / 2}–${seg.end / 2} B  •  ${seg.tip}`;
        block.appendChild(tooltip);

        block.addEventListener('click', () => selectRange(editor, seg.start, seg.end));
        block.addEventListener('mouseenter', () => {
            block.style.background = seg.color + '44';
            const tip = block.querySelector('.smap-tooltip');
            tip.style.left = '50%';
            tip.style.right = 'auto';
            tip.style.transform = 'translateX(-50%)';
            const tipRect = tip.getBoundingClientRect();
            const padding = 8;
            if (tipRect.left < padding) {
                tip.style.left = '0';
                tip.style.transform = 'none';
            } else if (tipRect.right > window.innerWidth - padding) {
                tip.style.left = 'auto';
                tip.style.right = '0';
                tip.style.transform = 'none';
            }
        });
        block.addEventListener('mouseleave', () => {
            block.style.background = seg.color + '22';
        });

        bar.appendChild(block);
    });

    structureMap.appendChild(bar);
}

// ── Segment selection ─────────────────────────────────────────

function getNodeAtOffset(container, targetOffset) {
    let pos = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        const len = node.nodeValue.length;
        if (pos + len >= targetOffset) return { node, offset: targetOffset - pos };
        pos += len;
    }
    return node ? { node, offset: node.nodeValue.length } : null;
}

function selectRange(el, startChar, endChar) {
    const s = getNodeAtOffset(el, startChar);
    const e = getNodeAtOffset(el, endChar);
    if (!s || !e) return;

    const range = document.createRange();
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);

    el.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const selRect = range.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (selRect.top < elRect.top || selRect.bottom > elRect.bottom) {
        el.scrollTop += selRect.top - elRect.top - 16;
    }
}

// ── Highlight ─────────────────────────────────────────────────

function buildHighlightedHTML(hexString, segments) {
    let html = '';
    let pos = 0;
    for (const seg of segments) {
        if (seg.start > pos) {
            html += escapeHtml(hexString.slice(pos, seg.start));
        }
        html += `<span style="color:${seg.color}">${escapeHtml(hexString.slice(seg.start, seg.end))}</span>`;
        pos = seg.end;
    }
    if (pos < hexString.length) {
        html += escapeHtml(hexString.slice(pos));
    }
    return html;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Glitch tools ──────────────────────────────────────────────

const glitchOp     = document.getElementById('glitchOp');
const glitchValue  = document.getElementById('glitchValue');
const glitchStride = document.getElementById('glitchStride');
const glitchRange  = document.getElementById('glitchRange');
const glitchApply  = document.getElementById('glitchApply');
const glitchUndo   = document.getElementById('glitchUndo');
const glitchValueGroup  = document.getElementById('glitchValueGroup');
const glitchStrideGroup = document.getElementById('glitchStrideGroup');

const OPS_NO_VALUE  = new Set(['null', 'reverse', 'sort', 'shuffle']);
const OPS_NO_STRIDE = new Set(['reverse', 'sort', 'shuffle']);

function updateGlitchUI() {
    const op = glitchOp.value;
    glitchValueGroup.style.display  = OPS_NO_VALUE.has(op)  ? 'none' : 'inline-flex';
    glitchStrideGroup.style.display = OPS_NO_STRIDE.has(op) ? 'none' : 'inline-flex';
}

function populateRangeDropdown(segments) {
    glitchRange.innerHTML = '';
    const all = document.createElement('option');
    all.value = '__all__';
    all.textContent = 'whole file';
    glitchRange.appendChild(all);
    segments.forEach(seg => {
        const opt = document.createElement('option');
        opt.value = seg.name;
        opt.textContent = seg.name;
        glitchRange.appendChild(opt);
    });

    // Default to the main data segment — safest place to experiment
    const dataSeg = segments.find(s => s.name === 'Scan data' || s.name === 'IDAT');
    if (dataSeg) glitchRange.value = dataSeg.name;
}

function applyGlitch() {
    const op     = glitchOp.value;
    const val    = parseInt(glitchValue.value || 'ff', 16) & 0xff;
    const stride = Math.max(1, parseInt(glitchStride.value) || 1);
    const rangeKey = glitchRange.value;

    const hex = editor.innerText.replace(/\n/g, '');
    const bytes = unhexlify(hex);

    let startByte, endByte;
    if (rangeKey === '__all__') {
        startByte = 0;
        endByte = bytes.length;
    } else {
        const seg = currentSegments.find(s => s.name === rangeKey);
        if (!seg) return;
        startByte = seg.start / 2;
        endByte   = seg.end   / 2;
    }

    // Save undo snapshot
    undoStack.push(hex);
    glitchUndo.disabled = false;

    switch (op) {
        case 'xor':
            for (let i = startByte; i < endByte; i += stride)
                bytes[i] ^= val;
            break;
        case 'add':
            for (let i = startByte; i < endByte; i += stride)
                bytes[i] = (bytes[i] + val) & 0xff;
            break;
        case 'sub':
            for (let i = startByte; i < endByte; i += stride)
                bytes[i] = (bytes[i] - val + 256) & 0xff;
            break;
        case 'set':
            for (let i = startByte; i < endByte; i += stride)
                bytes[i] = val;
            break;
        case 'null':
            bytes.fill(0, startByte, endByte);
            break;
        case 'reverse': {
            const slice = bytes.slice(startByte, endByte).reverse();
            bytes.set(slice, startByte);
            break;
        }
        case 'sort': {
            const slice = bytes.slice(startByte, endByte).sort();
            bytes.set(slice, startByte);
            break;
        }
        case 'shuffle': {
            for (let i = endByte - 1; i > startByte; i--) {
                const j = startByte + Math.floor(Math.random() * (i - startByte + 1));
                [bytes[i], bytes[j]] = [bytes[j], bytes[i]];
            }
            break;
        }
    }

    const newHex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    editor.innerHTML = buildHighlightedHTML(newHex, currentSegments);
    renderImage();
}

function undoGlitch() {
    if (!undoStack.length) return;
    const hex = undoStack.pop();
    editor.innerHTML = buildHighlightedHTML(hex, currentSegments);
    renderImage();
    glitchUndo.disabled = undoStack.length === 0;
}

const glitchRandom = document.getElementById('glitchRandom');
const downloadBtn  = document.getElementById('downloadBtn');

const RANDOM_OPS = ['xor', 'add', 'sub', 'xor', 'xor']; // weight XOR higher

function randomizeGlitch() {
    const op = RANDOM_OPS[Math.floor(Math.random() * RANDOM_OPS.length)];
    glitchOp.value = op;
    updateGlitchUI();

    const val = Math.floor(Math.random() * 255) + 1; // avoid 0
    glitchValue.value = val.toString(16).padStart(2, '0');

    // Stride: bias toward larger values to keep it non-destructive
    const strides = [2, 4, 8, 16, 32, 64];
    glitchStride.value = strides[Math.floor(Math.random() * strides.length)];
}

function downloadImage() {
    const a = document.createElement('a');
    a.href = output.src;
    const ext = imageType === 'image/jpeg' ? 'jpg' : 'png';
    a.download = `hexen-glitch.${ext}`;
    a.click();
}

glitchOp.addEventListener('change', updateGlitchUI);
glitchApply.addEventListener('click', applyGlitch);
glitchUndo.addEventListener('click', undoGlitch);
glitchRandom.addEventListener('click', randomizeGlitch);
downloadBtn.addEventListener('click', downloadImage);
updateGlitchUI();

// ── Core ──────────────────────────────────────────────────────

function unhexlify(hexString) {
    const clean = hexString.replace(/\s/g, '');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
        bytes[i / 2] = parseInt(clean.substr(i, 2), 16);
    }
    return bytes;
}

function isValidHex(str) {
    return /^[0-9a-fA-F]+$/.test(str.replace(/\s/g, ''));
}

function renderImage() {
    const hexString = editor.innerText.replace(/\n/g, '');
    if (!isValidHex(hexString)) {
        errorMessage.style.display = 'block';
        return;
    } else {
        errorMessage.style.display = 'none';
    }
    const bytes = unhexlify(hexString);
    const blob = new Blob([bytes], { type: imageType });
    output.src = URL.createObjectURL(blob);
}

function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();

    reader.onload = function(e) {
        const bytes = new Uint8Array(e.target.result);
        const hexString = Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

        imageType = file.type;
        console.log("imageType:", imageType);

        const segments = imageType === 'image/jpeg' ? buildStructureJPEG(hexString) : buildStructurePNG(hexString);
        currentSegments = segments;
        undoStack = [];
        glitchUndo.disabled = true;
        editor.innerHTML = buildHighlightedHTML(hexString, segments);
        renderStructureMap(segments);
        populateRangeDropdown(segments);

        uploadScreen.classList.add('hidden');
        mainLayout.classList.add('visible');

        renderImage();
    };

    reader.readAsArrayBuffer(file);
}

fileInput.addEventListener('change', function(e) {
    loadFile(e.target.files[0]);
    fileInput.value = '';
});

dropZone.addEventListener('dragover', function(e) {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', function() {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', function(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    loadFile(e.dataTransfer.files[0]);
});

let renderTimer;
function debouncedRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderImage, 400);
}

editor.addEventListener('input', debouncedRender);

console.log('Script loaded successfully!');
