const https = require('https');
const fs = require('fs');
const path = require('path');

const authToken = '01baddbDd8SsEEROab9Ct13KceH';
const baseUrl = 'https://s4t0d2mbyu-8188.cnb.run';

// All video filenames from ComfyUI history (from task 7e0fed6b onwards)
const videoList = [
  'I2V_16F_M541abjvv0xb_00001.mp4',
  'I2V_16F_vxe3pM2E4V10_00001.mp4',
  'I2V_16F_imXc75ZI3f7c_00001.mp4',
  'I2V_16F_WKeaM6joZeMq_00001.mp4',
  'I2V_16F_svWSaYkHZBqW_00001.mp4',
  'I2V_16F_Jr1ctMI9LBbs_00001.mp4',
  'wan22__00002.mp4',
  '170009_00001.mp4',
  'I2V_16F_OzuhC4PrtNa7_00001.mp4',
  'I2V_FQofD5kpIFDX_00001.mp4',
  'I2V_16F_zLL5PlvhMkKm_00001.mp4',
  'I2V_sA4w7rlZwhlM_00001.mp4',
  'I2V_16F__00010.mp4',
  'I2V_16F_g9dBYOq281OD_00001.mp4',
  'I2V_16F__00004.mp4',
  'I2V_16F_Q9lnSSqBG75O_00001.mp4',
  'I2V_WQJHgDgt6uv3_00001.mp4'
];

const targetDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';
if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

// Download a single file
const downloadFile = (filename) => {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({
      filename: filename,
      subfolder: '',
      type: 'output'
    });
    const options = {
      headers: { 'Authorization': `Bearer ${authToken}` }
    };
    https.get(`${baseUrl}/view?${query.toString()}`, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${filename}: ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const targetPath = path.join(targetDir, filename);
        fs.writeFileSync(targetPath, buffer);
        console.log(`Downloaded: ${filename}`);
        resolve(filename);
      });
    }).on('error', reject);
  });
};

(async () => {
  console.log(`Downloading ${videoList.length} videos from ComfyUI...\n`);
  
  let downloaded = 0;
  let skipped = 0;
  
  for (const filename of videoList) {
    const targetPath = path.join(targetDir, filename);
    if (fs.existsSync(targetPath)) {
      console.log(`Skipped (exists): ${filename}`);
      skipped++;
      continue;
    }
    try {
      await downloadFile(filename);
      downloaded++;
    } catch (err) {
      console.error(`Error downloading ${filename}:`, err.message);
    }
  }
  
  console.log(`\nDone! Downloaded: ${downloaded}, Skipped: ${skipped}`);
  
  // List all local files
  const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.mp4')).sort();
  console.log(`\nTotal local files: ${files.length}`);
})().catch(err => console.error('Fatal error:', err));
