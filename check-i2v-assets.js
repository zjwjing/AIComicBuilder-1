const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const db = new Database('data/aicomic.db');

// Get all I2V video files in project directory
const videoDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';
const files = fs.readdirSync(videoDir).filter(f => f.startsWith('I2V_16F') || f.startsWith('I2V_'));
console.log(`I2V video files in project: ${files.length}\n`);

// Check which ones are already in shot_assets
const placeholders = files.map(() => '?').join(',');
const existingAssets = db.prepare(`
  SELECT shot_id, file_url, is_active, type
  FROM shot_assets
  WHERE file_url IN (${placeholders})
`).all(...files.map(f => `uploads\\projects\\SKB6CNwqAn5H\\20260502-V1\\videos\\${f}`));

console.log(`Existing records in shot_assets: ${existingAssets.length}`);
if (existingAssets.length > 0 && existingAssets.length <= 30) {
  existingAssets.forEach(r => {
    console.log(`  ${r.file_url}: shot=${r.shot_id}, active=${r.is_active}, type=${r.type}`);
  });
}

// Check all shot_assets for I2V videos (with different path format)
const allI2VAssets = db.prepare(`
  SELECT shot_id, file_url, is_active, type
  FROM shot_assets
  WHERE file_url LIKE '%I2V%'
`).all();

console.log(`\nAll I2V records in shot_assets: ${allI2VAssets.length}`);
if (allI2VAssets.length > 0 && allI2VAssets.length <= 30) {
  allI2VAssets.forEach(r => {
    console.log(`  ${r.file_url}: shot=${r.shot_id}, active=${r.is_active}, type=${r.type}`);
  });
}

db.close();
