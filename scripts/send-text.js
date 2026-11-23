const logger = require('../src/utils/logger');
const { loadConfig } = require('../src/config');
const WhatsAppService = require('../src/services/whatsapp.service');
const { delay, randomDelay } = require('../src/utils/delay');
const { formatForWhatsApp } = require('../src/utils/message-formatter');

function parseArgs() {
  const args = process.argv.slice(2);
  const map = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--keyword') {
      map.keyword = args[i + 1];
      i++;
    } else if (arg === '--group') {
      map.group = args[i + 1];
      i++;
    } else if (arg === '--message') {
      map.message = args[i + 1];
      i++;
    } else if (arg === '--dry-run') {
      map.dryRun = true;
    } else if (arg === '--min-delay-ms') {
      map.minDelayMs = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--max-delay-ms') {
      map.maxDelayMs = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--delay-ms') {
      const val = parseInt(args[i + 1], 10);
      map.minDelayMs = val;
      map.maxDelayMs = val;
      i++;
    }
  }

  return map;
}

async function main() {
  const {
    keyword,
    group,
    message,
    dryRun = false,
    minDelayMs,
    maxDelayMs,
  } = parseArgs();

  if (!message) {
    logger.error('Argumen --message wajib diisi.');
    process.exit(1);
  }

  if (!keyword && !group) {
    logger.error('Gunakan --keyword "<kata kunci>" atau --group "<nama grup>".');
    process.exit(1);
  }

  // Load config and allow keyword override
  const config = loadConfig();
  if (keyword) {
    config.groupKeyword = keyword;
  }

  // Override delay from CLI if provided (otherwise use config)
  const effectiveMinDelay =
    typeof minDelayMs === 'number' && !Number.isNaN(minDelayMs)
      ? minDelayMs
      : config.minDelayMs;
  const effectiveMaxDelay =
    typeof maxDelayMs === 'number' && !Number.isNaN(maxDelayMs)
      ? maxDelayMs
      : config.maxDelayMs;

  const whatsappService = new WhatsAppService(config);

  try {
    logger.info({ dryRun }, 'Inisialisasi WhatsApp client...');
    await whatsappService.initialize();
    const client = whatsappService.getClient();

    const targetGroups = [];

    if (group) {
      const found = await whatsappService.getSpecificGroup(group);
      if (!found) {
        logger.error({ group }, 'Grup tidak ditemukan.');
        process.exit(1);
      }
      targetGroups.push(found);
    } else {
      const matches = await whatsappService.getMatchingGroups();
      if (!matches || matches.length === 0) {
        logger.error({ keyword: config.groupKeyword }, 'Tidak ada grup yang cocok dengan keyword.');
        process.exit(1);
      }
      targetGroups.push(...matches);
    }

    logger.info(
      {
        totalTargets: targetGroups.length,
        minDelayMs: effectiveMinDelay,
        maxDelayMs: effectiveMaxDelay,
      },
      'Mengirim pesan teks ke grup.'
    );

    // Format message (preserve paragraphs, split if too long)
    const formattedMessages = formatForWhatsApp(message, {
      splitLongMessages: true,
    });

    logger.info(
      {
        totalGroups: targetGroups.length,
        messageChunks: formattedMessages.length,
        totalMessageLength: message.length,
      },
      'Pesan diformat dan siap dikirim.'
    );

    for (const [index, chat] of targetGroups.entries()) {
      if (dryRun) {
        logger.info(
          {
            group: chat.name,
            messageChunks: formattedMessages.length,
          },
          'DRY-RUN: pesan tidak dikirim.'
        );
        continue;
      }

      // Send all message chunks
      for (const [chunkIndex, chunk] of formattedMessages.entries()) {
        await client.sendMessage(chat.id._serialized, chunk);
        
        // Small delay between chunks (1-2 seconds) to ensure proper order
        if (chunkIndex < formattedMessages.length - 1) {
          await delay(1000 + Math.random() * 1000); // 1-2 seconds
        }
      }

      logger.info(
        {
          group: chat.name,
          chunksSent: formattedMessages.length,
        },
        'Pesan terkirim.'
      );

      // Delay sebelum kirim ke grup berikutnya (kecuali setelah grup terakhir)
      const isLast = index === targetGroups.length - 1;
      if (!isLast && effectiveMinDelay >= 0 && effectiveMaxDelay >= 0) {
        const waitMs = randomDelay(effectiveMinDelay, effectiveMaxDelay);
        logger.info(
          {
            group: chat.name,
            waitSeconds: (waitMs / 1000).toFixed(0),
          },
          'Menunggu sebelum kirim ke grup berikutnya.'
        );
        await delay(waitMs);
      }
    }

    logger.info('Selesai mengirim pesan.');
    process.exit(0);
  } catch (error) {
    logger.error({ error: error.message, stack: error.stack }, 'Gagal mengirim pesan.');
    process.exit(1);
  }
}

main();

