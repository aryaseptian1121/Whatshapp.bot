require('dotenv').config();

const path = require('path');
const fs = require('fs'); // FIX: add fs for cache inspection
const os = require('os');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { version: wwebjsVersion } = require('whatsapp-web.js/package.json'); // NEW: official package version for startup diagnostics
const qrcode = require('qrcode-terminal');

const isWindows = process.platform === 'win32' || os.platform() === 'win32';
if (isWindows && (!process.env.DEBUG_HEADLESS || !process.env.DEBUG_HEADLESS.trim())) {
    process.env.DEBUG_HEADLESS = 'true';
}

let client;
let clientReady = false;

function getDebugHeadlessSetting() {
    const rawValue = process.env.DEBUG_HEADLESS;
    if (typeof rawValue === 'string') {
        const normalized = rawValue.trim().toLowerCase();
        if (normalized === 'true') return { enabled: true, source: 'environment' };
        if (normalized === 'false') return { enabled: false, source: 'environment' };
        if (normalized) {
            console.warn(`[WHATSAPP] Invalid DEBUG_HEADLESS value "${rawValue}". Expected "true" or "false"; using the platform default.`);
        }
    }

    return {
        enabled: isWindows,
        source: isWindows ? 'Windows default' : 'non-Windows default',
    };
}

function getProtocolTimeoutMs() {
    const rawValue = process.env.PROTOCOL_TIMEOUT_MS;
    const trimmedValue = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!trimmedValue) return 600000;

    const timeoutMs = Number(trimmedValue);
    if (Number.isSafeInteger(timeoutMs) && timeoutMs > 0) return timeoutMs;

    console.warn(`[WHATSAPP] Invalid PROTOCOL_TIMEOUT_MS="${trimmedValue}". Using default 600000 ms.`);
    return 600000;
}

function parseUiInteractionSelectors() {
    const defaultSelectors = [
        '[data-testid="chat-list"]',
        '#pane-side',
        'div[role="grid"]',
        'div[aria-label="Chat list"]',
        '[data-testid="scrollable-chat-list"]',
    ];

    if (!process.env.UI_INTERACTION_SELECTORS) {
        return defaultSelectors;
    }

    return String(process.env.UI_INTERACTION_SELECTORS)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
}

async function triggerUIInteractionForLazyLoad(page) {
    if (!page) {
        console.warn('[WHATSAPP] WARNING: triggerUIInteractionForLazyLoad called without Puppeteer page'); // FIX: guard missing page object
        return;
    }

    const selectors = parseUiInteractionSelectors();
    const fallbackSelectors = [
        'header [role="button"]',
        '[data-testid="menu"]',
        '[aria-label="Menu"]',
        'span[data-icon="menu"]',
        'div[aria-label="Profile"]',
    ];

    const timeoutMs = 5000;
    const pollInterval = 500;
    const start = Date.now();
    let clickedSelector = null;

    while (Date.now() - start < timeoutMs) {
        const selectorFound = await page.evaluate((selectors) => {
            for (const selector of selectors) {
                if (document.querySelector(selector)) {
                    return selector;
                }
            }
            return null;
        }, selectors);

        if (selectorFound) {
            await page.evaluate((selector) => {
                const element = document.querySelector(selector);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    element.click();
                }
            }, selectorFound);
            clickedSelector = selectorFound;
            break;
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    if (!clickedSelector) {
        const fallbackSelector = await page.evaluate((fallbackSelectors) => {
            for (const selector of fallbackSelectors) {
                if (document.querySelector(selector)) {
                    return selector;
                }
            }
            return null;
        }, fallbackSelectors);

        if (fallbackSelector) {
            await page.evaluate((selector) => {
                const element = document.querySelector(selector);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    element.click();
                }
            }, fallbackSelector);
            clickedSelector = fallbackSelector;
        }
    }

    if (clickedSelector) {
        console.log(`[WHATSAPP] triggerUIInteractionForLazyLoad clicked selector ${clickedSelector}`); // FIX: log UI interaction selector used
        await new Promise(resolve => setTimeout(resolve, 1500)); // FIX: replaced page.waitForTimeout (removed in newer Puppeteer) with manual delay
    } else {
        console.warn('[WHATSAPP] WARNING: triggerUIInteractionForLazyLoad did not find any target selector in 5 seconds, continuing without UI interaction'); // FIX: non-blocking fallback
    }
}

