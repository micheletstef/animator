(function (global) {
  var AXES = ["wght", "wdth", "cntr", "slnt", "track"];

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function ease(t) {
    t = clamp(t, 0, 1);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function num(el, name, fallback) {
    var v = parseFloat(el.getAttribute(name));
    return isFinite(v) ? v : fallback;
  }

  function readPose(el, suffix) {
    return {
      wght: num(el, "data-wght" + suffix, 400),
      wdth: num(el, "data-wdth" + suffix, 100),
      cntr: num(el, "data-cntr" + suffix, 0),
      slnt: num(el, "data-slnt" + suffix, 0),
      track: num(el, "data-track" + suffix, 0),
    };
  }

  function baselineRatio() {
    var holder = document.createElement("div");
    holder.style.cssText =
      "position:absolute;left:-9999px;top:0;visibility:hidden;font-size:200px;line-height:1;font-family:IkarusPlusVariable,sans-serif;font-synthesis:none;font-feature-settings:'liga' 0,'clig' 0,'calt' 0,'kern' 1;";
    var word = document.createElement("span");
    word.textContent = "Hg";
    var mark = document.createElement("span");
    mark.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline;overflow:hidden;";
    holder.appendChild(word);
    holder.appendChild(mark);
    document.body.appendChild(holder);
    var ratio = mark.offsetTop / 200;
    holder.remove();
    if (!(ratio > 0.2 && ratio < 1.2)) return 0.8;
    return ratio;
  }

  function applyPose(el, pose) {
    el.style.setProperty("--wght", pose.wght.toFixed(2));
    el.style.setProperty("--wdth", pose.wdth.toFixed(2));
    el.style.setProperty("--cntr", pose.cntr.toFixed(2));
    el.style.setProperty("--slnt", pose.slnt.toFixed(2));
    el.style.setProperty("--track", pose.track.toFixed(4));
  }

  function mixPose(a, b, t) {
    var out = {};
    for (var i = 0; i < AXES.length; i++) {
      var k = AXES[i];
      out[k] = lerp(a[k], b[k], t);
    }
    return out;
  }

  function progress(elapsed, hold, move, phase) {
    var cycle = (hold + move) * 2;
    if (cycle <= 0) return 0;
    var t = (((elapsed + phase) % cycle) + cycle) % cycle;
    if (t < hold) return 0;
    if (t < hold + move) return ease((t - hold) / move);
    if (t < hold + move + hold) return 1;
    return 1 - ease((t - hold - move - hold) / move);
  }

  function init() {
    var lines = Array.prototype.slice.call(document.querySelectorAll(".ln"));
    if (!lines.length) return;

    var ratio = baselineRatio();
    var blocks = [];
    var blockIndex = {};
    lines.forEach(function (el) {
      var id = el.getAttribute("data-block") || "block";
      if (blockIndex[id] == null) {
        blockIndex[id] = blocks.length;
        blocks.push(id);
      }
      el._from = readPose(el, "0");
      el._to = readPose(el, "1");
      el._bi = blockIndex[id];
      var fs = parseFloat(el.style.fontSize) || 16;
      var shift = ratio * fs;
      var vertical = el.classList.contains("is-vert");
      el.style.transformOrigin = "0 0";
      el.style.transform = vertical
        ? "rotate(-90deg) translateY(" + -shift + "px)"
        : "translateY(" + -shift + "px)";
      applyPose(el, el._from);
    });

    var moveEl = document.getElementById("move");
    var holdEl = document.getElementById("hold");
    var stagEl = document.getElementById("stagger");
    var moveVal = document.getElementById("moveVal");
    var holdVal = document.getElementById("holdVal");
    var stagVal = document.getElementById("staggerVal");
    var nowEl = document.getElementById("nowReadout");
    var playBtn = document.getElementById("posePlay");
    var restBtn = document.getElementById("poseRest");
    var altBtn = document.getElementById("poseAlt");
    var storeKey = document.body.getAttribute("data-store") || "animator:v2:bottle";

    var mode = "play";
    var t0 = performance.now();
    var raf = 0;

    function readStored() {
      try {
        var raw = localStorage.getItem(storeKey);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    }

    function writeStored() {
      try {
        localStorage.setItem(
          storeKey,
          JSON.stringify({
            move: moveEl.value,
            hold: holdEl.value,
            stagger: stagEl.value,
            mode: mode,
          })
        );
      } catch (e) {}
    }

    function setMode(next) {
      mode = next;
      playBtn.classList.toggle("is-on", mode === "play");
      restBtn.classList.toggle("is-on", mode === "rest");
      altBtn.classList.toggle("is-on", mode === "alt");
      playBtn.setAttribute("aria-selected", mode === "play" ? "true" : "false");
      restBtn.setAttribute("aria-selected", mode === "rest" ? "true" : "false");
      altBtn.setAttribute("aria-selected", mode === "alt" ? "true" : "false");
      if (mode === "play") t0 = performance.now();
      writeStored();
    }

    function fmt(n) {
      return Math.round(n) + "ms";
    }

    function syncLabels() {
      moveVal.textContent = fmt(moveEl.value);
      holdVal.textContent = fmt(holdEl.value);
      stagVal.textContent = fmt(stagEl.value);
    }

    var saved = readStored();
    if (saved) {
      if (saved.move != null) moveEl.value = saved.move;
      if (saved.hold != null) holdEl.value = saved.hold;
      if (saved.stagger != null) stagEl.value = saved.stagger;
      if (saved.mode === "rest" || saved.mode === "alt" || saved.mode === "play") mode = saved.mode;
    }
    syncLabels();
    setMode(mode);

    [moveEl, holdEl, stagEl].forEach(function (el) {
      el.addEventListener("input", function () {
        syncLabels();
        writeStored();
      });
    });
    playBtn.addEventListener("click", function () {
      setMode("play");
    });
    restBtn.addEventListener("click", function () {
      setMode("rest");
    });
    altBtn.addEventListener("click", function () {
      setMode("alt");
    });

    function frame(now) {
      var move = Math.max(1, parseFloat(moveEl.value) || 1);
      var hold = Math.max(0, parseFloat(holdEl.value) || 0);
      var stagger = Math.max(0, parseFloat(stagEl.value) || 0);
      var elapsed = now - t0;
      var shown = mode === "rest" ? 0 : mode === "alt" ? 1 : null;
      for (var i = 0; i < lines.length; i++) {
        var el = lines[i];
        var u =
          shown != null
            ? shown
            : progress(elapsed, hold, move, el._bi * stagger);
        applyPose(el, mixPose(el._from, el._to, u));
      }
      if (nowEl) {
        if (mode === "rest") nowEl.textContent = "rest · printed axes";
        else if (mode === "alt") nowEl.textContent = "alt · second axes";
        else nowEl.textContent = blocks.length + " blocks · staggered";
      }
      raf = global.requestAnimationFrame(frame);
    }

    raf = global.requestAnimationFrame(frame);
    global.addEventListener("pagehide", function () {
      if (raf) global.cancelAnimationFrame(raf);
    });
  }

  function boot() {
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(init);
    } else {
      init();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
