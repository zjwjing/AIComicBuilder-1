const https = require('https');
const fs = require('fs');

const authToken = '01baddbDd8SsEEROab9Ct13KceH';
const baseUrl = 'https://s4t0d2mbyu-8188.cnb.run';

// Get history with max_items
const getHistory = () => {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'Authorization': `Bearer ${authToken}` }
    };
    https.get(`${baseUrl}/history?max_items=100`, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
};

// Get specific prompt history
const getPromptHistory = (promptId) => {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'Authorization': `Bearer ${authToken}` }
    };
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
  console.log('Fetching ComfyUI history...');
  const history = await getHistory();
  
  const videos = new Map(); // filename -> promptId
  
  for (const [promptId, promptData] of Object.entries(history)) {
    if (promptData.outputs) {
      for (const [nodeId, nodeOutput] of Object.entries(promptData.outputs)) {
        if (nodeOutput.Filenames) {
          for (const f of nodeOutput.Filenames) {
            if (!videos.has(f.filename)) {
              videos.set(f.filename, promptId);
            }
          }
        }
      }
    }
  }
  
  console.log(`Total unique videos in ComfyUI: ${videos.size}`);
  console.log('\nAll videos:');
  for (const [filename, promptId] of videos) {
    console.log(`  ${filename} (prompt: ${promptId})`);
  }
  
  // Save to file
  const videoList = [...videos.keys()];
  fs.writeFileSync('comfyui-video-list.json', JSON.stringify(videoList, null, 2));
  console.log('\nVideo list saved to comfyui-video-list.json');
})().catch(err => console.error('Error:', err));
