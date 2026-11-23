const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const SHEET_AWB = 'AWB';
const SHEET_CP_TAG_MAPPING = 'CP_TAG_MAPPING';

/**
 * Normalize WA number from Excel (e.g. "62 88973279005" or "6288973279005") to format untuk @c.us
 */
function normalizeWaNumber(value) {
    if (!value) return '';
    let number = String(value).replace(/[\s().-]/g, '').replace(/^\+/, '');
    if (!/^\d+$/.test(number)) return '';
    if (number.startsWith('0')) {
        number = `62${number.slice(1)}`;
    } else if (!number.startsWith('62')) {
        number = `62${number}`;
    }
    return number.length >= 8 && number.length <= 15 ? number : '';
}

/**
 * Baca sheet AWB dan CP_TAG_MAPPING dari file Excel.
 * @param {string} filePath - Path ke file reminder.xlsx
 * @returns {{ reminders: Array<{awb, cp_name, group_key}>, cpTagMapping: Record<string, string> }}
 */
function readReminders(filePath) {
    try {
        if (!filePath) {
            throw new Error('EXCEL_FILE_PATH is not defined.');
        }

        const resolvedPath = path.resolve(filePath);
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Excel file does not exist: ${resolvedPath}`);
        }

        const workbook = XLSX.readFile(resolvedPath);
        const sheetNames = workbook.SheetNames;

        // --- Sheet AWB: No Resi, Sumber Order, Status Orderan, Alamat, Sprinter, CP_Name ---
        const awbSheet = sheetNames.find(s => s.trim().toUpperCase() === SHEET_AWB);
        if (!awbSheet) {
            throw new Error(`Required sheet "${SHEET_AWB}" was not found. Available sheets: ${sheetNames.join(', ') || '(none)'}`);
        }
        const awbWorksheet = workbook.Sheets[awbSheet];
        const awbData = XLSX.utils.sheet_to_json(awbWorksheet, { defval: '' });

        // Resolve nama kolom yang mungkin beda (spasi, BOM, dll): cari key yang cocok
        const firstRow = awbData[0];
        const keys = firstRow ? Object.keys(firstRow) : [];
        const getKey = (patterns) => {
            for (const p of patterns) {
                if (typeof p === 'string') {
                    const k = keys.find(k => k.trim() === p);
                    if (k) return k;
                } else {
                    const k = keys.find(k => p.test(String(k).trim()));
                    if (k) return k;
                }
            }
            return undefined;
        };
        const keyNoResi = getKey(['No Resi', 'No. Resi', 'AWB', /no\.?\s*resi|awb/i]) || keys[0];
        const keyCpName = getKey(['CP_Name', 'CP_NAME', 'CP Name', /cp[\s_]?name/i]) || keys[5];
        const keyStatus = getKey(['Status Orderan', 'Status Orderan', 'Status', /status/i]) || keys[2];

        const reminders = awbData.map(row => {
            const noResi = keyNoResi ? (row[keyNoResi] ?? '') : (row['No Resi'] ?? row['No. Resi'] ?? row['AWB'] ?? '');
            const cpNameRaw = keyCpName ? (row[keyCpName] ?? '') : (row['CP_Name'] ?? row['CP_NAME'] ?? '');
            const cpName = cpNameRaw ? String(cpNameRaw).trim() : '';
            const statusRaw = keyStatus ? (row[keyStatus] ?? '') : (row['Status Orderan'] ?? '');
            const status_orderan = statusRaw ? String(statusRaw).trim() : '';
            return {
                awb: noResi ? String(noResi).trim() : '',
                cp_name: cpName,
                group_key: cpName,
                status_orderan,
            };
        });

        // --- Sheet CP_TAG_MAPPING: CP_NAME, WA_NUMBER (untuk mention per grup) ---
        let cpTagMapping = {};
        const tagSheet = sheetNames.find(s => s.trim().toUpperCase() === SHEET_CP_TAG_MAPPING)
            || sheetNames.find(s => /cp.*tag|tag.*mapping/i.test(s.trim()));
        if (tagSheet) {
            const tagWorksheet = workbook.Sheets[tagSheet];
            const tagData = XLSX.utils.sheet_to_json(tagWorksheet, { defval: '' });
            for (const row of tagData) {
                const rowKeys = Object.keys(row);
                const findColumn = (pattern) => rowKeys.find(key => pattern.test(key.replace(/^\uFEFF/, '').trim()));
                const cpColumn = findColumn(/^CP[\s_]?NAME$/i);
                const numberColumn = findColumn(/^WA[\s_]?NUMBER$/i);
                const cpName = cpColumn ? row[cpColumn] : '';
                const waNumber = numberColumn ? row[numberColumn] : '';
                if (cpName) {
                    const key = String(cpName).trim();
                    const num = normalizeWaNumber(waNumber);
                    if (num) {
                        cpTagMapping[key.toUpperCase()] = num;
                    }
                }
            }
        }

        return { reminders, cpTagMapping, sheetNames, tagSheet: tagSheet || null };
    } catch (error) {
        console.error(`[EXCEL] Error reading ${filePath || '(empty path)'}:`, error.message);
        throw new Error(`Failed to read Excel file: ${error.message}`, { cause: error });
    }
}

module.exports = {
    readReminders,
    normalizeWaNumber,
};
