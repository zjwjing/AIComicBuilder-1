const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('data/aicomic.db');

// Get all shots for project SKB6CNwqAn5H
const shots = db.prepare(`
  SELECT s.id, s.sequence, s.episode_id, e.name as ep_name
  FROM shots s
  LEFT JOIN episodes e ON s.episode_id = e.id
  WHERE s.project_id = ?
  ORDER BY s.sequence
`).all('SKB6CNwqAn5H');

console.log(`Total shots in project: ${shots.length}\n`);

// Get all video assets for these shots
const shotIds = shots.map(s => s.id);
const placeholders = shotIds.map(() => '?').join(',');

const videoAssets = db.prepare(`
  SELECT shot_id, type, file_url, is_active
  FROM shot_assets
  WHERE shot_id IN (${placeholders})
  AND type IN ('keyframe_video', 'reference_video')
`).all(...shotIds);

console.log(`Total video asset records: ${videoAssets.length}`);

// Check which shots have active video
const shotsWithVideo = new Set();
videoAssets.filter(a => a.is_active === 1).forEach(a => shotsWithVideo.add(a.shot_id));

console.log(`Shots with active video: ${shotsWithVideo.size}\n`);

// Check local files
const localFiles = new Set(fs.readdirSync('uploads/projects/SKB6CNwqAn5H/20260502-V1/videos').filter(f => f.endsWith('.mp4'))));
console.log(`Local video files: ${localFiles.size}\n`);

// Check episode 51XKwFOv4jkF specifically
console.log('Episode 51XKwFOv4jkF:');
const epShots = shots.filter(s => s.episode_id === '51XKwFOv4jkF');
console.log(`  Total shots: ${epShots.length}`);
let epWithVideo = 0;
epShots.forEach(s => {
  if (shotsWithVideo.has(s.id)) epWithVideo++;
});
console.log(`  Shots with video: ${epWithVideo}`);

db.close();
