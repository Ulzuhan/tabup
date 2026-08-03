#!/usr/bin/env node
/**
 * Regenerates the app icons from a single vector definition.
 *
 *   node scripts/generate-icons.mjs
 *
 * Keeping the source here rather than committing only the PNGs means the mark can be
 * changed in one place, and every size stays in step.
 *
 * The mark is a stack of receipt lines with the bottom one — the total — picked out in
 * emerald, plus an upward arrow. It has to read at 48px, which is the size that
 * actually matters on a home screen, so there is no fine detail in it.
 */
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";

const BG = "#141520";
const FG = "#3ddc97";
const DIM = "#4a4d63";

const glyph = (scale = 1, inset = 0) => `
  <g transform="translate(${inset},${inset}) scale(${scale})">
    <rect x="112" y="96"  width="288" height="34" rx="17" fill="${DIM}"/>
    <rect x="112" y="182" width="224" height="34" rx="17" fill="${DIM}"/>
    <rect x="112" y="268" width="288" height="34" rx="17" fill="${DIM}"/>
    <rect x="112" y="372" width="176" height="44" rx="22" fill="${FG}"/>
    <path d="M336 416 L336 340 M336 340 L302 374 M336 340 L370 374"
          stroke="${FG}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>`;

const square = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${BG}"/>
  ${glyph()}
</svg>`;

/**
 * Android crops maskable icons to a circle, so this variant pulls the mark into the
 * safe zone instead of letting the corners get cut off.
 */
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
  ${glyph(0.72, 72)}
</svg>`;

mkdirSync("public", { recursive: true });
writeFileSync("public/icon.svg", square);

for (const [name, svg, size] of [
  ["icon-192.png", square, 192],
  ["icon-512.png", square, 512],
  ["apple-icon.png", square, 180],
  ["icon-maskable-512.png", maskable, 512],
]) {
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(`public/${name}`);
  console.log(`  public/${name} (${size}px)`);
}
