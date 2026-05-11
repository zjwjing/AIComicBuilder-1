const https = require('https');
const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('data/aicomic.db');

const authToken = '01baddbDd8SsEEROab9Ct13KceH';
const baseUrl = 'https://s4t0d2mbyu-8188.cnb.run';

// Get all shots that need video (episode 51XKwFOv4jkF)
const shotsNeedingVideo = db.prepare(`
  SELECT s.id, s.sequence, s.episode_id
  FROM shots s
  WHERE s.episode_id = ?
  AND s.id NOT IN (
    SELECT DISTINCT shot_id FROM shot_assets 
    WHERE type IN ('keyframe_video','reference_video') AND is_active = 1
  )
  ORDER BY s.sequence
`).all('51XKwFOv4jkF');

console.log(`Shots needing video in episode 51XKwFOv4jkF: ${shotsNeedingVideo.length}\n`);
shotsNeedingVideo.forEach(s => console.log(`  Shot ${s.sequence} (${s.id})`));

// Get history from ComfyUI
const getHistory = () => {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'Authorization': `Bearer ${authToken}` } };
    https.get(`${baseUrl}/history?max_items=100`, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
};

// Get prompt details
const getPromptHistory = (promptId) => {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'Authorization': `Bearer ${authToken}` } };
    https.get(`${baseUrl}/history/${promptId}`, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
};

(async () => {
  console.log('\nFetching ComfyUI history...\n');
  const history = await getHistory();
  
  // Build mapping: filename -> promptId -> prompt details
  const fileToPrompt = new Map();
  
  for (const [promptId, promptData] of Object.entries(history)) {
    if (promptData.outputs) {
      for (const [nodeId, nodeOutput] of Object.entries(promptData.outputs)) {
        if (nodeOutput.Filenames) {
          for (const f of nodeOutput.Filenames) {
            if (!fileToPrompt.has(f.filename)) {
              fileToPrompt.set(f.filename, promptId);
            }
          }
        }
      }
    }
  }
  
  console.log(`Found ${fileToPrompt.size} video files in history\n`);
  
  // Get prompt details for each file
  const fileDetails = new Map();
  for (const [filename, promptId] of fileToPrompt) {
    try {
      const promptData = await getPromptHistory(promptId);
      const pd = promptData[promptId];
      if (pd && pd.prompt) {
        // Find the LoadImage nodes to get input images
        const loadImages = [];
        for (const [nodeId, node] of Object.entries(pd.prompt)) {
          if (node.class_type === 'LoadImage') {
            loadImages.push({
              nodeId,
              image: node.inputs?.image
            });
          }
        }
        fileDetails.set(filename, {
          promptId,
          loadImages,
          prompt: pd.prompt
        });
      }
    } catch (e) {
      console.log(`Error fetching ${promptId}:`, e.message);
    }
  }
  
  console.log('Video file details:');
  for (const [filename, details] of fileDetails) {
    console.log(`\n${filename}:`);
    console.log(`  Prompt: ${details.promptId}`);
    console.log(`  Input images:`, details.loadImages.map(i => i.image).join(', '));
  }
  
})().catch(err => console.error('Error:', err)).finally(() => db.close());
