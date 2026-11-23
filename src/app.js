require('dotenv').config(); // Load environment variables from .env

const path = require('path');
const fs = require('fs');
const { initializeWhatsAppClient } = require('./whatsapp');
const { readReminders } = require('./excel');
const { buildReminderMessagesGrouped } = require('./message');

let reminderProcessRunning = false; // FIX: prevent duplicate reminder runs from repeated ready events

// NEW: lock file supaya bot tidak bisa dijalankan dobel secara tidak
// sengaja (root cause pesan terkirim 2x ke setiap grup WhatsApp).
const LOCK_FILE = path.join(process.cwd(), '.bot.lock');

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0); // sinyal 0 = cuma cek exist, tidak benar2 kill
        return true;
    } catch {
        return false;
    }
}

function acquireLock() {
    if (fs.existsSync(LOCK_FILE)) {
        const oldPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
        if (oldPid && isProcessAlive(oldPid)) {
            console.error(`[APP] FATAL: Bot sudah berjalan di proses lain (PID ${oldPid}). Batalkan proses ini agar tidak terjadi pengiriman dobel ke semua grup.`);
            console.error(`[APP] Kalau yakin proses lama sudah mati/hang, hapus manual file: ${LOCK_FILE}`);
            process.exit(1);
        } else {
            console.warn(`[APP] Lock file lama ditemukan (PID ${oldPid} sudah tidak hidup), menimpa lock file.`);
        }
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf8');
    console.log(`[APP] Lock diperoleh (PID ${process.pid}). Instance lain tidak akan bisa jalan bersamaan.`);
}

function releaseLock() {
    try {
        if (fs.existsSync(LOCK_FILE)) {
            const lockedPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
            if (lockedPid === process.pid) {
                fs.unlinkSync(LOCK_FILE);
            }
        }
    } catch (err) {
        console.warn('[APP] Gagal menghapus lock file:', err?.message || err);
    }
}

acquireLock(); // NEW: panggil sebelum apapun lain dijalankan

/** Map Monitoring group name sesuai kolom CP_Name ke group ID. */
function loadGroupIdsMap() {
    const configPath = path.join(process.cwd(), 'config', 'group-ids.json');
    if (!fs.existsSync(configPath)) {
        console.warn(`[APP] Group mapping file not found: ${configPath}`);
        return {};
    }
    try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const data = JSON.parse(raw);
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
            console.warn(`[APP] Invalid group mapping format in ${configPath}; no groups will be resolved.`);
            return {};
        }
        return data;
    } catch (error) {
        console.warn(`[APP] Could not read group mapping ${configPath}: ${error.message}`);
        return {};
    }
}

function getTargetWhatsAppGroupName(cpName) {
    const key = String(cpName || '').trim();
    return key ? `Monitoring ${key}` : '';
}

function normalizeGroupName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isValidGroupId(value) {
    return typeof value === 'string' && value.trim().length > 0 && value.trim().endsWith('@g.us');
}

function loadExportedGroups() {
    const groupsPath = path.join(process.cwd(), 'groups.json');
    if (!fs.existsSync(groupsPath)) {
        console.warn(`[APP] groups.json not found at ${groupsPath}; only configured group mappings will be used.`);
        return [];
    }

    try {
        const groups = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
        if (!Array.isArray(groups)) {
            console.warn(`[APP] Invalid groups.json format at ${groupsPath}; expected an array.`);
            return [];
        }
        return groups;
    } catch (error) {
        console.warn(`[APP] Could not read groups.json: ${error.message}`);
        return [];
    }
}

function resolveGroupId(groupName, groupIdsMap, exportedGroups) {
    const normalizedTarget = normalizeGroupName(groupName);
    for (const [name, id] of Object.entries(groupIdsMap)) {
        if (normalizeGroupName(name) === normalizedTarget && isValidGroupId(id)) {
            return id.trim();
        }
    }

    const exportedGroup = exportedGroups.find(group =>
        group &&
        typeof group.name === 'string' &&
        normalizeGroupName(group.name) === normalizedTarget &&
        isValidGroupId(group.id)
    );
    return exportedGroup ? exportedGroup.id.trim() : '';
}

