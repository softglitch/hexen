const fileInput = document.getElementById('fileInput');
const headerEditor = document.getElementById('headerEditor');
const dataEditor = document.getElementById('dataEditor');
const output = document.getElementById('output');
const errorMessage = document.getElementById('errorMessage');
const uploadScreen = document.getElementById('uploadScreen');
const mainLayout = document.getElementById('mainLayout');
const dropZone = document.getElementById('dropZone');
const structureMap = document.getElementById('structureMap');
let imageType;
let splitOffset = 0; // hex char index where headerEditor ends / dataEditor begins

// ── Structure map ──────────────────────────────────────────────

function buildStructureJPEG(hex) {
    const segments = [];
    segments.push({ name: 'SOI', start: 0, end: 4, safety: 'danger', tip: 'Magic bytes — do not touch' });
    let offset = 4;

    while (offset < hex.length - 2) {
        if (hex.substr(offset, 2).toLowerCase() !== 'ff') break;

        const markerByte = hex.substr(offset + 2, 2).toLowerCase();

        if (markerByte === 'd9') {
            segments.push({ name: 'EOI', start: offset, end: offset + 4, safety: 'danger', tip: 'End of image — do not touch' });
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
            segments.push({ name: 'SOS', start: offset, end, safety: 'danger', tip: 'Start of scan header — leave alone' });
            segments.push({ name: 'Scan data', start: end, end: hex.length - 4, safety: 'interesting', tip: 'Compressed scan data — flip individual bytes for glitch effects, large changes will corrupt' });
            segments.push({ name: 'EOI', start: hex.length - 4, end: hex.length, safety: 'danger', tip: 'End of image — do not touch' });
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

        segments.push({ name, start: offset, end, safety, tip });
        offset = end;
    }
    return segments;
}

function buildStructurePNG(hex) {
    const segments = [];
    segments.push({ name: 'Signature', start: 0, end: 16, safety: 'danger', tip: 'PNG magic bytes — do not touch' });
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

        segments.push({ name: typeName, start: offset, end, safety, tip });
        offset = end;
    }
    return segments;
}

function renderStructureMap(segments, totalHexLen) {
    structureMap.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'smap-bar';

    segments.forEach(seg => {
        const size = seg.end - seg.start;
        const block = document.createElement('div');
        block.className = `smap-block smap-${seg.safety}`;
        block.style.flexGrow = size;

        const label = document.createElement('span');
        label.className = 'smap-label';
        label.textContent = seg.name;
        block.appendChild(label);

        const tooltip = document.createElement('div');
        tooltip.className = 'smap-tooltip';
        const byteStart = seg.start / 2;
        const byteEnd = seg.end / 2;
        tooltip.textContent = `${seg.name}  ${byteStart}–${byteEnd} B  •  ${seg.tip}`;
        block.appendChild(tooltip);
        block.addEventListener('click', () => highlightSegment(seg));
        block.addEventListener('mouseenter', () => {
            const tip = block.querySelector('.smap-tooltip');
            tip.style.left = '50%';
            tip.style.right = 'auto';
            tip.style.transform = 'translateX(-50%)';
            // Reset first so getBoundingClientRect is accurate
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

    // Scroll selection into view within the editor
    const selRect = range.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (selRect.top < elRect.top || selRect.bottom > elRect.bottom) {
        el.scrollTop += selRect.top - elRect.top - 16;
    }
}

function highlightSegment(seg) {
    if (seg.end <= splitOffset) {
        selectRange(headerEditor, seg.start, seg.end);
    } else if (seg.start >= splitOffset) {
        selectRange(dataEditor, seg.start - splitOffset, seg.end - splitOffset);
    } else {
        // spans the split — highlight what's in the header
        selectRange(headerEditor, seg.start, splitOffset);
    }
}

// ── Parse / split ──────────────────────────────────────────────

function parseJPEG(hexString) {
    let offset = 4; // skip SOI (FF D8)

    while (offset < hexString.length) {
        const marker = hexString.substr(offset, 4);
        offset += 4; // past the marker

        // SOS (FF DA) means everything after its segment is image data
        if (marker === 'ffda' || marker === 'FFDA') {
            const sosLength = parseInt(hexString.substr(offset, 4), 16) * 2;
            offset += sosLength; // skip SOS header
            console.log('SOS found at offset', offset);
            return {
                header: hexString.substr(0, offset),
                data: hexString.substr(offset)
            };
        }

        // Read segment length and skip past it
        const segLength = parseInt(hexString.substr(offset, 4), 16) * 2;
        offset += segLength;
    }
}

function parsePNG(hexString) {
    const SIGNATURE_LENGTH = 16; // 8 bytes = 16 hex chars
    let offset = SIGNATURE_LENGTH;

    while (offset < hexString.length) {
        // Read chunk length (4 bytes = 8 hex chars)
        const dataLength = parseInt(hexString.substr(offset, 8), 16) * 2;
        // Read chunk type (4 bytes = 8 hex chars)
        const chunkType = hexString.substr(offset + 8, 8);

        // Convert hex chunk type to ASCII
        const typeName = chunkType.match(/.{2}/g)
            .map(h => String.fromCharCode(parseInt(h, 16)))
            .join('');

        if (typeName === 'IDAT') {
            // Everything up to the first IDAT is header
            return {
                header: hexString.substr(0, offset),
                data: hexString.substr(offset)
            };
        }

        // Advance past: length(8) + type(8) + data + crc(8)
        offset += 8 + 8 + dataLength + 8;
    }

    // No IDAT found, treat it all as header
    return { header: hexString, data: '' };
}

function unhexlify(hexString) {
    // Strip any whitespace/newlines the user might have added
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

function getEditorText(el) {
    return el.innerText.replace(/\n/g, '');
}

function renderImage() {
    const hexString = getEditorText(headerEditor) + getEditorText(dataEditor);
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

        const parsed = imageType === 'image/jpeg' ? parseJPEG(hexString) : parsePNG(hexString);
        headerEditor.textContent = parsed.header;
        dataEditor.textContent = parsed.data;
        splitOffset = parsed.header.length;

        const segments = imageType === 'image/jpeg' ? buildStructureJPEG(hexString) : buildStructurePNG(hexString);
        renderStructureMap(segments, hexString.length);

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

headerEditor.addEventListener('input', debouncedRender);
dataEditor.addEventListener('input', debouncedRender);

console.log('Script loaded successfully!');
