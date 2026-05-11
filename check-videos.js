const Database = require('better-sqlite3');
const path = require('path');

const db = new Database('data/aicomic.db');

// Get all shots for the project
const shots = db.prepare(`
  SELECT id, sequence FROM shots 
  WHERE project_id = ? 
  ORDER BY sequence
`).all('SKB6CNwqAn5H');

console.log(`Total shots: ${shots.length}\n`);

// Get all video assets for these shots
const shotIds = shots.map(s => s.id);
const placeholders = shotIds.map(() => '?').join(',');

const assets = db.prepare(`
  SELECT shot_id, type, file_url, is_active 
  FROM shot_assets 
  WHERE shot_id IN (${placeholders})
  AND type IN ('keyframe_video', 'reference_video')
`).all(...shotIds);

console.log('Video assets in database:', assets.length);
assets.forEach(a => {
  console.log(`  Shot ${shots.find(s => s.id === a.shot_id)?.sequence || '?'}: type=${a.type}, active=${a.is_active}, url=${a.file_url}`);
});

// Check videos directory
const fs = require('fs');
const videoDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';
try {
  const files = fs.readdirSync(videoDir).filter(f => f.endsWith('.mp4'));
  console.log(`\nVideo files on disk: ${files.length}`);
  files.forEach(f => console.log(`  ${f}`));
} catch (e) {
  console.log('Error reading video dir:', e.message);
}

db.close();
