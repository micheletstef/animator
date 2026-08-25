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

function stableSearch(search) {
  search = search == null ? location.search : search;
  if (!search) return "";
  try {
    var params = new URLSearchParams(search.charAt(0) === "?" ? search : "?" + search);
    params.delete("v");
    var q = params.toString();
    return q ? "?" + q : "";
  } catch (e) {
    return String(search);
  }
}

function loopsPrefix() {
  return "animator:v2:export-loops:" + location.pathname;
}

function loopsKey() {
  return loopsPrefix() + stableSearch();
}

function readLoopsStored() {
  var primary = loopsKey();
  try {
    var raw = localStorage.getItem(primary);
    if (raw != null) return raw;
    var i;
    var k;
    var base = loopsPrefix();
    for (i = 0; i < localStorage.length; i++) {
      k = localStorage.key(i);
      if (!k || k === primary || k.indexOf(base) !== 0) continue;
      var rest = k.slice(base.length);
      if (rest && rest.charAt(0) !== "?") continue;
      if (stableSearch(rest) !== stableSearch()) continue;
      raw = localStorage.getItem(k);
      if (raw == null) continue;
      try {
        localStorage.setItem(primary, raw);
      } catch (err) {}
      return raw;
    }
  } catch (err) {}
  return null;
}

function prefsKey() {
  return "animator:v2:export-prefs";
}

function qualityFromControl(el) {
  if (!el) return "max";
  if (QUALITY[el.value]) return el.value;
  var levels = ["draft", "high", "max"];
  var i = Math.round(Number(el.value));
  if (i < 0) i = 0;
  if (i > 2) i = 2;
  return levels[i];
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
    '<div class="row row-span">' +
    '<label for="exportLoops">loops</label>' +
    '<input id="exportLoops" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" />' +
    "</div>" +
    '<div class="row row-span">' +
    '<label for="exportFps">fps</label>' +
    '<input id="exportFps" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" />' +
    "</div>" +
    '<div class="row row-span">' +
    '<label for="exportScale">size</label>' +
    '<select id="exportScale">' +
    '<option value="1">' +
    art.w +
    " × " +
    art.h +
    "</option>" +
    '<option value="2">' +
    art.w * 2 +
    " × " +
    art.h * 2 +
    "</option>" +
    "</select>" +
    "</div>" +
    '<div class="row row-span">' +
    '<label for="exportQuality">quality</label>' +
    '<select id="exportQuality">' +
    '<option value="draft">draft</option>' +
    '<option value="high">high</option>' +
    '<option value="max">max</option>' +
    "</select>" +
    "</div>" +
    '<p class="hint" id="exportSummary"></p>' +
    '<div class="actions">' +
    '<button type="button" id="downloadBtn">download mp4</button>' +
    "</div>";
  panel.appendChild(group);

  var loops = document.getElementById("exportLoops");
  var fps = document.getElementById("exportFps");
  var scale = document.getElementById("exportScale");
  var quality = document.getElementById("exportQuality");

  try {
    var savedLoops = readLoopsStored();
    var n = savedLoops == null ? 1 : Number(savedLoops);
    if (!isFinite(n)) n = 1;
    loops.value = String(Math.max(1, Math.min(12, Math.round(n))));
  } catch (err) {
    loops.value = "1";
  }
  fps.value = String(prefs.fps);
  scale.value = String(prefs.scale);
  quality.value = QUALITY[prefs.quality] ? prefs.quality : "max";

  function persistPrefs() {
    savePrefs({
      fps: Math.max(12, Math.min(60, Math.round(Number(fps.value) || 30))),
      scale: Number(scale.value) === 1 ? 1 : 2,
      quality: qualityFromControl(quality),
    });
    paintExportSummary(stage);
  }

  function bindInt(el, min, max, fallback, onValid) {
    el.addEventListener("input", function () {
      var raw = String(el.value).trim();
      if (raw === "" || raw === "-") return;
      if (!/^-?\d+$/.test(raw)) return;
      onValid(Math.max(min, Math.min(max, Math.round(Number(raw)))));
    });
    el.addEventListener("change", function () {
      var n = Number(el.value);
      if (!isFinite(n)) n = fallback;
      n = Math.max(min, Math.min(max, Math.round(n)));
      el.value = String(n);
      onValid(n);
    });
  }

  bindInt(loops, 1, 12, 1, function () {
    try {
      localStorage.setItem(loopsKey(), String(readLoops()));
    } catch (err) {}
    paintExportSummary(stage);
  });
  bindInt(fps, 12, 60, 30, persistPrefs);
  scale.addEventListener("change", persistPrefs);
  quality.addEventListener("change", persistPrefs);
  paintExportSummary(stage);

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
