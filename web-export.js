import { toCanvas, getFontEmbedCSS } from "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/+esm";
import { Muxer, ArrayBufferTarget } from "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm";

const CODEC_CANDIDATES = [
  "avc1.640033",
  "avc1.640032",
  "avc1.64002a",
  "avc1.640028",
  "avc1.4d0033",
  "avc1.4d0028",
  "avc1.420028",
];

const QUALITY = {
  draft: { bpp: 0.07, cap: 12e6, floor: 1e6 },
  high: { bpp: 0.18, cap: 40e6, floor: 4e6 },
  max: { bpp: 0.6, cap: 150e6, floor: 12e6 },
};

const DEFAULT_PREFS = { fps: 30, scale: 2, quality: "max" };

function waitPaint() {
  return new Promise(function (resolve) {
    requestAnimationFrame(function () {
      requestAnimationFrame(resolve);
    });
  });
}

function saveBlob(blob, name) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 2000);
}

function even(n) {
  n = Math.max(2, Math.round(n));
  return n % 2 === 0 ? n : n + 1;
}

function artboardSize(stage) {
  var root = document.documentElement;
  var cs = getComputedStyle(root);
  var w = parseFloat(cs.getPropertyValue("--ar-w"));
  var h = parseFloat(cs.getPropertyValue("--ar-h"));
  return {
    w: w > 0 ? Math.round(w) : stage.offsetWidth || 1080,
    h: h > 0 ? Math.round(h) : stage.offsetHeight || 1440,
  };
}

function loopsKey() {
  return "animator:v2:export-loops:" + location.pathname + location.search;
}

function prefsKey() {
  return "animator:v2:export-prefs";
}

function qualityFromControl(el) {
  if (!el) return "max";
  if (el.tagName === "SELECT") return QUALITY[el.value] ? el.value : "max";
  var levels = ["draft", "high", "max"];
  var i = Math.round(Number(el.value));
  if (i < 0) i = 0;
  if (i > 2) i = 2;
  return levels[i];
}

function qualityIndex(name) {
  if (name === "draft") return 0;
  if (name === "high") return 1;
  return 2;
}

function readLoops() {
  var input = document.getElementById("exportLoops");
  var n = input ? Number(input.value) : NaN;
  if (!isFinite(n)) n = 1;
  return Math.max(1, Math.min(12, Math.round(n)));
}

function loadPrefs() {
  var prefs = Object.assign({}, DEFAULT_PREFS);
  try {
    var raw = localStorage.getItem(prefsKey());
    if (raw) Object.assign(prefs, JSON.parse(raw));
  } catch (err) {}
  prefs.fps = Math.max(12, Math.min(60, Math.round(Number(prefs.fps) || 30)));
  prefs.scale = Number(prefs.scale) === 1 ? 1 : 2;
  prefs.quality = QUALITY[prefs.quality] ? prefs.quality : "max";
  return prefs;
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(prefsKey(), JSON.stringify(prefs));
  } catch (err) {}
}

function readExportSettings(stage) {
  var prefs = loadPrefs();
  var fpsEl = document.getElementById("exportFps");
  var scaleEl = document.getElementById("exportScale");
  var qualityEl = document.getElementById("exportQuality");
  if (fpsEl) prefs.fps = Math.max(12, Math.min(60, Math.round(Number(fpsEl.value) || 30)));
  if (scaleEl) prefs.scale = Number(scaleEl.value) === 1 ? 1 : 2;
  if (qualityEl) prefs.quality = qualityFromControl(qualityEl);
  var art = artboardSize(stage);
  var w = even(art.w * prefs.scale);
  var h = even(art.h * prefs.scale);
  var q = QUALITY[prefs.quality];
  var bitrate = Math.round(w * h * prefs.fps * q.bpp);
  bitrate = Math.max(q.floor, Math.min(q.cap, bitrate));
  return {
    fps: prefs.fps,
    scale: prefs.scale,
    quality: prefs.quality,
    art: art,
    w: w,
    h: h,
    bitrate: bitrate,
    loops: readLoops(),
  };
}

function bitrateLabel(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 10e6 ? 0 : 1) + " Mbps";
  return Math.round(n / 1e3) + " kbps";
}

