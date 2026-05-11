const https = require('https');
const fs = require('fs');
const path = require('path');

const authToken = '01baddbDd8SsEEROab9Ct13KceH';
const baseUrl = 'https://s4t0d2mbyu-8188.cnb.run';
const targetDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';

const failedFiles = [
  'I2V_16F_FQofD5kpIFDX_00001.mp4',
  'I2V_16F_sA4w7rlZwhlM_00001.mp4',
  'I2V_16F_WQJHgDgt6uv3_00001.mp4',
  'I2V_16F__00003.mp4'
];

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
  console.log('Downloading 4 failed videos...\n');
  
  for (const file of failedFiles) {
    console.log(`Trying: ${file}`);
    const subfolders = ['', '输出', 'workspace/输出', '/workspace/输出', 'output'];
    let success = false;
    
    for (const subfolder of subfolders) {
      console.log(`  Subfolder: "${subfolder}"`);
      if (await downloadFile(file, subfolder)) {
        success = true;
        break;
      }
    }
    
    if (!success) {
      console.log(`  Failed: ${file}`);
    }
  }
  
  const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.mp4')).sort();
  console.log(`\nTotal local files: ${files.length}`);
})().catch(err => console.error('Fatal:', err));
