const https = require('https');
const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('data/aicomic.db');

const authToken = '01baddbDd8SsEEROab9Ct13KceH';
const baseUrl = 'https://s4t0d2mbyu-8188.cnb.run';

// Get history
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

// Get specific prompt
const getPrompt = (promptId) => {
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
  console.log('Fetching ComfyUI history...\n');
  const history = await getHistory();
  
  // Get all shots needing video in episode 51XKwFOv4jkF
  const shotsNeedingVideo = db.prepare(`
    SELECT id, sequence FROM shots 
    WHERE episode_id = ? 
    AND id NOT IN (
      SELECT DISTINCT shot_id FROM shot_assets 
      WHERE type IN ('keyframe_video','reference_video') AND is_active = 1
    )
    ORDER BY sequence
  `).all('51XKwFOv4jkF');
  
  console.log(`Shots needing video: ${shotsNeedingVideo.length}`);
  shotsNeedingVideo.forEach(s => console.log(`  Shot ${s.sequence} (${s.id})`));
  
  // Build video -> promptId mapping from history
  const videoToPrompt = new Map();
  for (const [promptId, promptData] of Object.entries(history)) {
    if (promptData.outputs) {
      for (const [nodeId, nodeOutput] of Object.entries(promptData.outputs)) {
        if (nodeOutput.Filenames) {
          for (const f of nodeOutput.Filenames) {
            if (!videoToPrompt.has(f.filename)) {
              videoToPrompt.set(f.filename, promptId);
            }
          }
        }
      }
    }
  }
  
  console.log(`\nFound ${videoToPrompt.size} videos in history\n`);
  
  // Get details for each prompt to find shot mapping
  // The prompt ID might be stored in task log or we can match by timestamp
  // Let's get the prompt details for videos starting from 7e0fed6b
  const startPromptId = '7e0fed6b-fbff-4583-8de3-03b824363fb3';
  
  // Get all I2V videos from project directory
  const videoDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';
  const localVideos = fs.readdirSync(videoDir).filter(f => f.startsWith('I2V_16F') || f.startsWith('I2V_'));
  
  console.log(`Local I2V videos: ${localVideos.length}\n`);
  
  // For now, let's create a simple mapping based on the order they were generated
  // We'll match by getting prompt details and looking for shot info in the prompt
  const promptDetails = new Map();
  
  // Get unique prompt IDs for our videos
  const promptIds = new Set();
  for (const video of localVideos) {
    if (videoToPrompt.has(video)) {
      promptIds.add(videoToPrompt.get(video));
    }
  }
  
  console.log(`Getting details for ${promptIds.size} prompts...\n`);
  
  for (const promptId of promptIds) {
    try {
      const data = await getPrompt(promptId);
      const promptInfo = data[promptId];
      if (promptInfo && promptInfo.prompt) {
        // Look for shot info in the prompt
        promptDetails.set(promptId, {
          prompt: promptInfo.prompt,
          // Try to find shot sequence in the prompt
          shotSequence: null
        });
      }
    } catch (e) {
      console.log(`Error getting prompt ${promptId}:`, e.message);
    }
  }
  
  console.log('Prompt details fetched. Now need to match to shots.');
  console.log('This requires manual mapping or additional log data.');
  
  db.close();
})().catch(err => console.error('Error:', err));
