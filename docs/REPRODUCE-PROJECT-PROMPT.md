# Prompt untuk Reproduksi Proyek WhatsApp Reminder Bot

Copy-paste prompt di bawah ini ke Cursor/AI untuk membuat proyek ini dari awal (tanpa error, library sudah benar).

---

## PROMPT (Copy mulai dari sini)

---

**Buatkan proyek WhatsApp Bot otomasi pengiriman reminder AWB Reverse dari file Excel ke grup WhatsApp. Project harus jalan tanpa error, dengan library yang benar.**

### Ringkasan Fitur

1. **WhatsApp Bot** – Menggunakan `whatsapp-web.js` (dari GitHub main branch) untuk mengirim pesan ke grup
2. **Excel Reader** – Membaca file Excel (`.xlsx`) dengan 2 sheet: **AWB** dan **CP_TAG_MAPPING**
3. **Reminder terkelompok** – Satu pesan per grup WhatsApp berisi semua AWB yang dikelompokkan per status (PUSAT_DISPATCH, DISPATCH, OTFPU, LAINNYA)
4. **@Mention** – Bisa tag nomor WA dari sheet CP_TAG_MAPPING di setiap pesan

### Library & Versi yang Harus Digunakan

```json
{
  "dependencies": {
    "dotenv": "^16.3.1",
    "qrcode-terminal": "^0.12.0",
    "whatsapp-web.js": "github:pedroslopez/whatsapp-web.js#main",
    "xlsx": "^0.18.5"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

**PENTING:** `whatsapp-web.js` harus dari `github:pedroslopez/whatsapp-web.js#main`, bukan versi npm lama.

### Struktur File Excel

**Sheet AWB** (kolom utama):
- `No Resi` / `No. Resi` / `AWB` – nomor resi
- `CP_Name` / `CP_NAME` – nama CP (e.g. CP_PLUIT_PERMAI, CP_ANCOL_BARAT_2)
- `Status Orderan` – status untuk pengelompokan

**Sheet CP_TAG_MAPPING** (optional):
- `CP_NAME` – nama CP
- `WA_NUMBER` – nomor WA untuk @mention (format: 62xxx atau 08xxx)

### Struktur Grup WhatsApp

- Nama grup harus: `Monitoring CP_NAMA_CP` (e.g. Monitoring CP_PLUIT_PERMAI)
- Bot mencari grup sesuai CP_Name dari Excel

### Format Pesan Reminder

Satu pesan per grup dengan format:

```
*Reminder AWB Reverse untuk CP: CP_NAMA_CP*

@628xxx (jika ada di CP_TAG_MAPPING)

*PUSAT_DISPATCH (Segera Jadwalkan ke Sprinter nya)*:
1. AWB001
2. AWB002

*DISPATCH (Bantu push untuk pengambilan paketnya)*:
1. AWB003

*OTFPU (Tidak Ontime) — Segera di pickup karena masuk penilaian hari ini*:
1. AWB004

Lainnya:
1. AWB005
```

### Mapping Status ke Section

- `PUSAT_DISPATCH` atau `PUSAT DISPATCH` → PUSAT_DISPATCH
- `DISPATCH`, `BELUM DIJADWALKAN`, `KEJAR` → DISPATCH
- `OTFPU`, `TIDAK ONTIME`, `OTFP` → OTFPU
- Lainnya → LAINNYA

### Konfigurasi

**File `.env`** (wajib):
```
EXCEL_FILE_PATH=./data/reminder.xlsx
DELAY_MIN_MS=8000
DELAY_MAX_MS=18000
```

**File `config/group-ids.json`** (optional – agar tidak perlu `getChats()`):
```json
{
  "Monitoring CP_PLUIT_PERMAI": "1234567890-1234567890@g.us",
  "Monitoring CP_ANCOL_BARAT_2": "1234567890-0987654321@g.us"
}
```

### Setup WhatsApp Client (whatsapp.js)

