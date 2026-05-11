const D = require("better-sqlite3");
const d = new D("data/aicomic.db");

// Check episode
const ep = d.prepare("SELECT id, title, generation_mode, status FROM episodes").all();
console.log("=== episodes ===");
ep.forEach(e => console.log(JSON.stringify(e)));

// Check project
const pr = d.prepare("SELECT id, title, generation_mode, status FROM projects").all();
console.log("\n=== projects ===");
pr.forEach(p => console.log(JSON.stringify(p)));

// Check what assets exist for specific failed shots
const failedShots = ["OhM0v7ju0kwY", "Onpet2KNKjgE", "YidB2ohgIWlD"];
for (const sid of failedShots) {
  const a = d.prepare("SELECT type, status, file_url, meta FROM shot_assets WHERE shot_id=? ORDER BY type").all(sid);
  console.log("\n=== Shot " + sid + " assets ===");
  a.forEach(x => console.log("  " + x.type + ": " + x.status + " url=" + x.file_url + " meta=" + x.meta));
  
  // Check the shot
  const s = d.prepare("SELECT id, sequence, status, video_prompt, motion_script FROM shots WHERE id=?").all(sid);
  console.log("  Shot: seq=" + s[0]?.sequence + " status=" + s[0]?.status + " has_video_prompt=" + !!s[0]?.video_prompt);
}

d.close();
