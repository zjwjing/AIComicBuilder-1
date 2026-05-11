const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('data/aicomic.db');

// Get all episodes for this project
const episodes = db.prepare(`
  SELECT id, name, sequence 
  FROM episodes 
  WHERE project_id = ?
  ORDER BY sequence
`).all('SKB6CNwqAn5H');

console.log(`Project SKB6CNwqAn5H - ${episodes.length} episodes\n`);

let totalShots = 0;
let totalWithVideo = 0;

for (const ep of episodes) {
  const shots = db.prepare(`
    SELECT id, sequence, status 
    FROM shots 
    WHERE episode_id = ? 
    ORDER BY sequence
  `).all(ep.id);
  
  const shotIds = shots.map(s => s.id);
  const placeholders = shotIds.map(() => '?').join(',');
  
  let activeVideos = 0;
  if (shotIds.length > 0) {
    activeVideos = db.prepare(`
      SELECT COUNT(DISTINCT shot_id) as cnt
      FROM shot_assets
      WHERE shot_id IN (${placeholders})
      AND type IN ('keyframe_video', 'reference_video')
      AND is_active = 1
    `).get(...shotIds).cnt;
  }
  
  console.log(`Episode ${ep.sequence}: ${ep.name}`);
  console.log(`  Shots: ${shots.length}, With video: ${activeVideos}`);
  
  totalShots += shots.length;
  totalWithVideo += activeVideos;
}

console.log(`\nTotal: ${totalShots} shots, ${totalWithVideo} with video`);

// List all video files
const videoDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';
try {
  const files = fs.readdirSync(videoDir).filter(f => f.endsWith('.mp4'));
  console.log(`\nVideo files on disk: ${files.length}`);
} catch (e) {
  console.log('Error:', e.message);
}

db.close();
