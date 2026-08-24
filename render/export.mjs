import { spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RENDER_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)));

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".mjs": "text/javascript; charset=utf-8",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function parseArgs(argv) {
  const out = {
    anim: "weight-cascade",
    url: null,
    fps: 30,
    seconds: null,
    out: null,
    keepFrames: false,
    reset: true,
    headed: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--anim") {
      out.anim = next;
      i++;
    } else if (a === "--url") {
      out.url = next;
      i++;
    } else if (a === "--fps") {
      out.fps = Math.max(1, Number(next) || 30);
      i++;
    } else if (a === "--seconds") {
      out.seconds = Math.max(0.1, Number(next));
      i++;
    } else if (a === "--out") {
      out.out = next;
      i++;
    } else if (a === "--keep-frames") {
      out.keepFrames = true;
    } else if (a === "--no-reset") {
      out.reset = false;
    } else if (a === "--headed") {
      out.headed = true;
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    }
  }
  return out;
}

function findAnimation(id) {
  const manifests = [
    ["version-2/animations/animations.json", "version-2/"],
    ["animations/animations.json", ""],
  ];
  for (const [file, prefix] of manifests) {
    const abs = join(ROOT, file);
    if (!existsSync(abs)) continue;
    const data = JSON.parse(readFileSync(abs, "utf8"));
    const list = (data && data.animations) || [];
    const hit = list.find((a) => a.id === id);
    if (hit && hit.url) return prefix + hit.url;
  }
  return null;
}

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = resolve(join(ROOT, rel));
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] || "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", () => {
      resolveListen({ server, port: server.address().port });
    });
  });
}

async function launchBrowser(headed) {
  const opts = { headless: !headed };
  try {
    return await chromium.launch({ ...opts, channel: "chrome" });
  } catch {
    return chromium.launch({ ...opts, channel: "chromium" });
  }
}

