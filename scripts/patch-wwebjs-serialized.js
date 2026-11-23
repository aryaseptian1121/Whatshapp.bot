// NEW: patch kompatibilitas untuk breaking change WhatsApp Web
// _serialized -> $1 pada objek id (WA Web build 2.3000.1043xxx)
const fs = require('fs');
const path = require('path');

const targetFile = path.join(
    __dirname,
    '..',
    'node_modules',
    'whatsapp-web.js',
    'src',
    'util',
    'Injected',
    'Utils.js'
);

if (!fs.existsSync(targetFile)) {
    console.warn('[PATCH] File target tidak ditemukan, skip patch:', targetFile);
    process.exit(0);
}

let content = fs.readFileSync(targetFile, 'utf8');
const marker = '/* PATCHED: serialized-fallback */';

if (content.includes(marker)) {
    console.log('[PATCH] Sudah dipatch sebelumnya, skip.');
    process.exit(0);
}

// Ganti semua akses `.id._serialized` yang rawan undefined menjadi fallback
// yang toleran ke properti baru `$1` maupun `_serialized` lama.
const before = content;
content = content.replace(
    /chat\.id\._serialized/g,
    '(chat.id._serialized || chat.id.$1 || String(chat.id))'
);
content = content.replace(
    /msg\.id\._serialized/g,
    '(msg.id._serialized || msg.id.$1 || String(msg.id))'
);

if (content === before) {
    console.warn('[PATCH] Tidak ada pola yang cocok untuk diganti. Cek manual apakah struktur file berubah.');
} else {
    content = marker + '\n' + content;
    fs.writeFileSync(targetFile, content, 'utf8');
    console.log('[PATCH] Berhasil menambal Utils.js untuk kompatibilitas _serialized/$1.');
}