function getNameSimilarity(left, right) {
    const a = normalizeGroupName(left);
    const b = normalizeGroupName(right);
    if (!a || !b) return 0;
    if (a === b) return 1;

    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let row = 1; row <= a.length; row++) {
        const current = [row];
        for (let column = 1; column <= b.length; column++) {
            const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
            current[column] = Math.min(
                previous[column] + 1,
                current[column - 1] + 1,
                previous[column - 1] + substitutionCost
            );
        }
        previous = current;
    }
    return 1 - previous[b.length] / Math.max(a.length, b.length);
}

function getClosestCpNames(input, cpNames, limit = 5) {
    return [...new Set(cpNames)]
        .map(cpName => ({ cpName, similarity: getNameSimilarity(input, cpName) }))
        .sort((left, right) => right.similarity - left.similarity || left.cpName.localeCompare(right.cpName))
        .slice(0, limit);
}

function isTransientSendError(error) {
    const message = String(error?.message || error || '');
    return /timeout|timed out|execution context was destroyed|protocol error|target closed|frame was detached|navigation|temporar|econnreset|econnrefused|epipe|rate.?limit|\b429\b|disconnected|websocket/i.test(message);
}

function getTrimmedEnv(name) {
    return typeof process.env[name] === 'string' ? process.env[name].trim() : '';
}

