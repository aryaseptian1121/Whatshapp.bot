/**
 * Format CP name untuk tampilan (e.g. CP_ANCOL_BARAT_2 → "Ancol Barat 2")
 */
function cpNameToDisplayName(cpName) {
    if (!cpName) return '';
    return String(cpName)
        .replace(/^CP_/i, '')
        .replace(/_/g, ' ')
        .trim();
}

/**
 * Normalize status dari Excel ke key section (PUSAT_DISPATCH, DISPATCH, OTFPU, LAINNYA)
 */
function normalizeStatus(status) {
    if (!status) return 'LAINNYA';
    const s = String(status).toUpperCase().trim();
    if (/PUSAT_DISPATCH|PUSAT DISPATCH/.test(s)) return 'PUSAT_DISPATCH';
    if (/DISPATCH|BELUM DIJADWALKAN|KEJAR/.test(s)) return 'DISPATCH';
    if (/OTFPU|TIDAK ONTIME|TIDAK ONTIME|OTFP/.test(s)) return 'OTFPU';
    return 'LAINNYA';
}

function buildReminderMessagesGrouped(cpName, groupedByStatus) {
    const seenAwbs = new Set();
    const sections = [
        {
            key: 'PUSAT_DISPATCH',
            title: 'PUSAT_DISPATCH (Segera Jadwalkan ke Sprinter nya)',
            awbs: groupedByStatus.PUSAT_DISPATCH || [],
        },
        {
            key: 'DISPATCH',
            title: 'DISPATCH (Bantu push untuk pengambilan paketnya atau segera scan gagal pickup)',
            awbs: groupedByStatus.DISPATCH || [],
        },
    ].map(section => ({
        ...section,
        awbs: section.awbs
            .map(awb => String(awb || '').trim())
            .filter(awb => {
                if (!awb || seenAwbs.has(awb)) return false;
                seenAwbs.add(awb);
                return true;
            }),
    }));

    const totalAwb = sections.reduce((total, section) => total + section.awbs.length, 0);
    if (totalAwb === 0) return [];

    const header = `URGENT Berikut AWB yang belum terscan pickup atau scan gagal pickup *Layanan Pickup dan Drop Off Sumber order Magellan - Tokopedia-Kurirekomendasi Segera dieksekusi sebelum jam 23:00* Note Target OTPU 96.00% Target OTFPU 99.90% usahakan semua terpickup ya guys. untuk menghindari denda keterlambatan. Jika terjadi Late tanpa alasan >500 AWB maka akan langsung dikenakan WL pada H+1 : *CP: ${cpName}*`;
    const summary = `Total PUSAT_DISPATCH + DISPATCH: ${totalAwb}`;
    const pages = [];
    const renderedSectionTotals = new Set();

    function createPage() {
        const pageNumber = pages.length + 1;
        const body = pageNumber === 1
            ? `${header}\n\n${summary}`
            : `Lanjutan (999/999) - CP: ${cpName}`;
        const page = { body, awbCount: 0, sections: new Set() };
        pages.push(page);
        return page;
    }

    function appendSectionLine(page, section, line) {
        if (page.sections.has(section.key)) {
            return `${page.body}\n${line}`;
        }
        const total = renderedSectionTotals.has(section.key)
            ? ''
            : `Total AWB: ${section.awbs.length}\n`;
        return `${page.body}\n\n${section.title}\n${total}\n${line}`;
    }

    function addLine(section, line, countsAsAwb) {
        let page = pages[pages.length - 1] || createPage();
        let candidate = appendSectionLine(page, section, line);
        if (page.awbCount >= 150 || candidate.length > 3000) {
            page = createPage();
            candidate = appendSectionLine(page, section, line);
        }

        page.body = candidate;
        page.sections.add(section.key);
        renderedSectionTotals.add(section.key);
        if (countsAsAwb) page.awbCount++;
    }

    for (const section of sections) {
        if (section.awbs.length === 0) {
            addLine(section, '- (tidak ada)', false);
            continue;
        }
        section.awbs.forEach((awb, index) => {
            addLine(section, `${index + 1}. ${awb}`, true);
        });
    }

    return pages.map((page, index) => ({
        ...page,
        body: index === 0
            ? page.body
            : page.body.replace('Lanjutan (999/999)', `Lanjutan (${index + 1}/${pages.length})`),
    })).map(page => page.body);
}

function buildReminderMessageGrouped(cpName, groupedByStatus) {
    const messages = buildReminderMessagesGrouped(cpName, groupedByStatus);
    if (messages.length > 1) {
        throw new RangeError('Reminder requires multiple parts; use buildReminderMessagesGrouped().');
    }
    return messages[0] || '';
}

module.exports = {
    buildReminderMessageGrouped,
    buildReminderMessagesGrouped,
    cpNameToDisplayName,
    normalizeStatus,
};
