// scripts/optimize-images.mjs
// L9: public/ shipped two oversized PNGs (2.1 MB + 1.05 MB) rendered directly by
// the login page and the favicon. Large images are a genuine availability
// problem on the school/corporate networks this app targets, and /public is
// served unauthenticated, so every anonymous visitor paid the full cost on
// first paint.
//
//   npm run optimize:images
//
// Uses sharp-cli (fetched on demand via npx) because a correct PNG codec is not
// something to hand-roll: a subtly wrong filter or palette produces a file
// that still parses but renders wrong, which is worse than a large file.
//
// The current committed assets are already optimised (2.1 MB -> 66 KB and
// 1.05 MB -> 17 KB), so this script skips anything already under TARGET_BYTES.
// Re-run it after replacing the source artwork.

import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Skip files already at or below this. */
const TARGET_BYTES = 300 * 1024;
/** Max raster width - the logo is displayed at most ~420 CSS px. */
const MAX_WIDTH = 512;

const TARGETS = [
  { file: "plas-enterprise-logo-ims-project.png", width: 256 }, // favicon
  { file: "login-logo.png", width: MAX_WIDTH }, // login page hero
];

function human(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

let saved = 0;
let skipped = 0;

for (const { file, width } of TARGETS) {
  const path = resolve(ROOT, "public", file);
  let size;
  try {
    size = statSync(path).size;
  } catch {
    console.log(`- ${file}: not found, skipped`);
    skipped++;
    continue;
  }

  if (size <= TARGET_BYTES) {
    console.log(`- ${file}: already ${human(size)}, skipped`);
    skipped++;
    continue;
  }

  const before = size;
  const result = spawnSync(
    "npx",
    [
      "--yes", "sharp-cli@5",
      "-i", path,
      "-o", path,
      "resize", String(width),
      "--format", "png",
    ],
    { stdio: "pipe", encoding: "utf8" },
  );

  if (result.status !== 0) {
    console.error(`- ${file}: optimisation failed, left untouched`);
    console.error(result.stderr || result.stdout);
    process.exitCode = 1;
    continue;
  }

  // Verify the output is still a structurally valid PNG before trusting it.
  const buf = readFileSync(path);
  const validSig = buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  const hasIend = buf.subarray(buf.length - 8, buf.length - 4).toString("ascii") === "IEND";
  if (!validSig || !hasIend) {
    console.error(`- ${file}: produced an invalid PNG, restoring is required`);
    console.error("  git checkout -- public/");
    process.exitCode = 1;
    continue;
  }

  const after = buf.length;
  saved += before - after;
  console.log(
    `+ ${file}: ${human(before)} -> ${human(after)} ` +
      `(-${Math.round((1 - after / before) * 100)}%)`,
  );
}

console.log(
  saved > 0
    ? `\nTotal saved: ${human(saved)}`
    : `\nNothing to do (${skipped} already optimised).`,
);
