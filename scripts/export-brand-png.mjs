import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = path.join(root, "public", "brand");
const outDir = path.join(brandDir, "png");

const exports = [
  ["slidestage-mark.svg", 512, 512, [1, 2]],
  ["slidestage-mark-on-dark.svg", 512, 512, [1, 2]],
  ["slidestage-favicon.svg", 64, 64, [1, 3, 8]],
  ["slidestage-logo-horizontal.svg", 980, 300, [1, 2]],
  ["slidestage-logo-horizontal-on-dark.svg", 980, 300, [1, 2]],
  ["slidestage-logo-horizontal-tagline.svg", 980, 360, [1, 2]],
  ["slidestage-logo-stacked.svg", 620, 720, [1, 2]],
  ["slidestage-wordmark.svg", 900, 180, [1, 2]],
  ["slidestage-social-card.svg", 1200, 630, [1]],
];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

for (const [fileName, width, height, scales] of exports) {
  const source = await readFile(path.join(brandDir, fileName), "utf8");
  const baseName = fileName.replace(/\.svg$/, "");

  for (const scale of scales) {
    const outWidth = width * scale;
    const outHeight = height * scale;
    const outName = scale === 1 ? `${baseName}.png` : `${baseName}@${scale}x.png`;
    const outPath = path.join(outDir, outName);
    const html = `<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            html, body {
              width: ${outWidth}px;
              height: ${outHeight}px;
              margin: 0;
              overflow: hidden;
              background: transparent;
            }

            svg {
              display: block;
              width: ${outWidth}px;
              height: ${outHeight}px;
            }
          </style>
        </head>
        <body>${source}</body>
      </html>`;

    await page.setViewportSize({ width: outWidth, height: outHeight });
    await page.setContent(html, { waitUntil: "load" });
    const png = await page.screenshot({
      omitBackground: true,
      type: "png",
      clip: { x: 0, y: 0, width: outWidth, height: outHeight },
    });
    await writeFile(outPath, png);
    console.log(`wrote ${path.relative(root, outPath)}`);
  }
}

await page.setViewportSize({ width: 1440, height: 1400 });
await page.goto(`file://${path.join(brandDir, "preview.html")}`, { waitUntil: "load" });
await page.screenshot({
  path: path.join(brandDir, "preview.png"),
  type: "png",
  fullPage: true,
});
console.log("wrote public/brand/preview.png");

await browser.close();
