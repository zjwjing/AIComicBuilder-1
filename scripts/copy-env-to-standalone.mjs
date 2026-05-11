/**
 * Post-build script: copies .env → .next/standalone/.env
 * Next.js standalone output does NOT automatically bundle .env files.
 */
import fs from "node:fs";
import path from "node:path";

const src = path.resolve(".env");
const dest = path.resolve(".next/standalone/.env");

if (fs.existsSync(src)) {
  fs.cpSync(src, dest, { force: true });
  console.log(`[postbuild] Copied .env → .next/standalone/.env`);
} else {
  console.warn(`[postbuild] .env not found — skipping standalone env copy`);
}