// NEW: deteksi otomatis versi WA Web yang sudah ter-cache lokal (file .html
// di .wwebjs_cache), agar tidak perlu menebak nomor versi dari remote repo
// yang ternyata sudah tidak menyimpan versi lama.
function detectLocalCachedVersion(cachePath) {
    if (!fs.existsSync(cachePath)) return null;
    const htmlFiles = fs.readdirSync(cachePath).filter(f => f.endsWith('.html'));
    if (htmlFiles.length === 0) return null;
    // Ambil file yang paling lama (paling mungkin versi stabil pre-breaking-change)
    const withStats = htmlFiles.map(f => ({
        file: f,
        version: f.replace(/\.html$/, ''),
        mtimeMs: fs.statSync(path.join(cachePath, f)).mtimeMs,
    }));
    withStats.sort((a, b) => a.mtimeMs - b.mtimeMs);
    return withStats[0].version;
}

function inspectCacheDirectory(name, directoryPath) {
    if (!fs.existsSync(directoryPath)) {
        console.log(`[WHATSAPP] ${name} not found at ${directoryPath}`); // FIX: log missing cache directories explicitly
        return;
    }

    try {
        const files = fs.readdirSync(directoryPath);
        const stats = files.map(file => {
            const fullPath = path.join(directoryPath, file);
            const stat = fs.statSync(fullPath);
            return { file, mtimeMs: stat.mtimeMs, size: stat.size };
        });
        console.log(`[WHATSAPP] ${name} contents: ${files.length} item(s), last modified ${stats.length ? new Date(Math.max(...stats.map(s => s.mtimeMs))).toISOString() : 'n/a'}`); // FIX: show cache contents summary
        if (files.length > 0) {
            console.warn(`[WHATSAPP] WARNING: ${name} contains files and may include stale session/cache data. Run scripts/clean-wwebjs-cache.js --force if this is unexpected.`); // FIX: warn about stale cache
        }
    } catch (error) {
        console.warn(`[WHATSAPP] Failed to inspect ${name}:`, error?.message || error); // NEW: safe cache inspection
    }
}