async function pickEncoder(width, height, fps, bitrate) {
  if (typeof VideoEncoder === "undefined" || !VideoEncoder.isConfigSupported) {
    return null;
  }
  var hwModes = ["prefer-hardware", "no-preference", "prefer-software"];
  for (var i = 0; i < CODEC_CANDIDATES.length; i++) {
    for (var h = 0; h < hwModes.length; h++) {
      var config = {
        codec: CODEC_CANDIDATES[i],
        width: width,
        height: height,
        bitrate: bitrate,
        framerate: fps,
        latencyMode: "quality",
        bitrateMode: "variable",
        hardwareAcceleration: hwModes[h],
      };
      try {
        var result = await VideoEncoder.isConfigSupported(config);
        if (result && result.supported) {
          return result.config || config;
        }
      } catch (err) {}
    }
  }
  return null;
}

function fitCanvas(source, w, h) {
  if (source.width === w && source.height === h) return source;
  var canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

function setStatus(btn, text) {
  btn.textContent = text;
}

function readSecondsOverride() {
  var raw = new URLSearchParams(location.search).get("exportSeconds");
  var n = raw == null ? NaN : Number(raw);
  return n > 0 ? n * 1000 : null;
}

async function exportAnimation(api, btn) {
  var stage = api.stage || document.getElementById("stage");
  if (!stage) throw new Error("no stage");
  var settings = readExportSettings(stage);
  var encoderConfig = await pickEncoder(
    settings.w,
    settings.h,
    settings.fps,
    settings.bitrate
  );
  if (!encoderConfig) {
    throw new Error("this browser cannot encode mp4 (needs Chrome or Edge)");
  }

  var overrideMs = readSecondsOverride();
  var durationMs =
    overrideMs != null
      ? overrideMs
      : typeof api.durationMs === "function"
        ? api.durationMs()
        : api.durationMs;
  durationMs = Math.max(1, Number(durationMs) || 3000);
  if (overrideMs == null) durationMs *= settings.loops;
  var frameCount = Math.max(1, Math.round((durationMs / 1000) * settings.fps));
  var filename =
    typeof api.filename === "function"
      ? api.filename()
      : api.filename || "animation.mp4";
  var keyEvery =
    settings.quality === "max"
      ? Math.max(1, Math.round(settings.fps / 2))
      : settings.fps;

  document.documentElement.classList.add("is-exporting");
  if (api.stop) api.stop();

  var fontEmbedCSS = await getFontEmbedCSS(stage);
  var muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: "avc",
      width: settings.w,
      height: settings.h,
      frameRate: settings.fps,
    },
    fastStart: "in-memory",
  });

  var encoderError = null;
  var encoder = new VideoEncoder({
    output: function (chunk, meta) {
      muxer.addVideoChunk(chunk, meta);
    },
    error: function (err) {
      encoderError = err;
    },
  });
  encoder.configure(encoderConfig);

  try {
    for (var i = 0; i < frameCount; i++) {
      if (encoderError) throw encoderError;
      var t = (i / settings.fps) * 1000;
      api.seek(t);
      await waitPaint();
      setStatus(btn, i + 1 + " / " + frameCount);

      var captured = await toCanvas(stage, {
        width: settings.art.w,
        height: settings.art.h,
        pixelRatio: settings.scale,
        fontEmbedCSS: fontEmbedCSS,
        style: {
          boxShadow: "none",
          transform: "none",
          width: settings.art.w + "px",
          height: settings.art.h + "px",
        },
      });
      var canvas = fitCanvas(captured, settings.w, settings.h);

      if (encoder.encodeQueueSize > 8) {
        await new Promise(function (resolve) {
          encoder.ondequeue = resolve;
        });
      }

      var frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1e6) / settings.fps),
        duration: Math.round(1e6 / settings.fps),
      });
      encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
    }

    setStatus(btn, "encoding");
    await encoder.flush();
    muxer.finalize();
    saveBlob(
      new Blob([muxer.target.buffer], { type: "video/mp4" }),
      filename
    );
  } finally {
    try {
      if (encoder.state !== "closed") encoder.close();
    } catch (err) {}
    document.documentElement.classList.remove("is-exporting");
    if (api.start) api.start();
  }
}

function paintExportSummary(stage) {
  var el = document.getElementById("exportSummary");
  if (!el) return;
  var s = readExportSettings(stage || document.getElementById("stage"));
  el.textContent =
    s.w +
    " × " +
    s.h +
    " · " +
    s.fps +
    " fps · " +
    s.quality +
    " · " +
    bitrateLabel(s.bitrate);
}

