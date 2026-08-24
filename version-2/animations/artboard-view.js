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

  function formatScale(scale) {
    var pct = scale * 100;
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

  function ensureScaleReadout(wrap) {
    var el = wrap.querySelector(".artboard-scale");
    if (el) return el;
    el = global.document.createElement("div");
    el.className = "artboard-scale";
    el.setAttribute("aria-live", "polite");
    wrap.appendChild(el);
    return el;
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
    var scaleEl = null;

    ensureScaleStyle();
    scaleEl = ensureScaleReadout(wrap);

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
      if (scaleEl) scaleEl.textContent = formatScale(scale);
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
    ensureGuides();
    ensureGuidesUi();
    ensureCaptionUi();
    enhancePanel();
    watchPanel();
    return api;
  }

  var DEFAULT_CAPTION = "ABC Placeholder Caption";

  function pageKey(prefix) {
    return prefix + global.location.pathname + global.location.search;
  }

  function captionKey() {
    return pageKey("animator:v2:caption:");
  }

  function captionColorKey() {
    return pageKey("animator:v2:caption-color:");
  }

  function accordionKey() {
    return pageKey("animator:v2:accordion:");
  }

  function guidesKey() {
    return pageKey("animator:v2:guides:");
  }

  function cssVarNumber(name, fallback) {
    var n = parseFloat(
      global.getComputedStyle(global.document.documentElement).getPropertyValue(name)
    );
    return isFinite(n) ? n : fallback;
  }

  function toHexColor(v) {
    v = String(v || "").trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(v)) return v;
    if (/^#[0-9a-f]{3}$/.test(v)) {
      return "#" + v.charAt(1) + v.charAt(1) + v.charAt(2) + v.charAt(2) + v.charAt(3) + v.charAt(3);
    }
    var m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    return (
      "#" +
      [m[1], m[2], m[3]]
        .map(function (x) {
          var h = Number(x).toString(16);
          return h.length < 2 ? "0" + h : h;
        })
        .join("")
    );
  }

  function defaultCaptionColor() {
    return (
      toHexColor(
        global.getComputedStyle(global.document.documentElement).getPropertyValue("--fg")
      ) || "#000000"
    );
  }

  function readCaption() {
    try {
      var raw = global.localStorage.getItem(captionKey());
      if (raw != null) return raw;
    } catch (err) {}
    return DEFAULT_CAPTION;
  }

  function writeCaption(text) {
    try {
      global.localStorage.setItem(captionKey(), text);
    } catch (err) {}
  }

  function readCaptionColor() {
    try {
      var hex = toHexColor(global.localStorage.getItem(captionColorKey()));
      if (hex) return hex;
    } catch (err) {}
    return defaultCaptionColor();
  }

  function writeCaptionColor(color) {
    try {
      global.localStorage.setItem(captionColorKey(), color);
    } catch (err) {}
  }

  function captionEl() {
    var stage =
      global.document.getElementById("stage") ||
      global.document.querySelector(".stage");
    if (!stage) return null;
    return stage.querySelector(".stage-caption");
  }

  function setCaption(text) {
    var el = captionEl();
    if (!el) return;
    el.textContent = text == null ? "" : String(text);
  }

  function setCaptionColor(color) {
    var hex = toHexColor(color) || defaultCaptionColor();
    var el = captionEl();
    global.document.documentElement.style.setProperty("--caption", hex);
    if (el) el.style.color = hex;
    return hex;
  }

  function ensureCaption() {
    var stage =
      global.document.getElementById("stage") ||
      global.document.querySelector(".stage");
    if (!stage) return;
    var el = stage.querySelector(".stage-caption");
    if (!el) {
      el = global.document.createElement("p");
      el.className = "stage-caption";
      stage.appendChild(el);
    }
    el.textContent = readCaption();
    setCaptionColor(readCaptionColor());
  }

  function ensureCaptionUi() {
    var panel = global.document.querySelector(".panel");
    if (!panel || global.document.getElementById("stageCaption")) return;
    var group = global.document.createElement("div");
    group.className = "group";
    group.innerHTML =
      '<p class="group-title">caption</p>' +
      '<div class="row row-span">' +
      '<label for="stageCaption">text</label>' +
      '<input id="stageCaption" type="text" autocomplete="off" spellcheck="false" />' +
      "</div>" +
      '<div class="row">' +
      '<label for="stageCaptionColor">color</label>' +
      '<input id="stageCaptionColor" type="color" />' +
      '<span class="val" id="stageCaptionColorVal"></span>' +
      "</div>";
    panel.appendChild(group);
    var input = global.document.getElementById("stageCaption");
    var color = global.document.getElementById("stageCaptionColor");
    var colorVal = global.document.getElementById("stageCaptionColorVal");
    input.value = readCaption();
    color.value = readCaptionColor();
    colorVal.textContent = color.value;
    input.addEventListener("input", function () {
      setCaption(input.value);
      writeCaption(input.value);
    });
    color.addEventListener("input", function () {
      var hex = setCaptionColor(color.value);
      colorVal.textContent = hex;
      writeCaptionColor(hex);
    });
  }

  function defaultGuides() {
    var m = Math.round(cssVarNumber("--pad-l", cssVarNumber("--pad-t", 64)));
    return {
      on: true,
      margin: m,
      t: m,
      r: m,
      b: m,
      l: m,
      cols: 1,
      gutter: 24,
    };
  }

  function clampMargin(n) {
    return Math.max(0, Math.min(480, Math.round(Number(n) || 0)));
  }

  function readGuides() {
    var data = defaultGuides();
    try {
      var raw = global.localStorage.getItem(guidesKey());
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          Object.keys(data).forEach(function (k) {
            if (parsed[k] != null) data[k] = parsed[k];
          });
        }
      }
    } catch (err) {}
    data.on = !!data.on;
    var m = data.margin;
    if (m == null) m = data.l != null ? data.l : data.t;
    m = clampMargin(m);
    data.margin = data.t = data.r = data.b = data.l = m;
    data.cols = Math.max(1, Math.min(12, Math.round(Number(data.cols) || 1)));
    data.gutter = Math.max(0, Math.min(160, Math.round(Number(data.gutter) || 0)));
    return data;
  }

  function writeGuides(data) {
    try {
      global.localStorage.setItem(guidesKey(), JSON.stringify(data));
    } catch (err) {}
  }

  function applyGuides(data) {
    var g = data || readGuides();
    var root = global.document.documentElement;
    root.style.setProperty("--guide-t", g.t + "px");
    root.style.setProperty("--guide-r", g.r + "px");
    root.style.setProperty("--guide-b", g.b + "px");
    root.style.setProperty("--guide-l", g.l + "px");
    root.style.setProperty("--guide-gutter", g.gutter + "px");
    var overlay = global.document.querySelector(".stage-guides");
    if (!overlay) return;
    overlay.hidden = !g.on;
    overlay.setAttribute("aria-hidden", g.on ? "false" : "true");
    var cols = overlay.querySelector(".guide-cols");
    if (!cols) return;
    cols.style.gap = g.gutter + "px";
    cols.style.gridTemplateColumns = "repeat(" + g.cols + ", minmax(0, 1fr))";
    while (cols.childElementCount > g.cols) cols.removeChild(cols.lastChild);
    while (cols.childElementCount < g.cols) {
      cols.appendChild(global.document.createElement("span"));
    }
  }

  function ensureGuides() {
    var stage =
      global.document.getElementById("stage") ||
      global.document.querySelector(".stage");
    if (!stage) return;
    var overlay = stage.querySelector(".stage-guides");
    if (!overlay) {
      overlay = global.document.createElement("div");
      overlay.className = "stage-guides";
      overlay.innerHTML = '<div class="guide-margin"></div><div class="guide-cols"></div>';
      stage.appendChild(overlay);
    }
    applyGuides();
  }

  function ensureGuidesUi() {
    var panel = global.document.querySelector(".panel");
    if (!panel || global.document.getElementById("guideOn")) return;
    var g = readGuides();
    var group = global.document.createElement("div");
    group.className = "group";
    group.innerHTML =
      '<p class="group-title">guides</p>' +
      '<div class="row">' +
      '<label for="guideOn">show</label>' +
      '<input id="guideOn" type="checkbox" />' +
      '<span class="val" id="guideOnVal">on</span>' +
      "</div>" +
      '<div class="row row-span">' +
      '<label for="guideMargin">margin</label>' +
      '<input id="guideMargin" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" />' +
      "</div>" +
      '<div class="row row-span">' +
      '<label for="guideCols">columns</label>' +
      '<input id="guideCols" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" />' +
      "</div>" +
      '<div class="row row-span">' +
      '<label for="guideGutter">gutter</label>' +
      '<input id="guideGutter" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" />' +
      "</div>";
    var captionGroup = global.document.getElementById("stageCaption");
    captionGroup = captionGroup && captionGroup.closest(".group");
    if (captionGroup) panel.insertBefore(group, captionGroup);
    else panel.appendChild(group);

    var els = {
      on: global.document.getElementById("guideOn"),
      margin: global.document.getElementById("guideMargin"),
      cols: global.document.getElementById("guideCols"),
      gutter: global.document.getElementById("guideGutter"),
    };
    var onVal = global.document.getElementById("guideOnVal");
    var limits = {
      margin: [0, 480],
      cols: [1, 12],
      gutter: [0, 160],
    };

    function clampGuide(key, raw) {
      var n = Number(raw);
      if (!isFinite(n)) n = key === "cols" ? 1 : 0;
      var lim = limits[key];
      return Math.max(lim[0], Math.min(lim[1], Math.round(n)));
    }

    function setMargin(n) {
      n = clampGuide("margin", n);
      g.margin = g.t = g.r = g.b = g.l = n;
    }

    function paint(syncFields) {
      els.on.checked = g.on;
      onVal.textContent = g.on ? "on" : "off";
      if (syncFields !== false) {
        els.margin.value = String(g.margin);
        els.cols.value = String(g.cols);
        els.gutter.value = String(g.gutter);
      }
      applyGuides(g);
      writeGuides(g);
    }

    els.on.addEventListener("input", function () {
      g.on = !!els.on.checked;
      paint(false);
    });
    ["margin", "cols", "gutter"].forEach(function (key) {
      els[key].addEventListener("input", function () {
        var raw = String(els[key].value).trim();
        if (raw === "" || raw === "-") return;
        if (!/^-?\d+$/.test(raw)) return;
        if (key === "margin") setMargin(raw);
        else g[key] = clampGuide(key, raw);
        paint(false);
      });
      els[key].addEventListener("change", function () {
        if (key === "margin") setMargin(els[key].value);
        else g[key] = clampGuide(key, els[key].value);
        paint(true);
      });
    });
    paint();
  }

  function readAccordion() {
    try {
      var raw = global.localStorage.getItem(accordionKey());
      if (!raw) return {};
      var data = JSON.parse(raw);
      return data && typeof data === "object" ? data : {};
    } catch (err) {
      return {};
    }
  }

  function writeAccordion(state) {
    try {
      global.localStorage.setItem(accordionKey(), JSON.stringify(state));
    } catch (err) {}
  }

  function groupName(group) {
    var title = group.querySelector(".group-title");
    return ((title && title.textContent) || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function defaultCollapsed(name) {
    return false;
  }

  function enhanceGroup(group) {
    if (!group || group.dataset.accordion === "1") return;
    var title = group.querySelector(".group-title");
    if (!title) return;
    group.dataset.accordion = "1";

    var btn = global.document.createElement("button");
    btn.type = "button";
    btn.className = "group-toggle";

    var head = global.document.createElement("div");
    head.className = "group-head";
    group.insertBefore(head, title);
    head.appendChild(title);
    head.appendChild(btn);

    var body = global.document.createElement("div");
    body.className = "group-body";
    while (head.nextSibling) body.appendChild(head.nextSibling);
    group.appendChild(body);

    var name = groupName(group);
    var state = readAccordion();
    var collapsed =
      Object.prototype.hasOwnProperty.call(state, name)
        ? !!state[name]
        : defaultCollapsed(name);

    function apply(isCollapsed) {
      group.classList.toggle("is-collapsed", isCollapsed);
      btn.textContent = isCollapsed ? "+" : "–";
      btn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
      btn.setAttribute("aria-label", isCollapsed ? "expand " + name : "collapse " + name);
    }

    apply(collapsed);
    head.addEventListener("click", function (e) {
      e.preventDefault();
      var next = !group.classList.contains("is-collapsed");
      apply(next);
      var nextState = readAccordion();
      nextState[name] = next ? 1 : 0;
      writeAccordion(nextState);
    });
  }

  function enhancePanel() {
    var panel = global.document.querySelector(".panel");
    if (!panel) return;
    var groups = panel.querySelectorAll(".group");
    for (var i = 0; i < groups.length; i++) enhanceGroup(groups[i]);
  }

  function watchPanel() {
    var panel = global.document.querySelector(".panel");
    if (!panel || panel._accordionWatch) return;
    panel._accordionWatch = true;
    if (typeof MutationObserver === "undefined") return;
    var mo = new MutationObserver(function () {
      enhancePanel();
    });
    mo.observe(panel, { childList: true });
  }

  function boot() {
    if (global.ArtboardView.current) return;
    if (global.document.querySelector(".stage-wrap") && global.document.querySelector(".stage-outer")) {
      init();
    }
  }

  global.ArtboardView = {
    init: init,
    reset: function () {
      if (global.ArtboardView.current) global.ArtboardView.current.reset();
    },
    setCaption: setCaption,
    readCaption: readCaption,
    enhancePanel: enhancePanel,
    MIN: MIN_USER,
    MAX: MAX_USER,
  };

  if (global.document.querySelector(".stage-wrap")) {
    boot();
  } else if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