async function initializeWhatsAppClient(onReady) {
    // Session disimpan di folder project agar tidak perlu scan QR setiap kali
    const authPath = path.join(process.cwd(), '.wwebjs_auth');
    const cachePath = path.join(process.cwd(), '.wwebjs_cache');
    inspectCacheDirectory('.wwebjs_auth', authPath);
    inspectCacheDirectory('.wwebjs_cache', cachePath);

    const debugHeadlessSetting = getDebugHeadlessSetting();
    const debugHeadless = debugHeadlessSetting.enabled;
    const puppeteerHeadless = !debugHeadless;
    const protocolTimeoutMs = getProtocolTimeoutMs();
    console.log(`[WHATSAPP] Chrome mode: ${puppeteerHeadless ? 'headless' : 'visible'} (puppeteer.headless=${puppeteerHeadless}; DEBUG_HEADLESS=${debugHeadless}; source=${debugHeadlessSetting.source}).`);
    console.log(`[WHATSAPP] Puppeteer protocol timeout: ${protocolTimeoutMs} ms.`);

    clientReady = false;
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: authPath }),
        webVersionCache: {
          type: 'none', // FIX: tidak perlu pin versi manual lagi; window.Store bukan masalahnya
        },
        authTimeoutMs: 90000, // FIX: naikkan dari default agar ada margin waktu lebih saat auth/handshake

        puppeteer: {
            headless: puppeteerHeadless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Corrected typo here
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--disable-gpu',
                '--incognito' // Try incognito mode
            ],
            timeout: 120000, // Increased timeout for Puppeteer operations
            protocolTimeout: protocolTimeoutMs,
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' // Set to use user's installed Chrome
        },
        // General timeout for client.initialize()
        timeout: 120000, // 2 minutes
    });

    client.on('qr', (qr) => {
        console.log('[WHATSAPP] QR RECEIVED');
        qrcode.generate(qr, { small: true });
    });

    client.on('loading_screen', (percent, message) => {
        console.log(`[WHATSAPP] Loading: ${percent}% - ${message}`); // NEW: visibilitas progres loading sebelum auth selesai/timeout
    });

    let readyCallbackStarted = false;
    client.on('ready', () => {
        clientReady = true;
        console.log('[WHATSAPP] Client is ready!');
        if (typeof onReady === 'function' && !readyCallbackStarted) {
            readyCallbackStarted = true;
            Promise.resolve().then(() => onReady(client)).catch(error => {
                console.error('[WHATSAPP] READY handler failed:', error?.stack || error);
            });
        }
    });

    client.on('authenticated', () => {
        console.log('[WHATSAPP] Authenticated!');
    });

    client.on('auth_failure', msg => {
        // Fired if session restore was unsuccessful
        console.error('[WHATSAPP] AUTHENTICATION FAILURE', msg);
    });

    client.on('disconnected', (reason) => {
        clientReady = false;
        console.log('[WHATSAPP] Client was disconnected!', reason);
        // Destroy and reinitialize if needed or exit
        // client.destroy();
        // initializeWhatsAppClient();
    });

    client.on('message', message => {
        // Optional: listen to messages if needed for debugging or interactive commands
        // if (message.body === '!ping') {
        //     message.reply('pong');
        // }
    });

    console.log('[WHATSAPP] Initializing client...');
    try {
        await client.initialize(); // FIX: dibungkus try/catch
    } catch (err) {
        console.error('[WHATSAPP] FATAL: client.initialize() gagal:', err?.message || err); // FIX: log detail error asli
        console.error('[WHATSAPP] Stack:', err?.stack || 'no stack available'); // FIX: log stack trace lengkap
        throw err; // tetap lempar agar caller (app.js) tahu proses gagal
    }
    try {
        const versionInfo = await client.pupPage.evaluate(() => {
            return {
                debugVersion: window.Debug?.VERSION || null,
                wwebjsPresent: Boolean(window.WWebJS),
            };
        });
        console.log(`[WHATSAPP] Version compatibility check: whatsapp-web.js=${wwebjsVersion || 'unknown'}, debug=${versionInfo.debugVersion || 'unknown'}, WWebJS injected=${versionInfo.wwebjsPresent}`); // FIX: remove obsolete window.Store diagnostics for whatsapp-web.js 1.34.7
    } catch (err) {
        console.warn('[WHATSAPP] Version compatibility check failed:', err?.message || err); // NEW: do not fail startup if version check fails
    }
    return client;
}

/**
 * Sends a message to a specific chat ID.
 * @param {string} chatId - The ID of the chat (e.g., '1234567890@c.us' for a contact, or '1234567890-12345678@g.us' for a group).
 * @param {string} message - The message content.
 * @param {object} [options] - Optional settings for the message.
 * @param {Array<string>} [options.mentions] - Array of contact IDs (e.g., '1234567890@c.us') to mention.
 */
