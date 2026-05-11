const fs = require('fs');
const data = JSON.parse(fs.readFileSync('comfyui-history.json', 'utf8'));

const videos = new Set();
const promptMap = {};

for (const [promptId, promptData] of Object.entries(data)) {
  if (promptData.outputs) {
    for (const [nodeId, nodeOutput] of Object.entries(promptData.outputs)) {
      if (nodeOutput.Filenames) {
        for (const f of nodeOutput.Filenames) {
          videos.add(f.filename);
          if (!promptMap[f.filename]) promptMap[f.filename] = [];
          promptMap[f.filename].push(promptId);
        }
      }
      if (nodeOutput.gifs) {
        for (const g of nodeOutput.gifs) {
          videos.add(g.filename);
          if (!promptMap[g.filename]) promptMap[g.filename] = [];
          promptMap[g.filename].push(promptId);
        }
      }
    }
  }
}

console.log(`Total unique videos in ComfyUI history: ${videos.size}`);
console.log('\nVideos:');
for (const v of videos) {
  console.log(`  ${v}`);
}

// Check which ones are already in our project
const localFiles = new Set(fs.readdirSync('uploads/projects/SKB6CNwqAn5H/20260502-V1/videos').filter(f => f.endsWith('.mp4')));
console.log(`\nLocal files: ${localFiles.size}`);

const missing = [...videos].filter(v => !localFiles.has(v));
console.log(`\nMissing from local: ${missing.length}`);
if (missing.length > 0) {
  console.log('Missing files:');
  missing.forEach(f => console.log(`  ${f}`));
}
