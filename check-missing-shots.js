const Database = require('better-sqlite3');
const db = new Database('data/aicomic.db');

const episodeId = '51XKwFOv4jkF';

// Get shots without video assets
const shots = db.prepare(`
  SELECT s.id, s.sequence, s.status, s.duration
  FROM shots s
  WHERE s.episode_id = ?
  AND s.id NOT IN (
    SELECT DISTINCT shot_id 
    FROM shot_assets 
    WHERE type IN ('keyframe_video', 'reference_video') 
    AND is_active = 1
  )
  ORDER BY s.sequence
`).all(episodeId);

console.log(`Shots missing video: ${shots.length}\n`);

// Load legacy view for these shots
const shotIds = shots.map(s => s.id);
if (shotIds.length > 0) {
  const placeholders = shotIds.map(() => '?').join(',');
  
  // Get first/last frames from shot_assets
  const frameAssets = db.prepare(`
    SELECT shot_id, type, file_url, is_active
    FROM shot_assets
    WHERE shot_id IN (${placeholders})
    AND type IN ('first_frame', 'last_frame')
    AND is_active = 1
  `).all(...shotIds);
  
  console.log('First/Last frame status:');
  for (const shot of shots) {
    const firstFrame = frameAssets.find(a => a.shot_id === shot.id && a.type === 'first_frame');
    const lastFrame = frameAssets.find(a => a.shot_id === shot.id && a.type === 'last_frame');
    const hasFrames = firstFrame && lastFrame;
    console.log(`  Shot ${shot.sequence}: first=${firstFrame?.file_url ? 'YES' : 'NO'}, last=${lastFrame?.file_url ? 'YES' : 'NO'} (status: ${shot.status})`);
  }
}

db.close();
