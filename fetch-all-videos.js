const https = require('https');
const fs = require('fs');
const path = require('path');

const authToken = '01baddbDd8SsEEROab9Ct13KceH';
const baseUrl = 'https://s4t0d2mbyu-8188.cnb.run';

// Function to make HTTPS request
const get = (url) => {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'Authorization': `Bearer ${authToken}` }
    };
    https.get(`${baseUrl}${url}`, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    }).on('error', reject);
  });
};

(async () => {
  console.log('Fetching all history from ComfyUI...\n');
  
  // Try to get history with larger max_items
  const history = await get('/history?max_items=200');
  
  const videos = new Map();
  
  for (const [promptId, promptData] of Object.entries(history)) {
    if (promptData.outputs) {
      for (const [nodeId, nodeOutput] of Object.entries(promptData.outputs)) {
        if (nodeOutput.Filenames) {
          for (const f of nodeOutput.Filenames) {
            if (!videos.has(f.filename)) {
              videos.set(f.filename, { promptId, ...f });
            }
          }
        }
        if (nodeOutput.gifs) {
          for (const g of nodeOutput.gifs) {
            if (!videos.has(g.filename)) {
              videos.set(g.filename, { promptId, ...g });
            }
          }
        }
      }
    }
  }
  
  console.log(`Total videos in ComfyUI history: ${videos.size}`);
  
  // List all videos
  console.log('\nAll videos on ComfyUI:');
  const videoList = [...videos.values()].sort((a, b) => a.promptId.localeCompare(b.promptId));
  videoList.forEach((v, i) => {
    console.log(`${i+1}. ${v.filename} (prompt: ${v.promptId})`);
  });
  
  // Check which ones are local
  const localDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';
  let localFiles = [];
  try {
    localFiles = fs.readdirSync(localDir).filter(f => f.endsWith('.mp4'));
  } catch (e) {}
  
  console.log(`\nLocal files: ${localFiles.length}`);
  
  const missing = videoList.filter(v => !localFiles.includes(v.filename));
  console.log(`Missing locally: ${missing.length}`);
  if (missing.length > 0) {
    console.log('\nMissing files:');
    missing.forEach(f => console.log(`  ${f.filename}`));
  }
  
  // Save full list
  fs.writeFileSync('comfyui-all-videos.json', JSON.stringify(videoList, null, 2));
  console.log('\nFull list saved to comfyui-all-videos.json');
})().catch(err => console.error('Error:', err));