async function runReadyDiagnostics(client) {
    const debugDir = path.join(process.cwd(), 'debug');
    fs.mkdirSync(debugDir, { recursive: true });
    const screenshotPath = path.join(debugDir, 'wa-ready-state.png');

    try {
        await client.pupPage.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[APP] DEBUG: captured WhatsApp ready screenshot at ${screenshotPath}`); // DIAGNOSTIC: capture current page state
    } catch (err) {
        console.warn('[APP] DEBUG: failed to capture WhatsApp ready screenshot:', err?.message || err);
    }

    try {
        const diagnostics = await client.pupPage.evaluate(() => {
            const moduleInfo = {
                hasRequire: typeof window.require === 'function',
                moduleLoaded: false,
                moduleError: null,
            };
            if (moduleInfo.hasRequire) {
                try {
                    moduleInfo.moduleLoaded = Boolean(window.require('WAWebCollections'));
                } catch (err) {
                    moduleInfo.moduleError = err?.message || String(err);
                }
            }

            return {
                title: document.title || '',
                url: window.location.href,
                contentLength: document.documentElement?.outerHTML?.length || 0,
                hasRequire: moduleInfo.hasRequire,
                moduleLoaded: moduleInfo.moduleLoaded,
                moduleError: moduleInfo.moduleError,
                wwebjsPresent: Boolean(window.WWebJS),
                requireType: typeof window.require,
            };
        });

        console.log('[APP] DEBUG: ready state diagnostics:', JSON.stringify(diagnostics, null, 2));
    } catch (err) {
        console.warn('[APP] DEBUG: failed to evaluate ready state diagnostics:', err?.message || err);
    }
}

async function processReminders(client) {
    if (reminderProcessRunning) {
        console.log('[APP] READY already processed; skipping duplicate reminder run.');
        return;
    }
    reminderProcessRunning = true;

    console.log('[APP] WhatsApp client READY');
    console.log('[APP] Reminder processing started');

    const sent = [];
    const skipped = [];
    const failed = [];
    let dryRunCount = 0;
    let totalTargetGroups = 0;

    try {
        await runReadyDiagnostics(client);

        const excelFilePath = process.env.EXCEL_FILE_PATH;
        if (!excelFilePath) {
            throw new Error('EXCEL_FILE_PATH is not defined in .env.');
        }

        console.log('[APP] Reading Excel file');
        const { reminders, cpTagMapping, sheetNames, tagSheet } = readReminders(excelFilePath);
        const awbCount = reminders.filter(reminder => reminder.awb).length;
        console.log(`[APP] AWB records found: ${awbCount} (sheet AWB)`);
        console.log(`[APP] CP mapping found: ${Object.keys(cpTagMapping).length} (sheet ${tagSheet || 'CP_TAG_MAPPING missing'})`);
        if (!tagSheet) {
            console.warn(`[APP] CP_TAG_MAPPING sheet was not found. Available sheets: ${sheetNames.join(', ')}. Reminders will be sent without mentions.`);
        }
        if (awbCount === 0) {
            console.warn('[APP] Sheet AWB contains no usable AWB records. Check the header row and No Resi values.');
            return;
        }

        const groupNameToReminders = new Map();
        for (const reminder of reminders) {
            const cpName = String(reminder.cp_name || reminder.group_key || '').trim();
            if (!cpName) continue;
            const targetGroupName = getTargetWhatsAppGroupName(cpName);
            if (!groupNameToReminders.has(targetGroupName)) {
                groupNameToReminders.set(targetGroupName, { cpName, items: [] });
            }
            groupNameToReminders.get(targetGroupName).items.push(reminder);
        }

        const groupIdsMap = loadGroupIdsMap();
        const exportedGroups = loadExportedGroups();
        console.log(`[APP] groups.json entries loaded: ${exportedGroups.length}`);
        let targetGroups = [...groupNameToReminders.entries()].map(([groupName, data]) => ({
            ...data,
            groupName,
            groupId: resolveGroupId(groupName, groupIdsMap, exportedGroups),
        }));

        const testGroupOnly = getTrimmedEnv('TEST_GROUP_ONLY');
        if (testGroupOnly) {
            targetGroups = targetGroups.filter(({ cpName, groupName, groupId }) =>
                [cpName, groupName, groupId].some(value =>
                    typeof value === 'string' && normalizeGroupName(value) === normalizeGroupName(testGroupOnly)
                )
            );
            console.log(`[APP] TEST_GROUP_ONLY active: ${targetGroups.length} matching group(s) for "${testGroupOnly}".`);
            if (targetGroups.length === 0) {
                console.warn(`[APP] TEST_GROUP_ONLY "${testGroupOnly}" did not match any CP name, target group name, or configured group ID.`);
                const suggestionInput = testGroupOnly.replace(/^Monitoring\s+/i, '');
                const suggestions = getClosestCpNames(suggestionInput, [...groupNameToReminders.values()].map(item => item.cpName));
                if (suggestions.length) {
                    console.warn(`[APP] Closest CP_Name suggestions: ${suggestions.map(item => `${item.cpName} (${(item.similarity * 100).toFixed(1)}%)`).join(', ')}`);
                }
            }
        }

        totalTargetGroups = targetGroups.length;
        console.log(`[APP] WhatsApp group mappings loaded: ${Object.keys(groupIdsMap).length}`);
        console.log(`[APP] Target groups identified: ${totalTargetGroups}`);

        const configuredDelayMs = Number.parseInt(getTrimmedEnv('SEND_DELAY_MS'), 10);
        const baseDelayMs = Number.isFinite(configuredDelayMs) && configuredDelayMs >= 0
            ? configuredDelayMs
            : 3000;
        const delayBetweenGroups = () => {
            const delayMs = Math.max(0, baseDelayMs + Math.floor(Math.random() * 2001) - 1000);
            return new Promise(resolve => setTimeout(resolve, delayMs));
        };
        const retryDelayMs = Number.parseInt(getTrimmedEnv('SEND_RETRY_DELAY_MS'), 10);
        const retryWaitMs = Number.isFinite(retryDelayMs) && retryDelayMs >= 0 ? retryDelayMs : 5000;
        const dryRun = getTrimmedEnv('DRY_RUN').toLowerCase() === 'true';

        for (let index = 0; index < targetGroups.length; index++) {
            const { cpName, groupName, groupId, items } = targetGroups[index];
            if (!groupId) {
                const reason = `grup "${groupName}" tidak ditemukan`;
                console.warn(`[APP] SKIP ${cpName}: ${reason}`);
                skipped.push({ name: cpName, reason });
                if (index < targetGroups.length - 1) await delayBetweenGroups();
                continue;
            }

            const groupedByStatus = { PUSAT_DISPATCH: [], DISPATCH: [] };
            const seenAwbs = new Set();
            for (const reminder of items) {
                const awb = String(reminder.awb || '').trim();
                const status = String(reminder.status_orderan || '').trim().toUpperCase();
                if (!awb || (status !== 'PUSAT_DISPATCH' && status !== 'DISPATCH') || seenAwbs.has(awb)) continue;
                seenAwbs.add(awb);
                groupedByStatus[status].push(awb);
            }

            const targetAwbCount = groupedByStatus.PUSAT_DISPATCH.length + groupedByStatus.DISPATCH.length;
            if (targetAwbCount === 0) {
                const reason = 'tidak ada AWB berstatus PUSAT_DISPATCH atau DISPATCH';
                console.warn(`[APP] SKIP ${cpName}: ${reason}`);
                skipped.push({ name: cpName, reason });
                if (index < targetGroups.length - 1) await delayBetweenGroups();
                continue;
            }

            const waNumber = cpName && (cpTagMapping[cpName] || cpTagMapping[cpName.toUpperCase()]);
            const mentions = waNumber ? [`${waNumber}@c.us`] : [];
            const messages = buildReminderMessagesGrouped(cpName, groupedByStatus);

            if (dryRun) {
                messages.forEach((message, partIndex) => {
                    const preview = message.slice(0, 100).replace(/\s+/g, ' ');
                    console.log(`[DRY RUN] akan kirim ke ${groupName} (${groupId}) [${partIndex + 1}/${messages.length}]: ${preview}...`);
                    dryRunCount++;
                });
                if (index < targetGroups.length - 1) await delayBetweenGroups();
                continue;
            }

            console.log(`[APP] Sending reminder to: ${groupName} (${targetAwbCount} AWB)${waNumber ? `, mention ${waNumber}` : ''}`);
            const maxRetries = 2;
            const groupErrors = [];
            for (let partIndex = 0; partIndex < messages.length; partIndex++) {
                let partSent = false;
                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    try {
                        await client.sendMessage(groupId, messages[partIndex], { mentions });
                        partSent = true;
                        console.log(`[APP] Message sent successfully: ${groupName} [${partIndex + 1}/${messages.length}]`);
                        break;
                    } catch (error) {
                        const message = error?.message || String(error);
                        if (isTransientSendError(error) && attempt < maxRetries) {
                            console.warn(`[APP] Retry ${attempt + 1}/${maxRetries} for ${groupName} [${partIndex + 1}/${messages.length}] after transient error: ${message}. Waiting ${retryWaitMs} ms.`);
                            await new Promise(resolve => setTimeout(resolve, retryWaitMs));
                            continue;
                        }

                        groupErrors.push(message);
                        console.error(`[APP] GAGAL kirim ke ${groupName} [${partIndex + 1}/${messages.length}]: ${message}`);
                        break;
                    }
                }

                if (!partSent && groupErrors.length === 0) {
                    groupErrors.push('Pengiriman gagal tanpa detail error.');
                }
                if (partIndex < messages.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
            if (groupErrors.length) failed.push({ name: cpName, reason: groupErrors.join('; ') });
            else sent.push(cpName);

            if (index < targetGroups.length - 1) await delayBetweenGroups();
        }
    } catch (error) {
        failed.push({ name: 'proses reminder', reason: error?.message || String(error) });
        console.error('[APP] Reminder processing failed:', error?.stack || error);
    } finally {
        console.log(`[APP] Reminder processing summary: total target=${totalTargetGroups}, terkirim=${sent.length}, dry-run=${dryRunCount}, di-skip=${skipped.length}, gagal=${failed.length}`);
        if (skipped.length) {
            console.log(`[APP] Grup di-skip: ${skipped.map(item => `${item.name} (${item.reason})`).join('; ')}`);
        }
        if (failed.length) {
            console.log(`[APP] Grup gagal: ${failed.map(item => `${item.name} (${item.reason})`).join('; ')}`);
        }
        console.log('[APP] Reminder processing completed');
    }
}

async function main() {
    console.log('[APP] Starting WhatsApp Reminder Bot...');

    const client = await initializeWhatsAppClient(processReminders);

    client.on('disconnected', (reason) => {
        console.warn(`[APP] Client disconnected: ${reason}. Restart the app if needed.`);
        // Consider graceful shutdown or restart logic here
    });

    // Handle process exit gracefully
    process.on('SIGINT', async () => {
        console.log('[APP] SIGINT received, destroying client and exiting...');
        if (client) {
            await client.destroy();
        }
        releaseLock(); // NEW
        process.exit(0);
    });

    process.on('exit', () => releaseLock()); // NEW: jaring pengaman terakhir
    process.on('uncaughtException', (err) => {
        console.error('[APP] FATAL: uncaughtException:', err?.message || err);
        releaseLock(); // NEW
        process.exit(1);
    });
}

main().catch((err) => {
    console.error('[APP] FATAL: main() gagal total:', err?.message || err);
    console.error('[APP] Stack:', err?.stack || 'no stack available');
    releaseLock(); // NEW: pastikan lock dilepas walau main() gagal
    process.exit(1);
});
