const Database = require('better-sqlite3');
const db = new Database('data/aicomic.db');

const episodeId = '51XKwFOv4jkF';

// Check stuck shots
const allShots = db.prepare(`
  SELECT sequence, id, status 
  FROM shots 
  WHERE episode_id = ?
  ORDER BY sequence
`).all(episodeId);

console.log('All shots status:');
allShots.forEach(s => console.log(`  Shot ${s.sequence}: ${s.status}`));

// Reset stuck shots to "failed" so they can be regenerated
const stuck = allShots.filter(s => s.status === 'generating');
if (stuck.length > 0) {
  console.log(`\nFound ${stuck.length} stuck shot(s):`);
  stuck.forEach(s => console.log(`  Shot ${s.sequence} (${s.id})`));
  
  const ids = stuck.map(s => s.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`
    UPDATE shots SET status = 'failed' WHERE id IN (${placeholders})
  `).run(...ids);
  console.log('\nReset to "failed" - ready for regeneration');
} else {
  console.log('\nNo stuck shots found');
}

db.close();
