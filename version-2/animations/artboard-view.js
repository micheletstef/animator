(function (global) {
  var DEFAULT_W = 1080;
  var DEFAULT_H = 1440;
  var MIN_USER = 0.1;
  var MAX_USER = 8;
  var FIT_PAD_MIN = 48;
  var FIT_PAD_FRAC = 0.08;

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function readSize(root) {
    var cs = getComputedStyle(root);
    var w = parseFloat(cs.getPropertyValue("--ar-w"));
    var h = parseFloat(cs.getPropertyValue("--ar-h"));
    return {
      w: w > 0 ? w : DEFAULT_W,
      h: h > 0 ? h : DEFAULT_H,
    };
  }

  function init(options) {
    var wrap =
      (options && options.wrap) ||
      global.document.getElementById("stageWrap") ||
      global.document.querySelector(".stage-wrap");
    var outer =
      (options && options.outer) ||
      (wrap && wrap.querySelector(".stage-outer"));
    if (!wrap || !outer) return null;

    var root = global.document.documentElement;
    var userZoom = 1;
    var panX = 0;
    var panY = 0;
    var dragging = false;
    var lastX = 0;
    var lastY = 0;
    var pointerId = null;

    function fitPad(rect) {
      var m = Math.min(rect.width, rect.height);
      return Math.max(FIT_PAD_MIN, Math.round(m * FIT_PAD_FRAC));
    }

    function fitScale() {
      var size = readSize(root);
      var rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return 1;
      var pad = fitPad(rect);
      var w = Math.max(1, rect.width - pad * 2);
      var h = Math.max(1, rect.height - pad * 2);
      return Math.min(w / size.w, h / size.h);
    }

    function apply() {
      var size = readSize(root);
      var rect = wrap.getBoundingClientRect();
      var fit = fitScale();
      var scale = fit * userZoom;
      var x = (rect.width - size.w * scale) / 2 + panX;
      var y = (rect.height - size.h * scale) / 2 + panY;
      outer.style.transform =
        "translate(" + x + "px, " + y + "px) scale(" + scale + ")";
      return { fit: fit, scale: scale, x: x, y: y, w: size.w, h: size.h };
    }

    function reset() {
      userZoom = 1;
      panX = 0;
      panY = 0;
      apply();
    }

    function zoomAt(clientX, clientY, factor) {
      var next = clamp(userZoom * factor, MIN_USER, MAX_USER);
      if (next === userZoom) return;
      var rect = wrap.getBoundingClientRect();
      var state = apply();
      var mx = clientX - rect.left;
      var my = clientY - rect.top;
      var ax = (mx - state.x) / state.scale;
      var ay = (my - state.y) / state.scale;
      userZoom = next;
      var fit = fitScale();
      var scale = fit * userZoom;
      var x1 = mx - ax * scale;
      var y1 = my - ay * scale;
      panX = x1 - (rect.width - state.w * scale) / 2;
      panY = y1 - (rect.height - state.h * scale) / 2;
      apply();
    }

    wrap.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        var dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        if (e.deltaMode === 2) dy *= 800;
        var factor = Math.exp(-dy * 0.0018);
        zoomAt(e.clientX, e.clientY, factor);
      },
      { passive: false }
    );

    wrap.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      dragging = true;
      pointerId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      wrap.classList.add("is-panning");
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch (err) {}
      e.preventDefault();
    });

    wrap.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      e.preventDefault();
      panX += e.clientX - lastX;
      panY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      apply();
    });

    function endPan(e) {
      if (!dragging) return;
      if (e && pointerId != null && e.pointerId !== pointerId) return;
      dragging = false;
      pointerId = null;
      wrap.classList.remove("is-panning");
    }

    wrap.addEventListener("pointerup", endPan);
    wrap.addEventListener("pointercancel", endPan);
    wrap.addEventListener("lostpointercapture", endPan);

    wrap.addEventListener("dblclick", function (e) {
      if (e.button !== 0 && e.button != null) return;
      reset();
    });

    if (typeof ResizeObserver !== "undefined") {
      var ro = new ResizeObserver(function () {
        apply();
      });
      ro.observe(wrap);
    } else {
      global.addEventListener("resize", apply);
    }

    apply();
    global.requestAnimationFrame(function () {
      apply();
    });

    var api = {
      reset: reset,
      apply: apply,
      zoomAt: zoomAt,
    };
    wrap._artboardView = api;
    global.ArtboardView.current = api;
    ensureCaption();
    return api;
  }

  function ensureCaption() {
    var stage =
      global.document.getElementById("stage") ||
      global.document.querySelector(".stage");
    if (
      !stage ||
      stage.hasAttribute("data-no-caption") ||
      stage.querySelector(".stage-caption")
    ) {
      return;
    }
    var el = global.document.createElement("p");
    el.className = "stage-caption";
    el.textContent = "ABC Placeholder Caption";
    stage.appendChild(el);
  }

  function boot() {
    if (global.document.querySelector(".stage-wrap") && global.document.querySelector(".stage-outer")) {
      init();
    }
  }

  global.ArtboardView = {
    init: init,
    reset: function () {
      if (global.ArtboardView.current) global.ArtboardView.current.reset();
    },
    MIN: MIN_USER,
    MAX: MAX_USER,
  };

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
