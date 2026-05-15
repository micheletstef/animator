(function (global) {
  var KEY = "animator:artboard-zoom:v1";
  var MIN = 0.1;
  var MAX = 4;
  var DEFAULT = 1;

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

  function write(z) {
    z = clamp(z);
    try {
      global.localStorage.setItem(KEY, String(z));
    } catch (e) {}
    return z;
  }

  /** Prefer global zoom; migrate a per-animation saved value once. */
  function resolve(legacyZm) {
    var current = read();
    if (current != null) return current;
    if (legacyZm != null && legacyZm !== DEFAULT) {
      return write(legacyZm);
    }
    return DEFAULT;
  }

  function onChange(cb) {
    global.addEventListener("storage", function (e) {
      if (e.key !== KEY || e.newValue == null) return;
      cb(clamp(parseFloat(e.newValue)));
    });
  }

  global.ArtboardZoom = {
    KEY: KEY,
    MIN: MIN,
    MAX: MAX,
    DEFAULT: DEFAULT,
    clamp: clamp,
    read: read,
    write: write,
    resolve: resolve,
    onChange: onChange,
  };
})(window);
