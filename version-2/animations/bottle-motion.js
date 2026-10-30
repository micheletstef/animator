(function (global) {
  var AXES = ["wght", "wdth", "cntr", "slnt", "track"];
  var WDTH_MIN = 65;
  var WDTH_MAX = 130;

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

  function setTransform(el, scale) {
    var shift = el._shift;
    var s = scale < 0.999 ? scale : 1;
    el._scale = s;
    var w = el.offsetWidth;
    var box = el._align > 0 ? el._align : w;
    var visual = w * s;
    var dx = (box - visual) / 2;
    if (!el._pin && el._edge > 0) {
      var maxDx = el._edge - visual;
      if (dx > maxDx) dx = maxDx;
    }
    if (el._pin || el._vert) dx = 0;
    el._dx = dx;
    if (el._vert) {
      el.style.transformOrigin = "0 " + shift + "px";
      var vertScale = s < 1 ? " scale(" + s.toFixed(4) + ")" : "";
      el.style.transform = "rotate(-90deg) translateY(" + -shift + "px)" + vertScale;
      return;
    }
    if (el._spin) {
      var spinEl = el.querySelector(".spin");
      if (spinEl) {
        var period = el._spin;
        var angle = ((performance.now() % period) / period) * 360;
        spinEl.style.transform = "rotate(" + angle.toFixed(2) + "deg)";
      }
    }
    el.style.transformOrigin = "0 " + shift + "px";
    var scalePart = s < 1 ? " scale(" + s.toFixed(4) + ")" : "";
    el.style.transform =
      "translate(" + dx.toFixed(2) + "px," + -shift + "px)" + scalePart;
  }

  function altPose(from, index) {
    var wght = from.wght >= 500 ? 200 : 1000;
    var cntr = from.cntr >= 50 ? 0 : 100;
    var narrow = index % 2 === 1;
    var wdth = from.wdth;
    if (narrow) wdth = 65;
    else if (from.wdth > 90) wdth = Math.max(70, from.wdth - 30);
    var slant = index % 4 === 3;
    var track = wdth < from.wdth - 6 ? 0.04 : 0.012;
    if (slant) track = Math.max(track, 0.032);
    return {
      wght: wght,
      wdth: wdth,
      cntr: cntr,
      slnt: slant ? -12 : 0,
      track: track,
    };
  }

  function blockMix(index, active, within, move, returning) {
    if (index < active) return returning ? 0 : 1;
    if (index > active) return returning ? 1 : 0;
    var u = move <= 0 ? 1 : ease(Math.min(1, within / move));
    return returning ? 1 - u : u;
  }

  function init() {
    var lines = Array.prototype.slice.call(document.querySelectorAll(".ln"));
    if (!lines.length) return;

    var ratio = baselineRatio();
    var blocks = [];
    var blockIndex = {};
    var stage = document.getElementById("stage");
    lines.forEach(function (el) {
      var id = el.getAttribute("data-block") || "block";
      el._count = id === "volume";
      el._spin = num(el, "data-spin", 0);
      el._from = readPose(el, "0");
      el._to = el._from;
      el._vert = el.classList.contains("is-vert");
      el._shift = ratio * (parseFloat(el.style.fontSize) || 16);
      el._pin = el.hasAttribute("data-follow");
      if (!el._count && !el._spin && blockIndex[id] == null) {
        blockIndex[id] = blocks.length;
        blocks.push(id);
      }
      el._bi = el._count || el._spin ? -1 : blockIndex[id];
      setTransform(el, 1);
      applyPose(el, el._from);
    });

    var poseByBlock = [];
    lines.forEach(function (el) {
      if (el._count) return;
      if (!poseByBlock[el._bi]) poseByBlock[el._bi] = altPose(el._from, el._bi);
      el._to = poseByBlock[el._bi];
    });

    var stageW = stage ? stage.offsetWidth : 0;
    lines.forEach(function (el) {
      var left = parseFloat(el.style.left) || 0;
      var edge = stageW - left - 4;
      var printed = el.offsetWidth;
      el._align = printed;
      el._edge = edge;
      if (el._count) {
        el._box = edge > printed ? edge : printed;
        el._countLo = 18;
        el._countHi = 88;
        el._gap = "\u2009";
      } else {
        el._box = printed;
        if (edge > 0 && edge < el._box) el._box = edge;
      }
    });

    var followers = [];
    lines.forEach(function (el) {
      var anchorId = el.getAttribute("data-follow");
      if (!anchorId) return;
      el._anchor = document.getElementById(anchorId);
      if (!el._anchor) return;
      var aLeft = parseFloat(el._anchor.style.left) || 0;
      var mLeft = parseFloat(el.style.left) || 0;
      el._followGap = mLeft - (aLeft + el._anchor.offsetWidth);
      followers.push(el);
    });

    var moveEl = document.getElementById("move");
    var holdEl = document.getElementById("hold");
    var moveVal = document.getElementById("moveVal");
    var holdVal = document.getElementById("holdVal");
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
    }

    var saved = readStored();
    if (saved) {
      if (saved.move != null) moveEl.value = saved.move;
      if (saved.hold != null) holdEl.value = saved.hold;
      if (saved.mode === "rest" || saved.mode === "alt" || saved.mode === "play") mode = saved.mode;
    }
    syncLabels();
    setMode(mode);

    [moveEl, holdEl].forEach(function (el) {
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

    function countValue(elapsed) {
      var lo = 18;
      var hi = 88;
      var step = 180;
      var up = (hi - lo) * step;
      var holdHi = 3200;
      var down = up;
      var holdLo = 4800;
      var cycle = up + holdHi + down + holdLo;
      var t = elapsed % cycle;
      if (t < up) return lo + Math.floor(t / step);
      t -= up;
      if (t < holdHi) return hi;
      t -= holdHi;
      if (t < down) return hi - Math.floor(t / step);
      return lo;
    }

    function containAll(poses) {
      for (var i = 0; i < lines.length; i++) {
        applyPose(lines[i], poses[i]);
        setTransform(lines[i], 1);
      }
      var widths = [];
      for (var j = 0; j < lines.length; j++) widths[j] = lines[j].offsetWidth;
      var again = false;
      for (var k = 0; k < lines.length; k++) {
        var el = lines[k];
        var box = el._box;
        var w = widths[k];
        if (!(box > 0) || w <= box + 0.5) continue;
        var next = poses[k].wdth * (box / w);
        next = clamp(next, WDTH_MIN, Math.min(WDTH_MAX, poses[k].wdth));
        if (Math.abs(next - poses[k].wdth) > 0.2) {
          var drop = poses[k].wdth - next;
          if (drop > 1) poses[k].track = Math.min(0.06, poses[k].track + (drop / 80) * 0.045);
          poses[k].wdth = next;
          applyPose(el, poses[k]);
          again = true;
        }
      }
      if (again) {
        for (var n = 0; n < lines.length; n++) widths[n] = lines[n].offsetWidth;
      }
      for (var m = 0; m < lines.length; m++) {
        var line = lines[m];
        var measured = widths[m];
        var scale = 1;
        if (line._box > 0 && measured > line._box + 0.5) scale = line._box / measured;
        setTransform(line, scale);
      }
      for (var f = 0; f < followers.length; f++) {
        var mark = followers[f];
        var anchor = mark._anchor;
        var aLeft = parseFloat(anchor.style.left) || 0;
        var visualRight = aLeft + (anchor._dx || 0) + anchor.offsetWidth * (anchor._scale || 1);
        mark.style.left = visualRight + mark._followGap + "px";
      }
    }

    function frame(now) {
      var move = Math.max(1, parseFloat(moveEl.value) || 1);
      var hold = Math.max(0, parseFloat(holdEl.value) || 0);
      var elapsed = now - t0;
      var slot = hold + move;
      var count = Math.max(1, blocks.length);
      var pass = slot * count;
      var cycle = pass * 2;
      var local = cycle > 0 ? ((elapsed % cycle) + cycle) % cycle : 0;
      var returning = local >= pass;
      var passLocal = returning ? local - pass : local;
      var active = mode === "play" ? Math.min(count - 1, Math.floor(passLocal / slot)) : -1;
      var within = mode === "play" ? passLocal - active * slot : 0;
      var shown = mode === "rest" ? 0 : mode === "alt" ? 1 : null;
      var poses = [];
      for (var i = 0; i < lines.length; i++) {
        var el = lines[i];
        el._now = elapsed;
        if (el._spin) {
          poses.push(el._from);
          continue;
        }
        if (el._count) {
          var n = mode === "rest" ? el._countLo : countValue(elapsed);
          var label = String(n) + el._gap + "ml";
          if (el.textContent !== label) el.textContent = label;
          poses.push({
            wght: el._from.wght,
            wdth: el._from.wdth,
            cntr: el._from.cntr,
            slnt: el._from.slnt,
            track: el._from.track,
          });
          continue;
        }
        var u = shown != null ? shown : blockMix(el._bi, active, within, move, returning);
        poses.push(mixPose(el._from, el._to, u));
      }
      containAll(poses);
      if (nowEl) {
        if (mode === "rest") nowEl.textContent = "rest · printed axes";
        else if (mode === "alt") nowEl.textContent = "alt · held inside the line";
        else
          nowEl.textContent =
            (returning ? "back" : "forward") +
            " · " +
            blocks[active] +
            " · " +
            (active + 1) +
            " / " +
            count;
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
