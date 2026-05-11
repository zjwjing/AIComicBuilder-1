const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const db = new Database('data/aicomic.db');

// Count all video assets (including inactive) for project SKB6CNwqAn5H
const allAssets = db.prepare(`
  SELECT sa.shot_id, sa.type, sa.file_url, sa.is_active, s.sequence, s.episode_id, e.name as episode_name
  FROM shot_assets sa
  JOIN shots s ON sa.shot_id = s.id
  LEFT JOIN episodes e ON s.episode_id = e.id
  WHERE s.project_id = ?
  AND sa.type IN ('keyframe_video', 'reference_video')
  ORDER BY s.sequence, sa.is_active DESC
`).all('SKB6CNwqAn5H');

console.log(`Total video asset records: ${allAssets.length}\n`);

// Group by episode
const byEpisode = {};
for (const a of allAssets) {
  const epKey = a.episode_id || 'no-episode';
  if (!byEpisode[epKey]) {
    byEpisode[epKey] = {
      name: a.episode_name || '(no name)',
      assets: []
    };
  }
  byEpisode[epKey].assets.push(a);
}

console.log('By episode:');
for (const [epId, data] of Object.entries(byEpisode)) {
  const active = data.assets.filter(a => a.is_active === 1).length;
  console.log(`  Episode ${epId} (${data.name}): ${data.assets.length} records, ${active} active`);
}

// Count unique video files on disk
const videoDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';
try {
  const files = fs.readdirSync(videoDir).filter(f => f.endsWith('.mp4'));
  console.log(`\nUnique video files on disk: ${files.length}`);
  console.log('Files:', files.join(', '));
} catch (e) {
  console.log('Error reading video dir:', e.message);
}

db.close();
