const Database = require('better-sqlite3');
const db = new Database('data/aicomic.db');

const episodeId = '51XKwFOv4jkF';

// Get all shots and their active video status
const rows = db.prepare(`
  SELECT s.sequence, s.id, s.status, sa.file_url
  FROM shots s
  LEFT JOIN shot_assets sa ON s.id = sa.shot_id 
    AND sa.type IN ('keyframe_video','reference_video') 
    AND sa.is_active = 1
  WHERE s.episode_id = ?
  ORDER BY s.sequence
`).all(episodeId);

console.log('Shot status vs actual video assets:');
let needReset = [];
for (const r of rows) {
  const hasVideo = !!r.file_url;
  const isComplete = r.status === 'completed';
  console.log(`  Shot ${r.sequence}: status=${r.status}, hasVideo=${hasVideo}`);
  
  // Shots that are "completed" but have no video need reset
  if (isComplete && !hasVideo) {
    needReset.push(r);
  }
}

if (needReset.length > 0) {
  console.log(`\n${needReset.length} shots are "completed" but have no video:`);
  needReset.forEach(r => console.log(`  Shot ${r.sequence} (${r.id})`));
  
  const ids = needReset.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE shots SET status = 'failed' WHERE id IN (${placeholders})`).run(...ids);
  console.log('\nReset all these to "failed" for regeneration');
}

db.close();
