require('dotenv').config();

const fs = require('fs');
const path = require('path');

const lockFile = path.join(process.cwd(), '.bot.lock');

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

if (fs.existsSync(lockFile)) {
    const pid = Number.parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
    if (pid && isProcessAlive(pid)) {
        console.error(`[EXPORT] Bot instance is running (PID ${pid}). Stop it before exporting WhatsApp groups.`);
        process.exit(1);
    }
    console.warn('[EXPORT] Stale or invalid .bot.lock found; continuing because no active bot process was detected.');
}

const { initializeWhatsAppClient, getClient } = require('../src/whatsapp');

async function main() {
    let client;
    let succeeded = false;

    try {
        let markReady;
        const ready = new Promise(resolve => {
            markReady = resolve;
        });

        await initializeWhatsAppClient(() => markReady());
        await ready;
        client = getClient();

        let chats;
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                chats = await client.getChats();
                break;
            } catch (error) {
                if (attempt === maxAttempts) {
                    throw new Error(`client.getChats() failed after ${maxAttempts} attempts: ${error.message || error}`);
                }
                const waitMs = 5000;
                console.warn(`[EXPORT] getChats attempt ${attempt}/${maxAttempts} failed: ${error.message || error}. Retrying in ${waitMs} ms.`);
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }

        const groups = chats
            .filter(chat => chat.isGroup)
            .map(chat => {
                const id = typeof chat.id === 'string' ? chat.id : chat.id?._serialized;
                return {
                    name: chat.name || chat.formattedTitle || '',
                    id: typeof id === 'string' ? id : '',
                };
            })
            .filter(group => group.name && group.id.endsWith('@g.us'));

        const outputPath = path.join(process.cwd(), 'groups.json');
        fs.writeFileSync(outputPath, JSON.stringify(groups, null, 2), 'utf8');
        console.log(`[EXPORT] Groups found: ${groups.length}`);
        console.log(`[EXPORT] Saved group list to ${outputPath}`);
        succeeded = true;
    } finally {
        client = client || getClient();
        if (client) {
            await client.destroy();
            console.log('[EXPORT] WhatsApp client closed.');
        }
        if (succeeded) process.exit(0);
    }
}

main().catch(error => {
    console.error('[EXPORT] Failed to export groups:', error?.stack || error);
    process.exitCode = 1;
});