function ensureExportUi() {
  if (!document.getElementById("exportFps")) {
    var staleBtn = document.getElementById("downloadBtn");
    var staleGroup = staleBtn && staleBtn.closest(".group");
    if (staleGroup) staleGroup.remove();
    else if (staleBtn) staleBtn.remove();
  } else {
    return document.getElementById("downloadBtn");
  }
  var panel = document.querySelector(".panel");
  if (!panel) return null;

  var stage = document.getElementById("stage");
  var art = artboardSize(stage || document.documentElement);
  var prefs = loadPrefs();
  var group = document.createElement("div");
  group.className = "group";
  group.id = "exportGroup";
  group.innerHTML =
    '<p class="group-title">export</p>' +
    '<div class="row">' +
    '<label for="exportLoops">loops</label>' +
    '<input id="exportLoops" type="range" min="1" max="12" step="1" value="1" />' +
    '<span class="val" id="exportLoopsVal">1</span>' +
    "</div>" +
    '<div class="row">' +
    '<label for="exportFps">fps</label>' +
    '<input id="exportFps" type="range" min="12" max="60" step="1" value="30" />' +
    '<span class="val" id="exportFpsVal">30</span>' +
    "</div>" +
    '<div class="row">' +
    '<label for="exportScale">size</label>' +
    '<input id="exportScale" type="range" min="1" max="2" step="1" value="2" />' +
    '<span class="val" id="exportScaleVal"></span>' +
    "</div>" +
    '<div class="row">' +
    '<label for="exportQuality">quality</label>' +
    '<input id="exportQuality" type="range" min="0" max="2" step="1" value="2" />' +
    '<span class="val" id="exportQualityVal">max</span>' +
    "</div>" +
    '<p class="hint" id="exportSummary"></p>' +
    '<div class="actions">' +
    '<button type="button" id="downloadBtn">download mp4</button>' +
    "</div>";
  panel.appendChild(group);

  var loops = document.getElementById("exportLoops");
  var loopsVal = document.getElementById("exportLoopsVal");
  var fps = document.getElementById("exportFps");
  var fpsVal = document.getElementById("exportFpsVal");
  var scale = document.getElementById("exportScale");
  var scaleVal = document.getElementById("exportScaleVal");
  var quality = document.getElementById("exportQuality");
  var qualityVal = document.getElementById("exportQualityVal");

  try {
    var savedLoops = localStorage.getItem(loopsKey());
    if (savedLoops != null) loops.value = String(savedLoops);
  } catch (err) {}
  fps.value = String(prefs.fps);
  scale.value = String(prefs.scale);
  quality.value = String(qualityIndex(prefs.quality));

  function persistPrefs() {
    savePrefs({
      fps: Number(fps.value) || 30,
      scale: Number(scale.value) === 1 ? 1 : 2,
      quality: qualityFromControl(quality),
    });
    paintExportSummary(stage);
  }

  function paintLoops() {
    loopsVal.textContent = String(readLoops());
  }
  function paintFps() {
    fpsVal.textContent = String(Math.round(Number(fps.value) || 30));
  }
  function paintScale() {
    var n = Number(scale.value) === 1 ? 1 : 2;
    scaleVal.textContent = art.w * n + "×" + art.h * n;
  }
  function paintQuality() {
    qualityVal.textContent = qualityFromControl(quality);
  }

  paintLoops();
  paintFps();
  paintScale();
  paintQuality();
  paintExportSummary(stage);

  loops.addEventListener("input", function () {
    paintLoops();
    try {
      localStorage.setItem(loopsKey(), String(readLoops()));
    } catch (err) {}
  });
  fps.addEventListener("input", function () {
    paintFps();
    persistPrefs();
  });
  scale.addEventListener("input", function () {
    paintScale();
    persistPrefs();
  });
  quality.addEventListener("input", function () {
    paintQuality();
    persistPrefs();
  });

  return document.getElementById("downloadBtn");
}

function bind() {
  if (!document.getElementById("web-export-style")) {
    var style = document.createElement("style");
    style.id = "web-export-style";
    style.textContent =
      ".is-exporting .artboard-scale,.is-exporting .stage-guides{display:none!important}";
    document.head.appendChild(style);
  }
  var api = window.AnimatorExport;
  if (!api) return;
  var btn = ensureExportUi();
  if (!btn) return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", function () {
    if (btn.disabled) return;
    var label = btn.textContent;
    btn.disabled = true;
    exportAnimation(api, btn)
      .then(function () {
        setStatus(btn, "downloaded");
        setTimeout(function () {
          setStatus(btn, label);
        }, 1200);
      })
      .catch(function (err) {
        console.error(err);
        setStatus(btn, err && err.message ? err.message : "export failed");
        setTimeout(function () {
          setStatus(btn, label);
        }, 3200);
      })
      .finally(function () {
        btn.disabled = false;
      });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bind);
} else {
  bind();
}
