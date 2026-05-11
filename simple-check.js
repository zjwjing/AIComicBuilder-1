const Database = require('better-sqlite3');
const db = new Database('data/aicomic.db');

// Get all shots for project
const shots = db.prepare(`
  SELECT id, sequence, episode_id 
  FROM shots 
  WHERE project_id = ?
  ORDER BY sequence
`).all('SKB6CNwqAn5H');

console.log(`Total shots: ${shots.length}\n`);

// Get all video assets
const videoAssets = db.prepare(`
  SELECT shot_id, file_url, is_active, type
  FROM shot_assets
  WHERE type IN ('keyframe_video', 'reference_video')
  AND is_active = 1
`).all();

console.log(`Active video assets: ${videoAssets.length}\n`);

// Check which shots have video
const shotsWithVideo = new Set(videoAssets.map(a => a.shot_id));
console.log('Shots with video:');
shots.forEach(s => {
  if (shotsWithVideo.has(s.id)) {
    const asset = videoAssets.find(a => a.shot_id === s.id);
    console.log(`  Shot ${s.sequence}: OK (${asset.file_url})`);
  }
});

console.log(`\nSummary: ${shotsWithVideo.size}/${shots.length} shots have video`);

db.close();