- Pakai `LocalAuth` dengan `dataPath: .wwebjs_auth` (session tersimpan, tidak perlu scan QR setiap kali)
- Pakai `webVersionCache` dengan `type: 'remote'` dan `remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'`
- Puppeteer: `headless: true`, args `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, `--disable-accelerated-2d-canvas`, `--no-first-run`, `--disable-gpu`, `--incognito`
- `executablePath`: sesuaikan Chrome path (Windows: `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`)
- Timeout: 120000 (2 menit)
- QR code tampil di terminal lewat `qrcode-terminal`

### Alur Kerja (app.js)

1. Load `.env`, init WhatsApp client
2. Saat `client.on('ready')`:
   - Baca Excel dari `EXCEL_FILE_PATH`
   - Jika ada `config/group-ids.json` dan semua grup ada di sana → skip `getChats()`
   - Jika tidak → tunggu 5 detik, panggil `client.getChats()` (dengan retry max 3x, delay 3s, 6s, 9s), cache grup by name
3. Kelompokkan reminder per CP (`Monitoring CP_NAMA_CP`)
4. Untuk tiap grup:
   - Kelompokkan AWB per status (PUSAT_DISPATCH, DISPATCH, OTFPU, LAINNYA)
   - Ambil nomor WA dari CP_TAG_MAPPING untuk @mention
   - Kirim 1 pesan ke grup dengan `sendMessage(chatId, message, { mentions: [...] })`
   - Delay acak antara `DELAY_MIN_MS` dan `DELAY_MAX_MS` (untuk hindari deteksi bot)
5. Bot tetap aktif setelah selesai (client tidak di-destroy)

### Excel Reader (excel.js)

- Kolom fleksibel: cari key dengan pattern (No Resi/AWB, CP_Name, Status Orderan) – handle BOM, spasi, variasi nama
- `normalizeWaNumber()`: bersihkan nomor WA (hilangkan spasi, +, pastikan format 62xxx)
- Return: `{ reminders: [{awb, cp_name, group_key, status_orderan}, ...], cpTagMapping: {CP_NAME: "62xxx"} }`

### Error Handling

- `getChats()` bisa gagal di awal: retry 3x dengan backoff
- Grup tidak ditemukan: skip dan log warning
- EXCEL_FILE_PATH tidak ada: error dan return

### Struktur Folder

```
wa-bot/
├── .env
├── .gitignore (include .wwebjs_auth, .env, node_modules)
├── package.json
├── data/
│   └── reminder.xlsx
├── config/
│   ├── group-ids.example.json
│   └── group-ids.json (optional, user buat)
├── src/
│   ├── app.js       (main, orchestration)
│   ├── whatsapp.js  (client init, sendMessage)
│   ├── excel.js     (readReminders, normalizeWaNumber)
│   └── message.js   (buildReminderMessageGrouped, normalizeStatus)
├── scripts/
│   └── reset-auth.js (hapus .wwebjs_auth untuk scan QR ulang)
└── create-dummy-excel.js (script buat file Excel contoh)
```

### Script create-dummy-excel.js

Buat file Excel contoh di `./data/reminder.xlsx` dengan:
- Sheet **AWB**: kolom `No Resi`, `CP_Name`, `Status Orderan`
- Sheet **CP_TAG_MAPPING**: kolom `CP_NAME`, `WA_NUMBER`
- Data dummy beberapa baris

### Script reset-auth.js

Hapus folder `.wwebjs_auth` agar bot meminta scan QR lagi saat restart.

---

**Setelah project dibuat, pastikan:**
1. `npm install` berjalan tanpa error
2. File `data/reminder.xlsx` ada (jalankan create-dummy-excel.js jika perlu)
3. `.env` berisi EXCEL_FILE_PATH yang benar
4. Jalankan `npm start` → scan QR di WhatsApp → bot kirim reminder ke grup yang cocok

---

## AKHIR PROMPT

---

*Dokumen ini dibuat agar project WhatsApp Reminder Bot dapat direproduksi dengan prompt yang sama. Terakhir diperbarui: Jan 2025.*
