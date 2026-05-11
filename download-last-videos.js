const https = require('https');
const fs = require('fs');
const path = require('path');

const authToken = '01baddbDd8SsEEROab9Ct13KceH';
const baseUrl = 'https://s4t0d2mbyu-8188.cnb.run';
const targetDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';

// Get history for the specific prompt IDs from earlier
const promptIds = ['bc47cd49-6d04-4cbb-be7f-f5de5fff562e', 'bc47cd49-6d04-4cbb-be7f-f5de5fff562e']; // wan22__00002, 170009_00001

const getHistory = (promptId) => {
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

const downloadFile = (filename, subfolder = '') => {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({
      filename: filename,
      subfolder: subfolder,
      type: 'output'
    });
    const options = {
      headers: { 'Authorization': `Bearer ${authToken}` }
    };
    https.get(`${baseUrl}/view?${query.toString()}`, options, (res) => {
      if (res.statusCode !== 200) {
        resolve(false);
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const targetPath = path.join(targetDir, filename);
        fs.writeFileSync(targetPath, buffer);
        console.log(`Downloaded: ${filename}`);
        resolve(true);
      });
    }).on('error', () => resolve(false));
  });
};

(async () => {
  console.log('Looking for wan22__00002.mp4 and 170009_00001.mp4...\n');
  
  // Try to download directly - these might be in a subfolder
  const subfolders = ['', 'wan22', 'ComfyUI/output', 'output'];
  
  for (const filename of ['wan22__00002.mp4', '170009_00001.mp4']) {
    let found = false;
    for (const subfolder of subfolders) {
      console.log(`Trying ${filename} with subfolder: "${subfolder}"`);
      if (await downloadFile(filename, subfolder)) {
        found = true;
        break;
      }
    }
    if (!found) {
      console.log(`Could not download: ${filename}`);
    }
  }
  
  const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.mp4')).sort();
  console.log(`\nTotal local files: ${files.length}`);
})().catch(err => console.error('Error:', err));
