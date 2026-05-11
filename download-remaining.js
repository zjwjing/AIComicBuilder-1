const https = require('https');
const fs = require('fs');
const path = require('path');

const authToken = '01baddbDd8SsEEROab9Ct13KceH';
const baseUrl = 'https://s4t0d2mbyu-8188.cnb.run';

const targetDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';

// Try to download with different subfolder values
const downloadWithSubfolder = (filename, subfolder) => {
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
        console.log(`Downloaded: ${filename} (subfolder: ${subfolder})`);
        resolve(true);
      });
    }).on('error', () => resolve(false));
  });
};

(async () => {
  const missingFiles = ['wan22__00002.mp4', '170009_00001.mp4'];
  
  for (const filename of missingFiles) {
    console.log(`Trying to download: ${filename}`);
    // Try different subfolder values
    const subfolders = ['', 'ComfyUI/output', 'output', 'videos'];
    let downloaded = false;
    
    for (const subfolder of subfolders) {
      console.log(`  Trying subfolder: "${subfolder}"`);
      if (await downloadWithSubfolder(filename, subfolder)) {
        downloaded = true;
        break;
      }
    }
    
    if (!downloaded) {
      console.log(`  Filed to download: ${filename}`);
    }
  }
  
  // List all local files
  const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.mp4')).sort();
  console.log(`\nTotal local files: ${files.length}`);
})().catch(err => console.error('Error:', err));
