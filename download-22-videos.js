const https = require('https');
const fs = require('fs');
const path = require('path');

const authToken = '01baddbDd8SsEEROab9Ct13KceH';
const baseUrl = 'https://s4t0d2mbyu-8188.cnb.run';

// Prompt IDs for the 22 videos (from task 7e0fed6b onwards)
const promptIds = [
  '7e0fed6b-fbff-4583-8de3-03b824363fb3',
  '85b83fb9-09b7-4ee6-b493-3c1ddf25249c',
  '89260b70-6115-4904-9624-a19c8876f8e9',
  '978de73a-a8da-495e-9707-e228ea5dfab5',
  '9cfc6662-2130-4cbd-aa93-7bc60fbbb8ad',
  'a5f24cea-e59d-47a8-b25c-7bb5ee7f1891',
  'c7846868-17e5-4377-bada-e8e5a3dd3bf1',
  'cf660f29-cdf1-4d06-a746-85b5f37a16fd',
  'e1463f10-8563-49d4-a81d-415aa7d957a8',
  'efcacfee-e63b-446f-89ea-aa9e4d5aea18',
  'fb8ee7e5-98b7-48a5-9ae2-c42830dd75bc',
  '4d1463c9-8653-4454-9a70-66c9eb6a8b8d',
  '4d204ea9-4912-4558-a4af-08a9f0505723',
  '4ed215a1-0d9e-43f4-aa26-4706cc1ad134',
  '4f256365-6470-4b8e-84d6-681652f1c9e7',
  '597ed92b-2225-40a5-be35-9ccf1d691aa2',
  '62718368-b0db-43f3-bc74-54d1e237b455',
  '68bf0c6b-d8c1-478f-b82c-a0fb8180ec87',
  '7756b3ec-d040-4ca7-97d2-ce1de0635fe2',
  '3bce2dd2-9c97-4141-94ff-841042f6f7c7',
  '3f4640ad-4adb-40a1-a5fa-eb2b026517f2',
  '2183debe-e86e-4c9d-90d0-368b40c6a048'
];

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

const targetDir = 'uploads/projects/SKB6CNwqAn5H/20260502-V1/videos';
if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

(async () => {
  console.log('Fetching 22 videos from ComfyUI...\n');
  let downloaded = 0;
  let skipped = 0;

  for (const promptId of promptIds) {
    try {
      const history = await getHistory(promptId);
      const promptData = history[promptId];

      if (promptData?.outputs) {
        for (const [nodeId, nodeOutput] of Object.entries(promptData.outputs)) {
          if (nodeOutput.Filenames) {
            for (const f of nodeOutput.Filenames) {
              const targetPath = path.join(targetDir, f.filename);
              if (fs.existsSync(targetPath)) {
                console.log(`Skipped (exists): ${f.filename}`);
                skipped++;
                continue;
              }
              const subfolder = f.subfolder || '';
              if (await downloadFile(f.filename, subfolder)) {
                downloaded++;
              } else {
                console.log(`Failed: ${f.filename}`);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error fetching ${promptId}:`, err.message);
    }
  }

  console.log(`\nDone! Downloaded: ${downloaded}, Skipped: ${skipped}`);
  const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.mp4')).sort();
  console.log(`Total local files: ${files.length}`);
})().catch(err => console.error('Fatal:', err));
