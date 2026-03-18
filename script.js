const fileInput = document.getElementById('fileInput');
const headerEditor = document.getElementById('headerEditor');
const dataEditor = document.getElementById('dataEditor');
const output = document.getElementById('output');
const errorMessage = document.getElementById('errorMessage');
const uploadScreen = document.getElementById('uploadScreen');
const mainLayout = document.getElementById('mainLayout');
const dropZone = document.getElementById('dropZone');
let imageType;

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

headerEditor.addEventListener('input', renderImage);
dataEditor.addEventListener('input', renderImage);

console.log('Script loaded successfully!');
