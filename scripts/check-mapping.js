require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { readReminders } = require('../src/excel');

function getTargetWhatsAppGroupName(cpName) {
    const key = String(cpName || '').trim();
    return key ? `Monitoring ${key}` : '';
}

function normalizeName(name) {
    return String(name || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function getSimilarity(left, right) {
    const a = normalizeName(left);
    const b = normalizeName(right);
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

function loadJson(filePath, label) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`${label} not found: ${filePath}`);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
    const excelFilePath = process.env.EXCEL_FILE_PATH;
    if (!excelFilePath) throw new Error('EXCEL_FILE_PATH is not defined in .env.');

    const groupIdsMap = loadJson(path.join(process.cwd(), 'config', 'group-ids.json'), 'Group mapping');
    const groups = loadJson(path.join(process.cwd(), 'groups.json'), 'Exported groups');
    if (Array.isArray(groupIdsMap) || typeof groupIdsMap !== 'object' || groupIdsMap === null) {
        throw new Error('Group mapping must be a JSON object.');
    }
    if (!Array.isArray(groups)) {
        throw new Error('groups.json must contain an array of groups.');
    }

    const { reminders } = readReminders(excelFilePath);
    const targetGroups = new Map();
    for (const reminder of reminders) {
        if (!reminder.awb) continue;
        const cpName = reminder.group_key || reminder.cp_name || '';
        const groupName = getTargetWhatsAppGroupName(cpName);
        if (groupName) targetGroups.set(groupName, cpName);
    }

    const suggestions = [];
    for (const [groupName, cpName] of targetGroups) {
        const configuredId = groupIdsMap[groupName];
        if (typeof configuredId === 'string' && configuredId.trim().endsWith('@g.us')) {
            continue;
        }

        const bestMatch = groups
            .filter(group => group && typeof group.name === 'string' && typeof group.id === 'string' && group.id.trim().endsWith('@g.us'))
            .map(group => ({ group, similarity: getSimilarity(groupName, group.name) }))
            .sort((left, right) => right.similarity - left.similarity)[0];

        const reason = typeof configuredId === 'string' && configuredId.trim()
            ? 'invalid group ID'
            : 'missing group mapping';
        const suggestion = {
            cpName,
            targetGroupName: groupName,
            reason,
            configuredGroupId: configuredId || null,
            suggestedGroupName: bestMatch?.group.name || null,
            suggestedGroupId: bestMatch?.group.id.trim() || null,
            similarity: bestMatch ? Number(bestMatch.similarity.toFixed(3)) : null,
        };
        suggestions.push(suggestion);
        console.log(`[CHECK] ${groupName}: ${suggestion.suggestedGroupName || 'no candidate'}${bestMatch ? ` (${(bestMatch.similarity * 100).toFixed(1)}%)` : ''}`);
    }

    const outputPath = path.join(process.cwd(), 'mapping-suggestions.json');
    fs.writeFileSync(outputPath, JSON.stringify(suggestions, null, 2), 'utf8');
    console.log(`[CHECK] Invalid or missing mappings: ${suggestions.length}/${targetGroups.size}`);
    console.log(`[CHECK] Suggestions saved to ${outputPath}; config/group-ids.json was not modified.`);
}

try {
    main();
} catch (error) {
    console.error('[CHECK] Mapping check failed:', error?.stack || error);
    process.exitCode = 1;
}
