const https = require('https');
const fs = require('fs');
const path = require('path');

const authToken = '01baddbDd8SsEEROab9Ct13KceH';
const baseUrl = 'https://s4t0d2mbyu-8188.cnb.run';
const targetDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';

// Get directory listing from ComfyUI
const getDirectory = (subfolder) => {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({ folder: subfolder });
    const options = {
      headers: { 'Authorization': `Bearer ${authToken}` }
    };
    https.get(`${baseUrl}/view?${query.toString()}`, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    }).on('error', reject);
  });
};

// Download file
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
  console.log('Getting file list from ComfyUI output...\n');
  
  // Try to get the output directory
  try {
    const output = await getDirectory('output');
    console.log('Output directory:', JSON.stringify(output, null, 2).substring(0, 500));
  } catch (e) {
    console.log('Error getting directory:', e.message);
  }
})().catch(err => console.error('Fatal:', err));
