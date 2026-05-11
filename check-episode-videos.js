const Database = require('better-sqlite3');
const db = new Database('data/aicomic.db');

const episodeId = '51XKwFOv4jkF';

// Get all shots for this episode
const shots = db.prepare(`
  SELECT id, sequence, status 
  FROM shots 
  WHERE episode_id = ? 
  ORDER BY sequence
`).all(episodeId);

console.log(`Episode ${episodeId} - Total shots: ${shots.length}\n`);

// Get active video assets for these shots
const shotIds = shots.map(s => s.id);
const placeholders = shotIds.map(() => '?').join(',');

const assets = db.prepare(`
  SELECT shot_id, type, file_url, is_active 
  FROM shot_assets 
  WHERE shot_id IN (${placeholders})
  AND type IN ('keyframe_video', 'reference_video')
  AND is_active = 1
`).all(...shotIds);

console.log('Video status per shot:');
let missingCount = 0;
for (const shot of shots) {
  const videoAsset = assets.find(a => a.shot_id === shot.id);
  const hasVideo = !!videoAsset;
  if (!hasVideo) missingCount++;
  console.log(`  Shot ${shot.sequence}: ${hasVideo ? 'OK - ' + videoAsset.file_url : 'MISSING'} (status: ${shot.status})`);
}

console.log(`\nSummary: ${shots.length - missingCount}/${shots.length} shots have video, ${missingCount} missing`);

db.close();
