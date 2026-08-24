import { toCanvas, getFontEmbedCSS } from "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/+esm";
import { Muxer, ArrayBufferTarget } from "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm";

const FPS = 30;
const CODEC_CANDIDATES = [
  "avc1.4d0028",
  "avc1.640028",
  "avc1.420028",
  "avc1.4d001f",
];

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

async function pickCodec(width, height) {
  if (typeof VideoEncoder === "undefined" || !VideoEncoder.isConfigSupported) {
    return null;
  }
  for (var i = 0; i < CODEC_CANDIDATES.length; i++) {
    var codec = CODEC_CANDIDATES[i];
    try {
      var result = await VideoEncoder.isConfigSupported({
        codec: codec,
        width: width,
        height: height,
        bitrate: 8_000_000,
        framerate: FPS,
      });
      if (result && result.supported) return codec;
    } catch (err) {}
  }
  return null;
}

function setStatus(btn, text) {
  btn.textContent = text;
}

async function exportAnimation(api, btn) {
  var stage = api.stage || document.getElementById("stage");
  if (!stage) throw new Error("no stage");
  var size = artboardSize(stage);
  var codec = await pickCodec(size.w, size.h);
  if (!codec) {
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
  var frameCount = Math.max(1, Math.round((durationMs / 1000) * FPS));
  var filename = api.filename || "animation.mp4";

  document.documentElement.classList.add("is-exporting");
  if (api.stop) api.stop();

  var fontEmbedCSS = await getFontEmbedCSS(stage);
  var muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: "avc",
      width: size.w,
      height: size.h,
      frameRate: FPS,
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
  encoder.configure({
    codec: codec,
    width: size.w,
    height: size.h,
    bitrate: 8_000_000,
    framerate: FPS,
    latencyMode: "quality",
  });

  try {
    for (var i = 0; i < frameCount; i++) {
      if (encoderError) throw encoderError;
      var t = (i / FPS) * 1000;
      api.seek(t);
      await waitPaint();
      setStatus(btn, i + 1 + " / " + frameCount);

      var canvas = await toCanvas(stage, {
        width: size.w,
        height: size.h,
        canvasWidth: size.w,
        canvasHeight: size.h,
        pixelRatio: 1,
        fontEmbedCSS: fontEmbedCSS,
        filter: function (node) {
          return !(node.classList && node.classList.contains("stage-caption"));
        },
        style: {
          boxShadow: "none",
          transform: "none",
          width: size.w + "px",
          height: size.h + "px",
        },
      });

      if (encoder.encodeQueueSize > 8) {
        await new Promise(function (resolve) {
          encoder.ondequeue = resolve;
        });
      }

      var frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1e6) / FPS),
        duration: Math.round(1e6 / FPS),
      });
      encoder.encode(frame, { keyFrame: i % FPS === 0 });
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

function readSecondsOverride() {
  var raw = new URLSearchParams(location.search).get("exportSeconds");
  var n = raw == null ? NaN : Number(raw);
  return n > 0 ? n * 1000 : null;
}

function bind() {
  if (!document.getElementById("web-export-style")) {
    var style = document.createElement("style");
    style.id = "web-export-style";
    style.textContent =
      ".is-exporting .stage-caption,.is-exporting .artboard-scale{display:none!important}";
    document.head.appendChild(style);
  }
  var btn = document.getElementById("downloadBtn");
  var api = window.AnimatorExport;
  if (!btn || !api) return;
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
