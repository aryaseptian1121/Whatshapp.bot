const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

// Pastikan folder data ada
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Sheet AWB: No Resi, CP_Name, Status Orderan
const awbData = [
  { 'No Resi': 'AWB001', 'CP_Name': 'CP_PLUIT_PERMAI', 'Status Orderan': 'PUSAT_DISPATCH' },
  { 'No Resi': 'AWB002', 'CP_Name': 'CP_PLUIT_PERMAI', 'Status Orderan': 'DISPATCH' },
  { 'No Resi': 'AWB003', 'CP_Name': 'CP_ANCOL_BARAT_2', 'Status Orderan': 'OTFPU' },
  { 'No Resi': 'AWB004', 'CP_Name': 'CP_ANCOL_BARAT_2', 'Status Orderan': 'PUSAT_DISPATCH' },
  { 'No Resi': 'AWB005', 'CP_Name': 'CP_PLUIT_PERMAI', 'Status Orderan': 'BELUM DIJADWALKAN' },
];

// Sheet CP_TAG_MAPPING: CP_NAME, WA_NUMBER (untuk @mention)
const tagData = [
  { CP_NAME: 'CP_PLUIT_PERMAI', WA_NUMBER: '6288973279005' },
  { CP_NAME: 'CP_ANCOL_BARAT_2', WA_NUMBER: '62 8123456789' },
];

const wb = xlsx.utils.book_new();
const wsAwb = xlsx.utils.json_to_sheet(awbData);
const wsTag = xlsx.utils.json_to_sheet(tagData);

xlsx.utils.book_append_sheet(wb, wsAwb, 'AWB');
xlsx.utils.book_append_sheet(wb, wsTag, 'CP_TAG_MAPPING');

const outPath = path.join(dataDir, 'reminder.xlsx');
xlsx.writeFile(wb, outPath);

console.log(`[OK] Dummy Excel dibuat: ${outPath}`);