function runFfmpeg(args) {
  return new Promise((resolveFfmpeg, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveFfmpeg();
      else reject(new Error("ffmpeg exited with code " + code));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node export.mjs [--anim weight-cascade] [--fps 30] [--seconds 3] [--out out.mp4]

  --anim          animation id from animations.json (default: weight-cascade)
  --url           page path relative to repo root (overrides --anim)
  --fps           frames per second (default: 30)
  --seconds       length in seconds (default: one inferred loop)
  --out           output mp4 path
  --keep-frames   keep PNG frames after encode
  --no-reset      keep the page's saved settings
  --headed        show the browser window
`);
    return;
  }

  const pagePath = args.url || findAnimation(args.anim);
  if (!pagePath) {
    throw new Error("unknown animation: " + args.anim);
  }

  const stamp = args.anim || "export";
  const framesDir = join(RENDER_DIR, "frames", stamp);
  const outPath = resolve(
    args.out || join(RENDER_DIR, "out", stamp + ".mp4")
  );
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(resolve(outPath, ".."), { recursive: true });
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });

  const { server, port } = await startServer();
  const browser = await launchBrowser(args.headed);
  let browserOpen = true;
  const pageUrl = "http://127.0.0.1:" + port + "/" + pagePath.replace(/^\//, "");
  console.log("loading", pageUrl);

  try {
    const context = await browser.newContext({
      viewport: { width: 1080, height: 1440 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    await page.addInitScript(() => {
      const state = {
        time: 0,
        nextId: 1,
        callbacks: [],
      };
      performance.now = function () {
        return state.time;
      };
      window.requestAnimationFrame = function (cb) {
        const id = state.nextId++;
        state.callbacks.push({ id: id, cb: cb });
        return id;
      };
      window.cancelAnimationFrame = function (id) {
        state.callbacks = state.callbacks.filter(function (item) {
          return item.id !== id;
        });
      };
      window.__animatorExport = {
        tick: function (ms) {
          state.time = ms;
          const queue = state.callbacks.slice();
          state.callbacks.length = 0;
          for (let i = 0; i < queue.length; i++) {
            queue[i].cb(ms);
          }
        },
      };
    });

    await page.goto(pageUrl, { waitUntil: "load" });
    await page.waitForSelector("#stage");
    await page.evaluate(() =>
      document.fonts && document.fonts.ready
        ? document.fonts.ready
        : Promise.resolve()
    );
    if (args.reset) {
      await page.evaluate(() => {
        const btn = document.getElementById("resetBtn");
        if (btn) btn.click();
      });
    }

    const size = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const w = parseFloat(cs.getPropertyValue("--ar-w"));
      const h = parseFloat(cs.getPropertyValue("--ar-h"));
      return {
        w: w > 0 ? Math.round(w) : 1080,
        h: h > 0 ? Math.round(h) : 1440,
      };
    });
    await page.setViewportSize({ width: size.w, height: size.h });
    await page.addStyleTag({
      content:
        "html,body{margin:0!important;padding:0!important;width:" +
        size.w +
        "px!important;height:" +
        size.h +
        "px!important;overflow:hidden!important;background:#000!important;display:block!important}" +
        ".panel,.artboard-scale,.hint{display:none!important}" +
        ".stage-caption{display:none!important}" +
        ".stage-wrap{position:static!important;width:" +
        size.w +
        "px!important;height:" +
        size.h +
        "px!important;overflow:hidden!important;cursor:default!important}" +
        ".stage-outer{position:static!important;transform:none!important;width:" +
        size.w +
        "px!important;height:" +
        size.h +
        "px!important;top:auto!important;left:auto!important}" +
        ".stage{box-shadow:none!important;width:" +
        size.w +
        "px!important;height:" +
        size.h +
        "px!important}",
    });

    const durationMs = args.seconds
      ? args.seconds * 1000
      : await page.evaluate(() => {
          const move = Number(document.getElementById("move") && document.getElementById("move").value);
          const lag = Number(document.getElementById("lag") && document.getElementById("lag").value);
          const hold = Number(document.getElementById("hold") && document.getElementById("hold").value);
          const lines = document.querySelectorAll("#lockup .line").length;
          if (lines && isFinite(move) && isFinite(lag) && isFinite(hold)) {
            return (lines - 1) * lag + move + hold;
          }
          const cy = Number(document.getElementById("cy") && document.getElementById("cy").value);
          const hd = Number(document.getElementById("hd") && document.getElementById("hd").value);
          if (isFinite(cy)) return cy + 2 * (isFinite(hd) ? hd : 0);
          return 3000;
        });

    const frameCount = Math.max(1, Math.round((durationMs / 1000) * args.fps));
    const stage = page.locator("#stage");
    console.log(
      "capturing",
      frameCount,
      "frames at",
      args.fps,
      "fps ·",
      size.w + "×" + size.h,
      "·",
      (durationMs / 1000).toFixed(2) + "s"
    );

    for (let i = 0; i < frameCount; i++) {
      const t = (i / args.fps) * 1000;
      await page.evaluate((ms) => window.__animatorExport.tick(ms), t);
      await stage.screenshot({
        path: join(framesDir, "frame_" + String(i).padStart(5, "0") + ".png"),
        type: "png",
        animations: "disabled",
        caret: "hide",
      });
      if (i === 0 || i === frameCount - 1 || (i + 1) % 15 === 0) {
        process.stdout.write("  frame " + (i + 1) + "/" + frameCount + "\n");
      }
    }

    await browser.close();
    browserOpen = false;

    console.log("encoding", outPath);
    await runFfmpeg([
      "-y",
      "-framerate",
      String(args.fps),
      "-i",
      join(framesDir, "frame_%05d.png"),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-crf",
      "18",
      "-movflags",
      "+faststart",
      outPath,
    ]);

    const info = {
      animation: args.anim,
      url: pagePath,
      fps: args.fps,
      frames: frameCount,
      durationMs: durationMs,
      width: size.w,
      height: size.h,
      out: outPath,
    };
    writeFileSync(
      outPath.replace(/\.mp4$/i, ".json"),
      JSON.stringify(info, null, 2) + "\n"
    );
    console.log("wrote", outPath);

    if (!args.keepFrames) {
      rmSync(framesDir, { recursive: true, force: true });
    }
  } finally {
    try {
      if (browserOpen) await browser.close();
    } catch {}
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
