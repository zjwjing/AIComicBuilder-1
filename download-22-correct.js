const https = require('https');
const fs = require('fs');
const path = require('path');

const authToken = '01baddbDd8SsEEROab9Ct13KceH';
const baseUrl = 'https://s4t0d2mbyu-8188.cnb.run';
const targetDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';

// Download a file with various attempts
const downloadVideo = (filename) => {
  return new Promise((resolve) => {
    // Try different subfolder and path combinations
    const attempts = [
      { filename, subfolder: '' },
      { filename: `输出/${filename}`, subfolder: '' },
      { filename, subfolder: '输出' },
      { filename, subfolder: 'workspace/输出' },
    ];
    
    let tried = 0;
    const tryNext = () => {
      if (tried >= attempts.length) {
        resolve(false);
        return;
      }
      const attempt = attempts[tried++];
      const query = new URLSearchParams({
        filename: attempt.filename,
        subfolder: attempt.subfolder,
        type: 'output'
      });
      const options = { headers: { 'Authorization': `Bearer ${authToken}` } };
      https.get(`${baseUrl}/view?${query.toString()}`, options, (res) => {
        if (res.statusCode === 200) {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const targetPath = path.join(targetDir, filename);
            fs.writeFileSync(targetPath, buffer);
            console.log(`Downloaded: ${filename}`);
            resolve(true);
          });
        } else {
          tryNext();
        }
      }).on('error', () => tryNext());
    };
    tryNext();
  });
};

(async () => {
  // I2V_16F videos from ComfyUI history (22 videos from task 7e0fed6b onwards)
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
    'I2V_16F_lSHmz21IJAOw_00001.mp4',
    'I2V_16F_40mDHP5F2sUv_00001.mp4',
    'I2V_16F_xLO0EzRJcZOK_00001.mp4',
    'I2V_16F_hUzHYG4vwbhi_00001.mp4'
  ];
  
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
    
    if (await downloadVideo(filename)) {
      downloaded++;
    } else {
      console.log(`Failed: ${filename}`);
      failed++;
    }
  }
  
  console.log(`\nDone! Downloaded: ${downloaded}, Skipped: ${skipped}, Failed: ${failed}`);
  
  const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.mp4')).sort();
  console.log(`Total local files: ${files.length}`);
  console.log('\nI2V_16F files in local:');
  files.filter(f => f.startsWith('I2V_16F')).forEach((f, i) => console.log(`${i+1}. ${f}`));
})().catch(err => console.error('Fatal:', err));
