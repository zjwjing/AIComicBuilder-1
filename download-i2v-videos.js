const https = require('https');
const fs = require('fs');
const path = require('path');

const authToken = '01baddbDd8SsEEROab9Ct13KceH';
const baseUrl = 'https://s4t0d2mbyu-8188.cnb.run';
const targetDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';

// I2V_16F videos from today (22 videos)
const videoList = [
  'I2V_16F_M541abjvv0xb_00001.mp4',
  'I2V_16F_vxe3pM2E4V10_00001.mp4',
  'I2V_16F_imXc75ZI3f7c_00001.mp4',
  'I2V_16F_WKeaM6joZeMq_00001.mp4',
  'I2V_16F_svWSaYkHZBqW_00001.mp4',
  'I2V_16F_Jr1ctMI9LBbs_00001.mp4',
  'I2V_16F_OzuhC4PrtNa7_00001.mp4',
  'I2V_16F_FQofD5kpIFDX_00001.mp4',
  'I2V_16F_zLL5PlvhMkKm_00001.mp4',
  'I2V_16F_sA4w7rlZwhlM_00001.mp4',
  'I2V_16F__00010.mp4',
  'I2V_16F_g9dBYOq281OD_00001.mp4',
  'I2V_16F__00004.mp4',
  'I2V_16F_Q9lnSSqBG75O_00001.mp4',
  'I2V_16F_WQJHgDgt6uv3_00001.mp4',
  'I2V_16F_4awRX4Od6f45_00001.mp4',
  'I2V_16F_E9nS8TPGCSLm_00001.mp4',
  'I2V_16F__00003.mp4',
  'I2V_16F_M541abjvv0xb_00001.mp4',
  'I2V_16F_lSHmz21IJAOw_00001.mp4',
  'I2V_16F_40mDHP5F2sUv_00001.mp4',
  'I2V_16F_xLO0EzRJcZOK_00001.mp4'
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
  console.log(`Downloading ${videoList.length} videos from ComfyUI...\n`);
  
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const filename of videoList) {
    const targetPath = path.join(targetDir, filename);
    if (fs.existsSync(targetPath)) {
      console.log(`Skipped (exists): ${filename}`);
      skipped++;
      continue;
    }
    
    // Try different subfolder values
    const subfolders = ['', '输出', '/workspace/输出', 'workspace/输出'];
    let success = false;
    
    for (const subfolder of subfolders) {
      if (await downloadFile(filename, subfolder)) {
        success = true;
        break;
      }
    }
    
    if (success) {
      downloaded++;
    } else {
      console.log(`Failed: ${filename}`);
      failed++;
    }
  }
  
  console.log(`\nDone! Downloaded: ${downloaded}, Skipped: ${skipped}, Failed: ${failed}`);
  
  const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.mp4')).sort();
  console.log(`Total local files: ${files.length}`);
})().catch(err => console.error('Fatal:', err));
