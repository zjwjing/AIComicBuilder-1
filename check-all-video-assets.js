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

// Get ALL video assets for these shots (including inactive)
const shotIds = shots.map(s => s.id);
const placeholders = shotIds.map(() => '?').join(',');

const allAssets = db.prepare(`
  SELECT shot_id, type, file_url, is_active, id 
  FROM shot_assets 
  WHERE shot_id IN (${placeholders})
  AND type IN ('keyframe_video', 'reference_video')
  ORDER BY shot_id, is_active DESC
`).all(...shotIds);

console.log('All video assets (including inactive):', allAssets.length);
console.log('\nPer-shot status:');
for (const shot of shots) {
  const assets = allAssets.filter(a => a.shot_id === shot.id);
  const activeAsset = assets.find(a => a.is_active === 1);
  const inactiveAssets = assets.filter(a => a.is_active === 0);
  
  if (activeAsset) {
    console.log(`  Shot ${shot.sequence}: OK - ${activeAsset.file_url}`);
  } else if (assets.length > 0) {
    console.log(`  Shot ${shot.sequence}: HAS ASSETS BUT NOT ACTIVE (${assets.length} assets)`);
    assets.forEach(a => console.log(`    - ${a.file_url} (active=${a.is_active})`));
  } else {
    console.log(`  Shot ${shot.sequence}: NO ASSETS AT ALL`);
  }
}

db.close();
