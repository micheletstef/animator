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

  function apply(z) {
    z = clamp(z);
    try {
      global.document.documentElement.style.setProperty("--zoom", String(z));
    } catch (e) {}
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

  /** Prefer global zoom; migrate a per-animation saved value once. */
  function resolve(legacyZm) {
    var current = read();
    if (current != null) return apply(current);
    if (legacyZm != null && legacyZm !== DEFAULT) {
      return write(legacyZm);
    }
    return apply(DEFAULT);
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
    apply(read() != null ? read() : DEFAULT);
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
