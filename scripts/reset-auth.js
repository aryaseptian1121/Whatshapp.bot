/**
 * Reset WhatsApp Authentication
 * Deletes .wwebjs_auth folder to force re-authentication
 */

const fs = require('fs');
const path = require('path');

const AUTH_FOLDER = path.resolve(__dirname, '..', '.wwebjs_auth');

function resetAuth() {
  try {
    if (fs.existsSync(AUTH_FOLDER)) {
      console.log('Deleting .wwebjs_auth folder...');
      fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
      console.log('✅ Authentication folder deleted successfully');
      console.log('📱 Restart bot dan scan QR code yang muncul');
      return true;
    } else {
      console.log('ℹ️  .wwebjs_auth folder tidak ditemukan (sudah bersih)');
      return false;
    }
  } catch (error) {
    console.error('❌ Failed to delete authentication folder:', error.message);
    console.error('💡 Silakan hapus folder .wwebjs_auth secara manual');
    return false;
  }
}

// Run if called directly
if (require.main === module) {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔄 Reset WhatsApp Authentication');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const success = resetAuth();
  
  console.log('\n═══════════════════════════════════════════════════════════');
  if (success) {
    console.log('✅ Reset berhasil! Silakan restart bot.');
  } else {
    console.log('ℹ️  Tidak ada yang perlu di-reset atau terjadi error.');
  }
  console.log('═══════════════════════════════════════════════════════════\n');
  
  process.exit(success ? 0 : 1);
}

module.exports = { resetAuth };

