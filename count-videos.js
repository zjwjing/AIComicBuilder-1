const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('data/aicomic.db');

// Count all video asset records for project
const allAssets = db.prepare(`
  SELECT sa.shot_id, sa.type, sa.file_url, sa.is_active, s.sequence, s.episode_id
  FROM shot_assets sa
  JOIN shots s ON sa.shot_id = s.id
  WHERE s.project_id = ?
  AND sa.type IN ('keyframe_video', 'reference_video')
`).all('SKB6CNwqAn5H');

console.log(`Total video asset records: ${allAssets.length}\n`);

// Count active only
const activeAssets = allAssets.filter(a => a.is_active === 1);
console.log(`Active video assets: ${activeAssets.length}\n`);

// Group by episode
const byEpisode = {};
for (const a of allAssets) {
  const epId = a.episode_id || 'no-episode';
  if (!byEpisode[epId]) byEpisode[epId] = { total: 0, active: 0, shots: new Set() };
  byEpisode[epId].total++;
  if (a.is_active === 1) byEpisode[epId].active++;
  byEpisode[epId].shots.add(a.shot_id);
}

console.log('By episode:');
for (const [epId, data] of Object.entries(byEpisode)) {
  console.log(`  Episode ${epId}: ${data.total} records (${data.active} active), ${data.shots.size} unique shots`);
}

// Count unique video files on disk
const videoDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';
try {
  const files = fs.readdirSync(videoDir).filter(f => f.endsWith('.mp4'));
  console.log(`\nUnique video files on disk: ${files.length}`);
} catch (e) {
  console.log('Error reading video dir:', e.message);
}

db.close();
