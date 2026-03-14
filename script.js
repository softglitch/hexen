const fileInput = document.getElementById('fileInput');
const editor = document.getElementById('editor');
const output = document.getElementById('output');
const errorMessage = document.getElementById('errorMessage');
let imageType;

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

function stripHtmlTags(str) {
	return str.replace(/<[^>]*>/g, '');
}

function renderImage() {
	const hexString = stripHtmlTags(editor.innerHTML);
    console.log('Hex string to render:', hexString);
	if (!isValidHex(hexString)) {
		console.error('Invalid hex string');
		errorMessage.textContent = 'Invalid hex string';
		errorMessage.style.display = 'block';
		return;
	} else {
		errorMessage.style.display = 'none';
	}
	const bytes = unhexlify(hexString);
	const blob = new Blob([bytes], { type: imageType });
	output.src = URL.createObjectURL(blob);
}


fileInput.addEventListener('change', function(e) {
	const file = e.target.files[0];
	if (!file) return;
	const reader = new FileReader();

	reader.onload = function(e) {
		fileInput.value = '';
		fileInput.style.display = 'none';

		const bytes = new Uint8Array(e.target.result); // result is ArrayBuffer

		// Hex display
		const hexString = Array.from(bytes)
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');
		firstTwoBytes = hexString.slice(0, 4);
		restBytes = hexString.slice(4);
		editor.innerHTML = `<span class='header'>${firstTwoBytes}</span>${restBytes}`;
		renderImage();
	};

	reader.readAsArrayBuffer(file);
});

editor.addEventListener('input', renderImage);

console.log('Script loaded successfully!');
