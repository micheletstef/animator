import { chromium } from "playwright";
import { pathToFileURL } from "url";
import path from "path";

const file = pathToFileURL(
  path.join(process.cwd(), "animations/matrix.html")
).href;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(file);
await page.waitForFunction(() => document.fonts && document.fonts.status === "loaded");
await page.waitForTimeout(500);

const data = await page.evaluate(() => {
  const cells = document.querySelectorAll(".cell");
  return Array.from(cells).map((cell, i) => {
    const glyph = cell.querySelector(".glyph");
    const measure = cell.querySelector(".measure");
    const g = glyph.getBoundingClientRect();
    const m = measure.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(glyph);
    const r = range.getBoundingClientRect();
    const cs = getComputedStyle(glyph);
    return {
      i,
      col: glyph.className,
      font: cs.fontFamily.split(",")[0],
      glyphW: g.width,
      measureW: m.width,
      rangeW: r.width,
      leftX: g.left - m.left,
      rightX: g.right - m.left,
    };
  });
});

console.table(data);
await browser.close();
