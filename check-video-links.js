const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('data/aicomic.db');

// Get all shots for project
const shots = db.prepare(`
  SELECT s.id, s.sequence, s.episode_id, e.name as ep_name
  FROM shots s
  LEFT JOIN episodes e ON s.episode_id = e.id
  WHERE s.project_id = ?
  ORDER BY s.sequence
`).all('SKB6CNwqAn5H');

console.log(`Total shots in project: ${shots.length}\n`);

// Get all video assets
const videoAssets = db.prepare(`
  SELECT shot_id, type, file_url, is_active
  FROM shot_assets
  WHERE type IN ('keyframe_video', 'reference_video')
`).all();

console.log(`Total video asset records: ${videoAssets.length}`);
console.log(`Active video assets: ${videoAssets.filter(a => a.is_active === 1).length}\n`);

// Check local files
const localFiles = fs.readdirSync('uploads/projects/SKB6CNwqAn5H/20260502-V1/videos').filter(f => f.endsWith('.mp4'));
console.log(`Local video files: ${localFiles.length}\n`);

// Check which local files are in shot_assets
const filesInDb = new Set(videoAssets.map(a => a.file_url));
const notInDb = localFiles.filter(f => {
  const fullPath = `uploads\\projects\\SKB6CNwqAn5H\\20260502-V1\\videos\\${f}`;
  return !filesInDb.has(fullPath);
});

console.log(`Files not in database: ${notInDb.length}`);
if (notInDb.length > 0 && notInDb.length <= 30) {
  console.log('These files need to be linked to shots:');
  notInDb.forEach(f => console.log(`  ${f}`));
}

db.close();
