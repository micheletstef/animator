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
    setCaptionColor(readCaptionColor());
    if (captionsEnabled()) {
      ensureCaption();
    }
    ensureCaptionUi();
    ensureGuides();
    ensureGuidesUi();
    bindGuideHotkey();
    enhancePanel();
    ensureCaseUi();
    bindPanelPersist();
    watchPanel();
    return api;
  }

  var DEFAULT_CAPTION = "ABC Placeholder Caption";

  function captionsEnabled() {
    var root = global.document.body || global.document.documentElement;
    return !(root && root.hasAttribute("data-no-caption"));
  }

  function splitCaptionEnabled() {
    var root = global.document.body || global.document.documentElement;
    return !!(root && root.hasAttribute("data-split-caption"));
  }

  function pairCaptionEnabled() {
    var root = global.document.body || global.document.documentElement;
    return !!(root && root.hasAttribute("data-pair-caption"));
  }

  function parseCaptionParts(text) {
    text = String(text == null ? "" : text);
    var i = text.lastIndexOf(" ");
    if (i < 0) return { label: text, value: "" };
    return {
      label: text.slice(0, i),
      value: text.slice(i + 1),
    };
  }

  var PREFIX_CAPTION = "animator:v2:caption:";
  var PREFIX_CAPTION_COLOR = "animator:v2:caption-color:";
  var PREFIX_ACCORDION = "animator:v2:accordion:";
  var PREFIX_GUIDES = "animator:v2:guides:";
  var PREFIX_CASE = "animator:v2:case:";
  var GUIDES_GLOBAL = "animator:v2:guides";

  function stableSearch(search) {
    search = search == null ? global.location.search : search;
    if (!search) return "";
    var params;
    try {
      params = new URLSearchParams(search.charAt(0) === "?" ? search : "?" + search);
      params.delete("v");
      var q = params.toString();
      return q ? "?" + q : "";
    } catch (err) {
      return String(search);
    }
  }

  function pageKey(prefix) {
    return prefix + global.location.pathname + stableSearch();
  }

  function storedIdentity(prefix, key) {
    var base = prefix + global.location.pathname;
    if (!key || key.indexOf(base) !== 0) return false;
    var rest = key.slice(base.length);
    if (rest && rest.charAt(0) !== "?") return false;
    return stableSearch(rest) === stableSearch();
  }

  function readStored(prefix) {
    var primary = pageKey(prefix);
    try {
      var raw = global.localStorage.getItem(primary);
      if (raw != null) return raw;
      var i;
      var k;
      for (i = 0; i < global.localStorage.length; i++) {
        k = global.localStorage.key(i);
        if (!k || k === primary || !storedIdentity(prefix, k)) continue;
        raw = global.localStorage.getItem(k);
        if (raw == null) continue;
        try {
          global.localStorage.setItem(primary, raw);
        } catch (err) {}
        return raw;
      }
    } catch (err) {}
    return null;
  }

  function writeStored(prefix, value) {
    try {
      global.localStorage.setItem(pageKey(prefix), value);
    } catch (err) {}
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
    var raw = readStored(PREFIX_CAPTION);
    if (raw != null) return raw;
    return DEFAULT_CAPTION;
  }

  function writeCaption(text) {
    writeStored(PREFIX_CAPTION, text);
  }

  function readCaptionColor() {
    var hex = toHexColor(readStored(PREFIX_CAPTION_COLOR));
    if (hex) return hex;
    return defaultCaptionColor();
  }

  function writeCaptionColor(color) {
    var hex = toHexColor(color);
    if (hex) writeStored(PREFIX_CAPTION_COLOR, hex);
  }

  function captionEl() {
    var stage =
      global.document.getElementById("stage") ||
      global.document.querySelector(".stage");
    if (!stage) return null;
    return stage.querySelector(".stage-caption");
  }

  function makeCaptionPair() {
    var label = global.document.createElement("span");
    label.className = "caption-label";
    var value = global.document.createElement("span");
    value.className = "caption-value";
    var sizer = global.document.createElement("span");
    sizer.className = "caption-value-sizer";
    sizer.setAttribute("aria-hidden", "true");
    var text = global.document.createElement("span");
    text.className = "caption-value-text";
    value.appendChild(sizer);
    value.appendChild(text);
    return { label: label, value: value };
  }

  function writeCaptionPair(labelEl, valueEl, label, value) {
    var labelText = label == null ? "" : String(label);
    var valueText = value == null ? "" : String(value);
    if (labelEl) labelEl.textContent = labelText;
    if (!valueEl) return;
    var sizer = valueEl.querySelector(".caption-value-sizer");
    var text = valueEl.querySelector(".caption-value-text");
    if (!sizer || !text) {
      valueEl.textContent = "";
      sizer = global.document.createElement("span");
      sizer.className = "caption-value-sizer";
      sizer.setAttribute("aria-hidden", "true");
      text = global.document.createElement("span");
      text.className = "caption-value-text";
      valueEl.appendChild(sizer);
      valueEl.appendChild(text);
    }
    sizer.textContent = labelText;
    text.textContent = valueText;
    valueEl.classList.toggle("is-empty", !valueText);
  }

  function setCaption(text) {
    var el = captionEl();
    if (!el) return;
    if (Array.isArray(text)) {
      if (pairCaptionEnabled() && text.length <= 1) {
        var row = text[0] || {};
        setPairedCaption(el, row.label, row.value);
        return;
      }
      setStackedCaption(el, text);
      return;
    }
    text = text == null ? "" : String(text);
    el.classList.remove("is-stack", "is-pair");
    if (!splitCaptionEnabled()) {
      el.classList.remove("is-split");
      el.textContent = text;
      return;
    }
    el.classList.add("is-split");
    if (el.querySelector(".caption-row")) el.textContent = "";
    var parts = parseCaptionParts(text);
    var label = el.querySelector(":scope > .caption-label");
    var value = el.querySelector(":scope > .caption-value");
    if (!label || !value) {
      el.textContent = "";
      var pair = makeCaptionPair();
      label = pair.label;
      value = pair.value;
      el.appendChild(label);
      el.appendChild(value);
    }
    writeCaptionPair(label, value, parts.label, parts.value);
  }

  function setPairedCaption(el, label, value) {
    el.classList.remove("is-split", "is-stack");
    el.classList.add("is-pair");
    var labelEl = el.querySelector(":scope > .caption-label");
    var valueEl = el.querySelector(":scope > .caption-value");
    if (
      !labelEl ||
      !valueEl ||
      el.querySelector(".caption-row") ||
      el.querySelector(".caption-value-sizer")
    ) {
      el.textContent = "";
      labelEl = global.document.createElement("span");
      labelEl.className = "caption-label";
      valueEl = global.document.createElement("span");
      valueEl.className = "caption-value";
      el.appendChild(labelEl);
      el.appendChild(valueEl);
    }
    var labelText = label == null ? "" : String(label);
    var valueText = value == null ? "" : String(value);
    labelEl.textContent = labelText;
    valueEl.textContent = valueText;
    labelEl.style.paddingRight = labelText && valueText ? "var(--guide-gutter, 24px)" : "0";
    valueEl.classList.toggle("is-empty", !valueText);
    if (!labelText && !valueText) el.classList.remove("is-pair");
  }

  function setStackedCaption(el, rows) {
    el.classList.remove("is-pair");
    el.classList.add("is-split", "is-stack");
    var nodes = el.querySelectorAll(".caption-row");
    var i;
    if (nodes.length !== rows.length) {
      el.textContent = "";
      for (i = 0; i < rows.length; i++) {
        var row = global.document.createElement("span");
        row.className = "caption-row";
        var pair = makeCaptionPair();
        row.appendChild(pair.label);
        row.appendChild(pair.value);
        el.appendChild(row);
      }
      nodes = el.querySelectorAll(".caption-row");
    }
    for (i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      var node = nodes[i];
      writeCaptionPair(
        node.querySelector(".caption-label"),
        node.querySelector(".caption-value"),
        r.label,
        r.value
      );
      node.classList.toggle("is-inactive", r.active === false);
    }
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
    setCaption(readCaption());
    setCaptionColor(readCaptionColor());
  }

  function findPanelGroup(name) {
    var panel = global.document.querySelector(".panel");
    if (!panel) return null;
    var titles = panel.querySelectorAll(".group-title");
    var want = String(name || "").toLowerCase();
    var i;
    for (i = 0; i < titles.length; i++) {
      var text = ((titles[i].textContent) || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (text === want || text.indexOf(want + " ") === 0) {
        return titles[i].closest(".group");
      }
    }
    return null;
  }

  function groupBody(group) {
    if (!group) return null;
    return group.querySelector(".group-body") || group;
  }

  function ensureCaptionUi() {
    var panel = global.document.querySelector(".panel");
    if (!panel || panel.getAttribute("data-caption-ui") === "1") return;
    panel.setAttribute("data-caption-ui", "1");

    var colorGroup = findPanelGroup("color");
    if (
      captionsEnabled() &&
      colorGroup &&
      !global.document.getElementById("stageCaptionColor")
    ) {
      var colorRow = global.document.createElement("div");
      colorRow.className = "row";
      colorRow.innerHTML =
        '<label for="stageCaptionColor">caption</label>' +
        '<input id="stageCaptionColor" type="color" />' +
        '<span class="val" id="stageCaptionColorVal"></span>';
      groupBody(colorGroup).appendChild(colorRow);
    }

    if (captionsEnabled()) {
      var contentGroup = findPanelGroup("content") || findPanelGroup("copy");
      if (!contentGroup) {
        contentGroup = global.document.createElement("div");
        contentGroup.className = "group";
        contentGroup.innerHTML = '<p class="group-title">content</p>';
        if (colorGroup && colorGroup.nextSibling) {
          panel.insertBefore(contentGroup, colorGroup.nextSibling);
        } else if (colorGroup) {
          panel.appendChild(contentGroup);
        } else {
          panel.insertBefore(contentGroup, panel.querySelector(".group"));
        }
      } else {
        var title = contentGroup.querySelector(".group-title");
        if (title) title.textContent = "content";
      }

      var textRow = global.document.createElement("div");
      textRow.className = "row row-span";
      textRow.innerHTML =
        '<label for="stageCaption">caption</label>' +
        '<input id="stageCaption" type="text" autocomplete="off" spellcheck="false" />';
      var contentTitle = contentGroup.querySelector(".group-title");
      if (contentTitle && contentTitle.nextSibling) {
        contentGroup.insertBefore(textRow, contentTitle.nextSibling);
      } else {
        groupBody(contentGroup).appendChild(textRow);
      }
    }

    var input = global.document.getElementById("stageCaption");
    var color = global.document.getElementById("stageCaptionColor");
    var colorVal = global.document.getElementById("stageCaptionColorVal");
    if (input) {
      input.value = readCaption();
      input.addEventListener("input", function () {
        setCaption(input.value);
        writeCaption(input.value);
      });
    }
    if (color && colorVal) {
      color.value = readCaptionColor();
      colorVal.textContent = color.value;
      function onCaptionColor() {
        var hex = setCaptionColor(color.value);
        colorVal.textContent = hex;
        writeCaptionColor(hex);
      }
      color.addEventListener("input", onCaptionColor);
      color.addEventListener("change", onCaptionColor);
    }
  }

  var CASE_MODES = ["none", "lower", "upper"];
  var CASE_GLYPH = { none: "Aa", lower: "aa", upper: "AA" };
  var CASE_NAME = { none: "unchanged", lower: "lowercase", upper: "uppercase" };

  function applyCaseText(text, mode) {
    text = String(text == null ? "" : text);
    if (mode === "lower") return text.toLowerCase();
    if (mode === "upper") return text.toUpperCase();
    return text;
  }

  function isContentTextField(el) {
    if (!el || el.id === "stageCaption") return false;
    var tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag !== "INPUT") return false;
    var type = (el.getAttribute("type") || "text").toLowerCase();
    if (type !== "text") return false;
    if ((el.getAttribute("inputmode") || "").toLowerCase() === "numeric") return false;
    return true;
  }

  function paintCaseBtn(btn, mode) {
    btn.textContent = CASE_GLYPH[mode] || CASE_GLYPH.none;
    btn.setAttribute("data-mode", mode);
    btn.title = CASE_NAME[mode] || CASE_NAME.none;
    btn.setAttribute(
      "aria-label",
      "letter case: " + (CASE_NAME[mode] || CASE_NAME.none)
    );
  }

  function readCaseMap() {
    try {
      var raw = readStored(PREFIX_CASE);
      if (!raw) return {};
      var data = JSON.parse(raw);
      return data && typeof data === "object" ? data : {};
    } catch (err) {
      return {};
    }
  }

  function writeCaseMap(map) {
    writeStored(PREFIX_CASE, JSON.stringify(map));
  }

  function enhanceCaseField(field) {
    if (!isContentTextField(field) || field.dataset.caseToggle === "1") return;
    var row = field.closest(".row");
    if (!row) return;
    field.dataset.caseToggle = "1";
    row.classList.add("row-case");

    var state = { mode: "none", source: field.value, applying: false };
    if (field.id) {
      var saved = readCaseMap()[field.id];
      if (saved && CASE_MODES.indexOf(saved.mode) >= 0) {
        state.mode = saved.mode;
        if (saved.source != null) state.source = String(saved.source);
      }
    }

    var btn = global.document.createElement("button");
    btn.type = "button";
    btn.className = "case-toggle";
    paintCaseBtn(btn, state.mode);

    function persistCase() {
      if (!field.id) return;
      var map = readCaseMap();
      map[field.id] = { mode: state.mode, source: state.source };
      writeCaseMap(map);
    }

    function apply() {
      var next = applyCaseText(state.source, state.mode);
      paintCaseBtn(btn, state.mode);
      persistCase();
      if (field.value === next) return;
      state.applying = true;
      field.value = next;
      try {
        field.dispatchEvent(new Event("input", { bubbles: true }));
      } finally {
        state.applying = false;
      }
    }

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (state.mode === "none") state.source = field.value;
      var idx = CASE_MODES.indexOf(state.mode);
      state.mode = CASE_MODES[(idx + 1) % CASE_MODES.length];
      apply();
    });

    field.addEventListener(
      "input",
      function () {
        if (state.applying) return;
        state.source = field.value;
        persistCase();
        if (state.mode === "none") return;
        var next = applyCaseText(state.source, state.mode);
        if (next === field.value) return;
        var start = field.selectionStart;
        var end = field.selectionEnd;
        state.applying = true;
        field.value = next;
        state.applying = false;
        try {
          if (start != null && end != null) field.setSelectionRange(start, end);
        } catch (err) {}
      },
      true
    );

    if (field.nextSibling) {
      field.parentNode.insertBefore(btn, field.nextSibling);
    } else {
      field.parentNode.appendChild(btn);
    }

    global.setTimeout(function () {
      if (state.mode === "none") {
        state.source = field.value;
      } else if (applyCaseText(state.source, state.mode) !== field.value) {
        state.source = field.value;
      }
      paintCaseBtn(btn, state.mode);
      persistCase();
    }, 0);
  }

  function ensureCaseUi() {
    var group = findPanelGroup("content") || findPanelGroup("copy");
    if (!group) return;
    var fields = group.querySelectorAll("input, textarea");
    for (var i = 0; i < fields.length; i++) enhanceCaseField(fields[i]);
  }

  function attrNumber(name, fallback) {
    var body = global.document.body;
    if (!body || !body.hasAttribute(name)) return fallback;
    var n = Number(body.getAttribute(name));
    return isFinite(n) ? n : fallback;
  }

  function defaultGuides() {
    var m = Math.round(
      attrNumber(
        "data-guide-margin",
        cssVarNumber("--pad-l", cssVarNumber("--pad-t", 64))
      )
    );
    return {
      on: true,
      margin: m,
      t: m,
      r: m,
      b: m,
      l: m,
      cols: Math.max(1, Math.min(12, Math.round(attrNumber("data-guide-cols", 1)))),
      gutter: Math.max(0, Math.min(160, Math.round(attrNumber("data-guide-gutter", 24)))),
    };
  }

  function clampMargin(n) {
    return Math.max(0, Math.min(480, Math.round(Number(n) || 0)));
  }

  function readGuides() {
    var data = defaultGuides();
    try {
      var raw;
      var body = global.document.body;
      if (body && body.hasAttribute("data-guide-cols")) {
        raw = readStored(PREFIX_GUIDES);
      } else {
        raw = global.localStorage.getItem(GUIDES_GLOBAL);
      }
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
    var body = global.document.body;
    var payload = JSON.stringify(data);
    if (body && body.hasAttribute("data-guide-cols")) {
      writeStored(PREFIX_GUIDES, payload);
      return;
    }
    try {
      global.localStorage.setItem(GUIDES_GLOBAL, payload);
    } catch (err) {}
  }

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "textarea" || tag === "select") return true;
    if (tag === "input") {
      var type = String(el.type || "text").toLowerCase();
      return (
        type !== "checkbox" &&
        type !== "radio" &&
        type !== "button" &&
        type !== "submit" &&
        type !== "reset" &&
        type !== "file" &&
        type !== "color" &&
        type !== "range"
      );
    }
    return !!el.isContentEditable;
  }

  function toggleGuides() {
    var checkbox = global.document.getElementById("guideOn");
    if (checkbox) {
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    var g = readGuides();
    g.on = !g.on;
    applyGuides(g);
    writeGuides(g);
  }

  function bindGuideHotkey() {
    if (global.document.documentElement.dataset.guideHotkey === "1") return;
    global.document.documentElement.dataset.guideHotkey = "1";
    global.document.addEventListener("keydown", function (e) {
      if (e.defaultPrevented || e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "g" && e.key !== "G") return;
      if (isTypingTarget(e.target) || isTypingTarget(global.document.activeElement)) {
        return;
      }
      e.preventDefault();
      toggleGuides();
    });
  }

  function applyGuides(data) {
    var g = data || readGuides();
    var root = global.document.documentElement;
    root.style.setProperty("--guide-t", g.t + "px");
    root.style.setProperty("--guide-r", g.r + "px");
    root.style.setProperty("--guide-b", g.b + "px");
    root.style.setProperty("--guide-l", g.l + "px");
    root.style.setProperty("--guide-gutter", g.gutter + "px");
    root.style.setProperty("--pad-t", String(g.t));
    root.style.setProperty("--pad-r", String(g.r));
    root.style.setProperty("--pad-b", String(g.b));
    root.style.setProperty("--pad-l", String(g.l));
    var overlay = global.document.querySelector(".stage-guides");
    if (!overlay) return;
    overlay.hidden = !g.on;
    overlay.setAttribute("aria-hidden", g.on ? "false" : "true");
    var cols = overlay.querySelector(".guide-cols");
    if (!cols) return;
    var tracks = [];
    var gutterPx = (g.gutter > 0 ? g.gutter : 1) + "px";
    var i;
    if (g.cols === 1) {
      tracks.push("minmax(0, 1fr)");
      if (g.gutter > 0) {
        tracks.push(g.gutter + "px");
        tracks.push("minmax(0, 1fr)");
      }
    } else {
      for (i = 0; i < g.cols; i++) {
        if (i) tracks.push(gutterPx);
        tracks.push("minmax(0, 1fr)");
      }
    }
    cols.style.gap = "0px";
    cols.style.gridTemplateColumns = tracks.join(" ");
    var want = tracks.length;
    while (cols.childElementCount > want) cols.removeChild(cols.lastChild);
    while (cols.childElementCount < want) {
      cols.appendChild(global.document.createElement("span"));
    }
    for (i = 0; i < cols.childElementCount; i++) {
      var isGutter = g.cols === 1 ? i === 1 && g.gutter > 0 : i % 2 === 1;
      cols.children[i].className = isGutter ? "guide-gutter" : "";
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
      stage.appendChild(overlay);
    }
    if (!overlay.querySelector(".guide-matte")) {
      overlay.innerHTML =
        '<div class="guide-matte">' +
        '<span class="guide-matte-t"></span>' +
        '<span class="guide-matte-r"></span>' +
        '<span class="guide-matte-b"></span>' +
        '<span class="guide-matte-l"></span>' +
        "</div>" +
        '<div class="guide-margin"></div>' +
        '<div class="guide-cols"></div>' +
        '<div class="guide-center">' +
        '<span class="guide-center-h"></span>' +
        "</div>";
    } else if (!overlay.querySelector(".guide-center")) {
      var center = global.document.createElement("div");
      center.className = "guide-center";
      center.innerHTML = '<span class="guide-center-h"></span>';
      overlay.appendChild(center);
    }
    var vline = overlay.querySelector(".guide-center-v");
    if (vline && vline.parentNode) vline.parentNode.removeChild(vline);
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
    if (captionGroup) {
      panel.insertBefore(group, captionGroup);
    } else {
      var colorGroup = findPanelGroup("color");
      if (colorGroup && colorGroup.nextSibling) {
        panel.insertBefore(group, colorGroup.nextSibling);
      } else {
        var actions = panel.querySelector(".actions");
        if (actions) panel.insertBefore(group, actions);
        else panel.appendChild(group);
      }
    }

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
      var raw = readStored(PREFIX_ACCORDION);
      if (!raw) return {};
      var data = JSON.parse(raw);
      return data && typeof data === "object" ? data : {};
    } catch (err) {
      return {};
    }
  }

  function writeAccordion(state) {
    writeStored(PREFIX_ACCORDION, JSON.stringify(state));
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
      ensureCaseUi();
    });
    mo.observe(panel, { childList: true });
  }

  function bindPanelPersist() {
    var panel = global.document.querySelector(".panel");
    if (!panel || panel.dataset.persistColors === "1") return;
    panel.dataset.persistColors = "1";
    panel.addEventListener("change", function (e) {
      var el = e.target;
      if (!el || String(el.type || "").toLowerCase() !== "color") return;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
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
    toggleGuides: toggleGuides,
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
