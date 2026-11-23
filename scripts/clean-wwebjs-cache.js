const fs = require('fs');
const path = require('path');

const authDir = path.join(process.cwd(), '.wwebjs_auth');
const cacheDir = path.join(process.cwd(), '.wwebjs_cache');

const args = process.argv.slice(2);
const force = args.includes('--force');

function ask(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (data) => {
      process.stdin.pause();
      resolve(data.toString().trim());
    });
  });
}

async function run() {
  if (!force) {
    const answer = await ask('Yakin hapus session lama? Kamu perlu scan QR ulang. (y/n) ');
    if (!['y', 'Y', 'yes', 'YES'].includes(answer)) {
      console.log('Batal menghapus session lama.');
      process.exit(0);
    }
  }

  for (const dir of [authDir, cacheDir]) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`Dihapus: ${dir}`);
    } else {
      console.log(`Tidak ditemukan: ${dir}`);
    }
  }

  console.log('Cache WWebJS sudah dibersihkan. Scan QR ulang ketika menjalankan bot lagi.');
}

run().catch((err) => {
  console.error('Gagal membersihkan cache:', err);
  process.exit(1);
});
