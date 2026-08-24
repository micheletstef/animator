(function (global) {
  var KEY = "animator:artboard-zoom:v1";
  var MIN = 0.1;
  var MAX = 4;
  var DEFAULT = 1;
  var listeners = [];

  function clamp(z) {
    var n = Number(z);
    if (!isFinite(n)) return DEFAULT;
    return Math.max(MIN, Math.min(MAX, n));
  }

  function read() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw == null) return null;
      return clamp(parseFloat(raw));
    } catch (e) {
      return null;
    }
  }

  function formatScale(z) {
    var pct = z * 100;
    if (!isFinite(pct)) return "";
    return Math.round(pct) + "%";
  }

  function ensureScaleStyle() {
    if (global.document.getElementById("artboard-scale-style")) return;
    var s = global.document.createElement("style");
    s.id = "artboard-scale-style";
    s.textContent =
      ".stage-wrap{position:relative}.artboard-scale{position:absolute;left:0;right:0;bottom:10px;z-index:6;margin:0;text-align:center;pointer-events:none;font-family:\"Courier New\",Courier,monospace;font-size:12px;line-height:1;color:#555;letter-spacing:0.02em}";
    global.document.head.appendChild(s);
  }

  function ensureScaleReadout() {
    var wrap = stageWrapEl();
    if (!wrap) return null;
    var el = wrap.querySelector(".artboard-scale");
    if (el) return el;
    el = global.document.createElement("div");
    el.className = "artboard-scale";
    el.setAttribute("aria-live", "polite");
    wrap.appendChild(el);
    return el;
  }

  function paintScale(z) {
    var el = ensureScaleReadout();
    if (el) el.textContent = formatScale(z);
  }

  function apply(z) {
    z = clamp(z);
    try {
      global.document.documentElement.style.setProperty("--zoom", String(z));
    } catch (e) {}
    paintScale(z);
    return z;
  }

  function notify(z) {
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](z);
      } catch (e) {}
    }
  }

  function write(z) {
    z = clamp(z);
    try {
      global.localStorage.setItem(KEY, String(z));
    } catch (e) {}
    apply(z);
    notify(z);
    return z;
  }

  /** Always open at the default fit scale; ignore stored / legacy zoom. */
  function resolve(legacyZm) {
    return write(DEFAULT);
  }

  function onChange(cb) {
    listeners.push(cb);
    global.addEventListener("storage", function (e) {
      if (e.key !== KEY || e.newValue == null) return;
      var z = apply(clamp(parseFloat(e.newValue)));
      cb(z);
    });
  }

  function stageWrapEl() {
    return (
      global.document.getElementById("stageWrap") ||
      global.document.querySelector(".stage-wrap")
    );
  }

  function bindWheel() {
    var stageWrap = stageWrapEl();
    if (!stageWrap) return;
    global.addEventListener(
      "wheel",
      function (e) {
        if (!e.shiftKey) return;
        e.preventDefault();
        var stored = read();
        var current = stored != null ? stored : DEFAULT;
        var factor = Math.exp(-e.deltaY * 0.0015);
        var next = clamp(current * factor);
        if (next === current) return;
        var rect = stageWrap.getBoundingClientRect();
        var anchorX = Math.max(rect.left, Math.min(rect.right, e.clientX));
        var anchorY = Math.max(rect.top, Math.min(rect.bottom, e.clientY));
        var contentX = anchorX - rect.left + stageWrap.scrollLeft;
        var contentY = anchorY - rect.top + stageWrap.scrollTop;
        var ratio = next / current;
        write(next);
        stageWrap.scrollLeft = contentX * ratio - (anchorX - rect.left);
        stageWrap.scrollTop = contentY * ratio - (anchorY - rect.top);
      },
      { passive: false }
    );
  }

  function init() {
    ensureScaleStyle();
    write(DEFAULT);
    bindWheel();
  }

  global.ArtboardZoom = {
    KEY: KEY,
    MIN: MIN,
    MAX: MAX,
    DEFAULT: DEFAULT,
    clamp: clamp,
    read: read,
    apply: apply,
    write: write,
    resolve: resolve,
    onChange: onChange,
    bindWheel: bindWheel,
    init: init,
  };

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