async function sendMessage(chatId, message, options = {}) {
    if (!client || !clientReady || !client.pupPage) {
        throw new Error('WhatsApp client is not READY; refusing to send message.');
    }
    if (typeof chatId !== 'string' || !/^\d+(?:-\d+)?@g\.us$/.test(chatId)) {
        throw new Error(`Invalid WhatsApp group chat ID: ${String(chatId)}`);
    }
    if (typeof message !== 'string' || message.trim().length === 0) {
        throw new Error('Cannot send an empty WhatsApp message.');
    }

    const mentions = Array.isArray(options.mentions)
        ? options.mentions.map(id => (typeof id === 'string' && id.includes('@') ? id : `${id}@c.us`))
        : [];
    for (const mention of mentions) {
        if (!/^\d{8,15}@c\.us$/.test(mention)) {
            throw new Error(`Invalid WhatsApp mention ID: ${String(mention)}`);
        }
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // FIX: pakai API resmi client.sendMessage, bukan raw window.Store injection
            const sentMsg = await client.sendMessage(chatId, message, mentions.length ? { mentions } : {});
            console.log(`[WHATSAPP] Message sent to ${chatId} (attempt ${attempt}), id=${sentMsg?.id?._serialized || 'unknown'}`);
            return;
        } catch (err) {
            console.warn(`[WHATSAPP] sendMessage attempt ${attempt}/${maxAttempts} failed for ${chatId}:`, err?.message || err);
            if (attempt < maxAttempts) {
                const backoffMs = 1000 * Math.pow(2, attempt - 1);
                await new Promise(resolve => setTimeout(resolve, backoffMs));
            } else {
                throw new Error(`Failed to send message to ${chatId} after ${maxAttempts} attempts: ${err?.message || err}`);
            }
        }
    }
}

// NEW: versi getChats yang tahan terhadap error serialisasi per-chat
// (whatsapp-web.js 1.34.7 punya bug: beberapa chat gagal di-serialize
// karena breaking change WA Web terbaru, dan client.getChats() bawaan
// akan gagal TOTAL kalau ada satu saja chat yang error, karena pakai
// Promise.all). Fungsi ini mengisolasi kegagalan per-chat dan tetap
// mengembalikan chat-chat yang berhasil.
async function getChatsResilient(client) {
    if (!client?.pupPage) throw new Error('Client belum siap (pupPage tidak ada)');

    const result = await client.pupPage.evaluate(async () => {
        const chats = window.require('WAWebCollections').Chat.getModelsArray();
        const okChats = [];
        const failedChats = [];

        for (const chat of chats) {
            try {
                const model = await window.WWebJS.getChatModel(chat);
                okChats.push(model);
            } catch (err) {
                failedChats.push({
                    id: chat?.id?._serialized || chat?.id?.$1 || String(chat?.id) || 'unknown-id',
                    name: chat?.formattedTitle || chat?.name || '(tanpa nama)',
                    errorName: err?.name || typeof err,
                    errorMessage: err?.message || String(err),
                    errorStack: err?.stack || null,
                });
            }
        }

        return { okChats, failedChats, totalChats: chats.length };
    });

    console.log(`[WHATSAPP] getChatsResilient: ${result.okChats.length}/${result.totalChats} chat berhasil dimuat, ${result.failedChats.length} gagal.`);
    if (result.failedChats.length > 0) {
        console.warn('[WHATSAPP] Daftar chat yang GAGAL dimuat (detail error asli):');
        for (const f of result.failedChats.slice(0, 10)) {
            console.warn(`  - "${f.name}" (${f.id}) => [${f.errorName}] ${f.errorMessage}`);
        }
        if (result.failedChats.length > 10) {
            console.warn(`  ...dan ${result.failedChats.length - 10} chat gagal lainnya (disembunyikan agar log tidak terlalu panjang).`);
        }
    }

    return result.okChats.map(chat => ({
        id: chat.id,
        name: chat.formattedTitle || chat.name || '',
        isGroup: Boolean(chat.isGroup),
    }));
}

module.exports = {
    initializeWhatsAppClient,
    sendMessage,
    getClient: () => client, // Export client getter for app.js to attach 'ready' event listener
    getChatsResilient, // NEW
};
