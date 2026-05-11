const Database = require('better-sqlite3');
const db = new Database('data/aicomic.db');

// Count ALL video records in shot_assets
const allRecords = db.prepare(`
  SELECT COUNT(*) as cnt
  FROM shot_assets
  WHERE type IN ('keyframe_video', 'reference_video')
`).get();

console.log(`Total video records in database: ${allRecords.cnt}\n`);

// Count by project
const byProject = db.prepare(`
  SELECT p.id, p.title, COUNT(sa.id) as cnt
  FROM shot_assets sa
  JOIN shots s ON sa.shot_id = s.id
  JOIN projects p ON s.project_id = p.id
  WHERE sa.type IN ('keyframe_video', 'reference_video')
  GROUP BY p.id
`).all();

console.log('By project:');
byProject.forEach(p => {
  console.log(`  ${p.title}: ${p.cnt} records`);
});

// Count active only
const activeRecords = db.prepare(`
  SELECT COUNT(*) as cnt
  FROM shot_assets
  WHERE type IN ('keyframe_video', 'reference_video')
  AND is_active = 1
`).get();

console.log(`\nTotal active video records: ${activeRecords.cnt}`);

db.close();
