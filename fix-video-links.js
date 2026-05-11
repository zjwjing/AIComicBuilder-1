const Database = require('better-sqlite3');
const path = require('path');

const db = new Database('data/aicomic.db');

// Check shots and their video status
const shots = db.prepare("SELECT id, sequence, video_url FROM shots WHERE project_id = ? ORDER BY sequence").all('SKB6CNwqAn5H');
console.log(`Total shots: ${shots.length}\n`);

// Check video assets
const assets = db.prepare(`
  SELECT shot_id, type, file_url, is_active 
  FROM shot_assets 
  WHERE shot_id IN (SELECT id FROM shots WHERE project_id = ?)
  AND type IN ('keyframe_video', 'reference_video')
`).all('SKB6CNwqAn5H');

console.log('Shot video status:');
let needsUpdate = [];

for (const shot of shots) {
  const videoAssets = assets.filter(a => a.shot_id === shot.id && a.is_active === 1);
  const hasAsset = videoAssets.length > 0;
  const hasUrl = !!shot.video_url;
  
  console.log(`Shot ${shot.sequence}: video_url=${shot.video_url || '(null)'}, assets=${videoAssets.length}`);
  
  // If has asset but no video_url, mark for update
  if (hasAsset && !hasUrl) {
    needsUpdate.push({ shotId: shot.id, sequence: shot.sequence, fileUrl: videoAssets[0].file_url });
  }
}

console.log(`\nShots needing video_url update: ${needsUpdate.length}`);
needsUpdate.forEach(item => {
  console.log(`  Shot ${item.sequence}: ${item.fileUrl}`);
});

// Update shots that have assets but no video_url
if (needsUpdate.length > 0) {
  const updateStmt = db.prepare("UPDATE shots SET video_url = ? WHERE id = ?");
  const transaction = db.transaction((items) => {
    for (const item of items) {
      updateStmt.run(item.fileUrl, item.shotId);
      console.log(`Updated shot ${item.sequence} with video_url`);
    }
  });
  transaction(needsUpdate);
  console.log('\nAll updates completed!');
}

db.close();
