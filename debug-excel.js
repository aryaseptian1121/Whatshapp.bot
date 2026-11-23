/**
 * Debug script to check Excel structure
 */

const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

console.log('=== Excel Structure Debug ===\n');

const excelPath = path.resolve(__dirname, 'assets/Reminder Reverse CP.xlsx');

if (!fs.existsSync(excelPath)) {
  console.error('❌ File not found:', excelPath);
  process.exit(1);
}

console.log('✅ File found:', excelPath);
console.log('');

try {
  const workbook = xlsx.readFile(excelPath);
  
  // List all sheets
  console.log('📋 Available Sheets:');
  Object.keys(workbook.Sheets).forEach((sheet, index) => {
    console.log(`   ${index + 1}. "${sheet}"`);
  });
  console.log('');

  // Check AWB sheet
  const sheetName = 'AWB';
  const worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet) {
    console.error(`❌ Sheet "${sheetName}" not found!`);
    console.log('Available sheets:', Object.keys(workbook.Sheets));
    process.exit(1);
  }

  console.log(`✅ Sheet "${sheetName}" found`);
  console.log('');

  // Convert to JSON
  const data = xlsx.utils.sheet_to_json(worksheet);
  console.log(`📊 Total rows: ${data.length}`);
  console.log('');

  if (data.length === 0) {
    console.warn('⚠️  No data rows found!');
    process.exit(0);
  }

  // Show first few rows
  console.log('📋 First 3 rows structure:');
  console.log('─'.repeat(60));
  data.slice(0, 3).forEach((row, index) => {
    console.log(`\nRow ${index + 1}:`);
    console.log(JSON.stringify(row, null, 2));
  });
  console.log('─'.repeat(60));
  console.log('');

  // Show all column names
  if (data.length > 0) {
    const columns = Object.keys(data[0]);
    console.log('📋 Column names found:');
    columns.forEach((col, index) => {
      console.log(`   ${index + 1}. "${col}"`);
    });
    console.log('');

    // Check for CP and AWB columns
    const cpColumn = 'DP Terjadwal';
    const awbColumn = 'No Resi';
    
    console.log('🔍 Checking expected columns:');
    console.log(`   Looking for CP column: "${cpColumn}"`);
    console.log(`   Found: ${columns.includes(cpColumn) ? '✅ YES' : '❌ NO'}`);
    console.log(`   Looking for AWB column: "${awbColumn}"`);
    console.log(`   Found: ${columns.includes(awbColumn) ? '✅ YES' : '❌ NO'}`);
    console.log('');

    // Try to find similar column names
    if (!columns.includes(cpColumn) || !columns.includes(awbColumn)) {
      console.log('⚠️  Expected columns not found. Similar column names:');
      const cpKeywords = ['cp', 'dp', 'terjadwal', 'nama'];
      const awbKeywords = ['resi', 'awb', 'no', 'nomor'];
      
      console.log('\n   Possible CP columns:');
      columns.forEach(col => {
        const lower = col.toLowerCase();
        if (cpKeywords.some(kw => lower.includes(kw))) {
          console.log(`      ✅ "${col}"`);
        }
      });
      
      console.log('\n   Possible AWB/Resi columns:');
      columns.forEach(col => {
        const lower = col.toLowerCase();
        if (awbKeywords.some(kw => lower.includes(kw))) {
          console.log(`      ✅ "${col}"`);
        }
      });
    }

    // Try to process with current column names
    console.log('\n🔍 Testing data processing:');
    const cpData = data.reduce((acc, row) => {
      const cpName = row[cpColumn];
      const awb = row[awbColumn];
      
      if (cpName && awb) {
        if (!acc[cpName]) {
          acc[cpName] = [];
        }
        acc[cpName].push(awb);
      }
      return acc;
    }, {});

    const cpNames = Object.keys(cpData);
    console.log(`   CPs found: ${cpNames.length}`);
    
    if (cpNames.length === 0) {
      console.log('\n   ⚠️  No CPs found. Checking why...');
      console.log(`   Rows with "${cpColumn}": ${data.filter(r => r[cpColumn]).length}`);
      console.log(`   Rows with "${awbColumn}": ${data.filter(r => r[awbColumn]).length}`);
      console.log(`   Rows with both: ${data.filter(r => r[cpColumn] && r[awbColumn]).length}`);
      
      // Show sample values
      console.log('\n   Sample values from first row:');
      if (data[0][cpColumn]) {
        console.log(`      "${cpColumn}": "${data[0][cpColumn]}"`);
      } else {
        console.log(`      "${cpColumn}": (empty or undefined)`);
      }
      if (data[0][awbColumn]) {
        console.log(`      "${awbColumn}": "${data[0][awbColumn]}"`);
      } else {
        console.log(`      "${awbColumn}": (empty or undefined)`);
      }
    } else {
      console.log(`   CPs: ${cpNames.join(', ')}`);
      console.log('\n   Sample CP data:');
      cpNames.slice(0, 3).forEach(cp => {
        console.log(`      ${cp}: ${cpData[cp].length} AWB(s)`);
      });
    }
  }

} catch (error) {
  console.error('❌ ERROR:', error.message);
  console.error(error.stack);
  process.exit(1);
}

console.log('\n✅ Debug completed!');

