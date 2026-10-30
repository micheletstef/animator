/**
 * Glyphs-style glyph outline overlay (paths, on-curve nodes, off-curve handles).
 * Uses opentype.js variable-font outlines aligned to live DOM text.
 */
(function (global) {
  var fontPromise = null;
  var fontUrl = null;
  var syncGen = 0;
  var fontsPrimed = false;
  var cachedFont = null;
  var cachedFontBuf = null;
  var cachedHbState = null;
  var cachedKern = null;
  var hbModulePromise = null;
  var COLORS = {
    path: "rgba(0, 120, 255, 0.85)",
    handleLine: "rgba(0, 120, 255, 0.45)",
    offCurve: "rgba(255, 120, 0, 0.95)",
    onCurve: "rgba(0, 120, 255, 0.95)",
    onCurveSmooth: "rgba(0, 180, 80, 0.95)",
  };

  function resolveSingleColor(opts) {
    if (!opts) return null;
    var c = opts.color || opts.strokeColor || null;
    return c && String(c).trim() ? String(c).trim() : null;
  }

  function resolveColors(opts) {
    var single = resolveSingleColor(opts);
    if (single) {
      return {
        path: single,
        handleLine: single,
        offCurve: single,
        onCurve: single,
        onCurveSmooth: single,
      };
    }
    return COLORS;
  }

  function harfbuzzModuleUrl() {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src;
      if (src && src.indexOf("glyph-outlines") !== -1) {
        return new URL("vendor/harfbuzzjs/index.mjs", src).href;
      }
    }
    return "vendor/harfbuzzjs/index.mjs";
  }

  function loadHbModule() {
    if (!hbModulePromise) {
      hbModulePromise = import(harfbuzzModuleUrl());
    }
    return hbModulePromise;
  }

  function createHbState(buffer, hb) {
    var blob = new hb.Blob(buffer);
    var face = new hb.Face(blob, 0);
    var font = new hb.Font(face);
    return {
      Buffer: hb.Buffer,
      Feature: hb.Feature,
      Variation: hb.Variation,
      shape: hb.shape,
      font: font,
      face: face,
      blob: blob,
      upem: face.upem,
    };
  }

  function loadFont(url) {
    if (fontUrl !== url) {
      fontUrl = url;
      fontPromise = null;
      cachedFont = null;
      cachedFontBuf = null;
      cachedHbState = null;
      cachedKern = null;
    }
    if (!fontPromise) {
      fontPromise = Promise.all([
        fetch(url).then(function (r) {
          if (!r.ok) throw new Error("font fetch failed");
          return r.arrayBuffer();
        }),
        loadHbModule().catch(function (err) {
          console.warn("GlyphOutlines: HarfBuzz unavailable, using opentype layout", err);
          return null;
        }),
      ]).then(function (parts) {
        var buf = parts[0];
        cachedFontBuf = buf;
        cachedFont = opentype.parse(buf);
        cachedHbState = parts[1] ? createHbState(buf, parts[1]) : null;
        return cachedFont;
      });
    }
    return fontPromise;
  }

  function parseVariationSettings(raw) {
    var out = {};
    String(raw || "").replace(/"(\w+)"\s*([-\d.]+)/g, function (_, tag, val) {
      out[tag] = parseFloat(val);
    });
    return out;
  }

  function parseVariationFromElement(el) {
    var cs = getComputedStyle(el);
    var raw = el.style.fontVariationSettings || cs.fontVariationSettings || "";
    return parseVariationSettings(raw);
  }

  function readZoom(root) {
    if (!root) return 1;
    var z = parseFloat(getComputedStyle(root).getPropertyValue("--zoom"));
    return isFinite(z) && z > 0 ? z : 1;
  }

  function stageLayoutSize(stageEl, root) {
    var w = stageEl && stageEl.offsetWidth;
    var h = stageEl && stageEl.offsetHeight;
    if (w > 0 && h > 0) return { w: w, h: h };
    var zoom = readZoom(root);
    var sr = stageEl.getBoundingClientRect();
    return { w: sr.width / zoom, h: sr.height / zoom };
  }

  function fontSizePx(el, opts) {
    if (opts && opts.fontSize != null && isFinite(Number(opts.fontSize))) {
      return Number(opts.fontSize);
    }
    return parseFloat(getComputedStyle(el).fontSize) || 72;
  }

  function bboxFromCommands(commands) {
    var x1 = Infinity;
    var y1 = Infinity;
    var x2 = -Infinity;
    var y2 = -Infinity;
    var n = 0;
    function grow(x, y) {
      if (!isFinite(x) || !isFinite(y)) return;
      x1 = Math.min(x1, x);
      y1 = Math.min(y1, y);
      x2 = Math.max(x2, x);
      y2 = Math.max(y2, y);
      n++;
    }
    commands.forEach(function (cmd) {
      if (cmd.type === "M" || cmd.type === "L") grow(cmd.x, cmd.y);
      else if (cmd.type === "Q") {
        grow(cmd.x1, cmd.y1);
        grow(cmd.x, cmd.y);
      } else if (cmd.type === "C") {
        grow(cmd.x1, cmd.y1);
        grow(cmd.x2, cmd.y2);
        grow(cmd.x, cmd.y);
      }
    });
    if (!n) return null;
    return { x1: x1, y1: y1, x2: x2, y2: y2 };
  }

  function contourSignedArea(commands) {
    var pts = [];
    var cur = { x: 0, y: 0 };
    commands.forEach(function (cmd) {
      if (cmd.type === "M") {
        cur = { x: cmd.x, y: cmd.y };
        pts.push(cur);
      } else if (cmd.type === "L") {
        cur = { x: cmd.x, y: cmd.y };
        pts.push(cur);
      } else if (cmd.type === "C") {
        pts.push({ x: cmd.x1, y: cmd.y1 });
        pts.push({ x: cmd.x2, y: cmd.y2 });
        cur = { x: cmd.x, y: cmd.y };
        pts.push(cur);
      } else if (cmd.type === "Q") {
        pts.push({ x: cmd.x1, y: cmd.y1 });
        cur = { x: cmd.x, y: cmd.y };
        pts.push(cur);
      }
    });
    if (pts.length < 3) return 0;
    var a = 0;
    for (var i = 0; i < pts.length; i++) {
      var j = (i + 1) % pts.length;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return a / 2;
  }

  /** Outer shell only — inner counters (B, O, P…) must not shift the stage anchor. */
  function outerContourBBox(commands) {
    var subs = splitSubpaths(commands);
    if (subs.length <= 1) return bboxFromCommands(commands);

    var best = null;
    var bestArea = 0;
    subs.forEach(function (sub) {
      var bb = bboxFromCommands(sub);
      if (!bb) return;
      var area = Math.abs(contourSignedArea(sub));
      if (area > bestArea) {
        bestArea = area;
        best = bb;
      }
    });
    return best || bboxFromCommands(commands);
  }

  /** Visual ink bounds — recentres every frame so text stays on the artboard center. */
  function placementAnchorForRuns(runs) {
    if (!runs.length) return null;
    var inkBoxes = runs.map(function (r) {
      return bboxFromCommands(r.commands);
    });
    var bb = unionBBox(inkBoxes);
    if (!bb) return null;

    var cx = (bb.x1 + bb.x2) / 2;
    var cy = (bb.y1 + bb.y2) / 2;
    var yTop = bb.y1;

    if (runs.length === 1) {
      var subs = splitSubpaths(runs[0].commands);
      if (subs.length > 1) {
        var outer = outerContourBBox(runs[0].commands);
        if (outer) {
          cy = (outer.y1 + outer.y2) / 2;
          yTop = outer.y1;
        }
      }
    }
    return { cx: cx, cy: cy, yTop: yTop };
  }

  /** Layout anchor from advances + font metrics — stable while ink bounds shift during animation. */
  function layoutPlacementAnchor(font, fontSize, text, runs, opts) {
    if (!runs.length) return null;
    var lines = splitLines(text);
    var lineHeight = leadingPx(font, fontSize, opts);
    var asc = (font.ascender / font.unitsPerEm) * fontSize;
    var desc = (font.descender / font.unitsPerEm) * fontSize;
    var emMid = (asc + desc) / 2;
    var minX = Infinity;
    var maxX = -Infinity;

    runs.forEach(function (r) {
      if (!isFinite(r.x)) return;
      minX = Math.min(minX, r.x);
      maxX = Math.max(maxX, r.x + (r.advance || 0));
    });

    if (!isFinite(minX) || !isFinite(maxX)) return null;

    return {
      cx: (minX + maxX) / 2,
      cy: emMid + ((lines.length - 1) * lineHeight) / 2,
      yTop: -asc,
    };
  }

  function resolvePlacementAnchor(font, fontSize, text, runs, opts) {
    if (opts && opts.stableAnchor) {
      return layoutPlacementAnchor(font, fontSize, text, runs, opts) || placementAnchorForRuns(runs);
    }
    return placementAnchorForRuns(runs);
  }

  function cssVarPx(root, name) {
    if (!root) return NaN;
    var raw = getComputedStyle(root).getPropertyValue(name).trim();
    if (!raw) return NaN;
    var n = parseFloat(raw);
    return isFinite(n) ? n : NaN;
  }

  /** Map path coordinates so the anchor sits at the artboard center, or the live-area top. */
  function placement(stageEl, root, anchor, opts) {
    var size = stageLayoutSize(stageEl, root);
    var stageW = size.w;
    var stageH = size.h;
    var stageCx = stageW / 2;
    var alignY = opts && opts.alignY === "top" ? "top" : "center";
    var stageCy;
    if (alignY === "top") {
      var padT = cssVarPx(root, "--pad-t");
      if (!isFinite(padT)) padT = cssVarPx(root, "--guide-t");
      if (!isFinite(padT)) padT = 0;
      var extra = 0;
      if (opts && opts.alignYOffset != null && isFinite(Number(opts.alignYOffset))) {
        extra = Number(opts.alignYOffset);
      }
      stageCy = padT + extra;
    } else {
      stageCy = stageH / 2;
    }

    var pathCx = anchor.cx;
    var pathCy = alignY === "top" && anchor.yTop != null ? anchor.yTop : anchor.cy;

    var map = function (ox, oy) {
      return {
        x: stageCx + (ox - pathCx),
        y: stageCy + (oy - pathCy),
      };
    };

    return { map: map, stageW: stageW, stageH: stageH, stageCx: stageCx, stageCy: stageCy };
  }

  function wrapOffset(map, offsetX, offsetY) {
    var ox = isFinite(offsetX) ? offsetX : 0;
    var oy = isFinite(offsetY) ? offsetY : 0;
    return function (x, y) {
      var p = map(x, y);
      return { x: p.x + ox, y: p.y + oy };
    };
  }

  function wrapScreenScale(map, scale, cx, cy) {
    if (!scale || scale === 1 || !isFinite(scale)) return map;
    return function (ox, oy) {
      var p = map(ox, oy);
      return {
        x: cx + (p.x - cx) * scale,
        y: cy + (p.y - cy) * scale,
      };
    };
  }

  function splitSubpaths(commands) {
    var subs = [];
    var cur = null;
    commands.forEach(function (cmd) {
      if (cmd.type === "M") {
        if (cur && cur.length) subs.push(cur);
        cur = [cmd];
      } else if (cur) {
        cur.push(cmd);
      }
    });
    if (cur && cur.length) subs.push(cur);
    return subs;
  }

  function collectGeometry(commands) {
    var nodes = [];
    var handles = [];
    var handleLines = [];
    var cur = null;
    var start = null;

    function onNode(x, y, smooth) {
      var pt = { x: x, y: y, smooth: !!smooth };
      nodes.push(pt);
      return pt;
    }

    function offNode(x, y) {
      var pt = { x: x, y: y };
      handles.push(pt);
      return pt;
    }

    function beginContour(x, y) {
      cur = null;
      start = null;
      cur = onNode(x, y, false);
      start = cur;
    }

    commands.forEach(function (cmd) {
      if (cmd.type === "M") {
        beginContour(cmd.x, cmd.y);
      } else if (cmd.type === "L") {
        if (!cur) beginContour(cmd.x, cmd.y);
        else cur = onNode(cmd.x, cmd.y, false);
      } else if (cmd.type === "C") {
        if (!cur) beginContour(cmd.x, cmd.y);
        var c1 = offNode(cmd.x1, cmd.y1);
        var c2 = offNode(cmd.x2, cmd.y2);
        var endPt = { x: cmd.x, y: cmd.y };
        handleLines.push([cur, c1]);
        handleLines.push([c2, endPt]);
        cur = onNode(cmd.x, cmd.y, true);
      } else if (cmd.type === "Q") {
        if (!cur) beginContour(cmd.x, cmd.y);
        var qc = offNode(cmd.x1, cmd.y1);
        var qEnd = { x: cmd.x, y: cmd.y };
        handleLines.push([cur, qc]);
        handleLines.push([qc, qEnd]);
        cur = onNode(cmd.x, cmd.y, true);
      } else if (cmd.type === "Z") {
        cur = start;
      }
    });

    return { nodes: nodes, handles: handles, handleLines: handleLines };
  }

  function collectGeometryAll(commands) {
    var subs = splitSubpaths(commands);
    if (subs.length <= 1) return collectGeometry(commands);
    var nodes = [];
    var handles = [];
    var handleLines = [];
    subs.forEach(function (sub) {
      var g = collectGeometry(sub);
      nodes = nodes.concat(g.nodes);
      handles = handles.concat(g.handles);
      handleLines = handleLines.concat(g.handleLines);
    });
    return { nodes: nodes, handles: handles, handleLines: handleLines };
  }

  /** opentype.js drops Z when converting glyph paths; SVG needs closed contours. */
  function closeOpenSubpaths(commands) {
    var out = [];
    var open = false;
    for (var i = 0; i < commands.length; i++) {
      var cmd = commands[i];
      if (cmd.type === "M") {
        if (open) out.push({ type: "Z" });
        open = true;
        out.push(cmd);
      } else if (cmd.type === "Z") {
        out.push(cmd);
        open = false;
      } else {
        out.push(cmd);
        open = true;
      }
    }
    if (open) out.push({ type: "Z" });
    return out;
  }

  function pathDFromCommands(commands, map) {
    var parts = [];
    closeOpenSubpaths(commands).forEach(function (cmd) {
      if (cmd.type === "M") {
        var m = map(cmd.x, cmd.y);
        parts.push("M" + fmt(m.x) + " " + fmt(m.y));
      } else if (cmd.type === "L") {
        var l = map(cmd.x, cmd.y);
        parts.push("L" + fmt(l.x) + " " + fmt(l.y));
      } else if (cmd.type === "Q") {
        var q1 = map(cmd.x1, cmd.y1);
        var q = map(cmd.x, cmd.y);
        parts.push(
          "Q" + fmt(q1.x) + " " + fmt(q1.y) + " " + fmt(q.x) + " " + fmt(q.y)
        );
      } else if (cmd.type === "C") {
        var c1 = map(cmd.x1, cmd.y1);
        var c2 = map(cmd.x2, cmd.y2);
        var c = map(cmd.x, cmd.y);
        parts.push(
          "C" +
            fmt(c1.x) +
            " " +
            fmt(c1.y) +
            " " +
            fmt(c2.x) +
            " " +
            fmt(c2.y) +
            " " +
            fmt(c.x) +
            " " +
            fmt(c.y)
        );
      } else if (cmd.type === "Z") {
        parts.push("Z");
      }
    });
    return parts.join(" ");
  }

  function fmt(n) {
    if (!isFinite(n)) return "0";
    return String(Math.round(n * 1000) / 1000);
  }

  function clearSvg(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function ns(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  function ensureChild(parent, index, tag, className) {
    var el = parent.children[index];
    if (
      el &&
      el.tagName &&
      el.tagName.toLowerCase() === tag &&
      el.getAttribute("class") === className
    ) {
      return el;
    }
    var neu = ns(tag);
    neu.setAttribute("class", className);
    if (el) parent.replaceChild(neu, el);
    else parent.appendChild(neu);
    return neu;
  }

  function trimTo(parent, n) {
    while (parent.children.length > n) parent.removeChild(parent.lastElementChild);
  }

  function unionBBox(boxes) {
    var x1 = Infinity;
    var y1 = Infinity;
    var x2 = -Infinity;
    var y2 = -Infinity;
    var n = 0;
    boxes.forEach(function (bb) {
      if (!bb || !isFinite(bb.x1) || !isFinite(bb.y1)) return;
      x1 = Math.min(x1, bb.x1);
      y1 = Math.min(y1, bb.y1);
      x2 = Math.max(x2, bb.x2);
      y2 = Math.max(y2, bb.y2);
      n++;
    });
    if (!n) return null;
    return { x1: x1, y1: y1, x2: x2, y2: y2 };
  }

  /** Extra letter-spacing in px (InDesign tracking); separate from font pair kerning. */
  function trackingPx(opts) {
    if (!opts) return 0;
    var v = opts.tracking != null ? opts.tracking : opts.kerning;
    if (v == null || !isFinite(v)) return 0;
    return Number(v);
  }

  function mergedVariation(otFont, variation) {
    var v = Object.assign({}, (otFont.defaultRenderOptions || {}).variation || {}, variation || {});
    var fvar = otFont.tables && otFont.tables.fvar;
    if (fvar && fvar.axes) {
      fvar.axes.forEach(function (axis) {
        if (v[axis.tag] == null) v[axis.tag] = axis.defaultValue;
      });
    }
    return v;
  }

  function pathOptsForGlyph(variation) {
    return { variation: variation };
  }

  function setHbVariations(hbState, otFont, variation) {
    var v = mergedVariation(otFont, variation);
    var fvar = otFont.tables && otFont.tables.fvar;
    if (!hbState._vars) hbState._vars = [];
    if (!hbState._varByTag) hbState._varByTag = {};
    var vars = hbState._vars;
    vars.length = 0;
    if (fvar && fvar.axes) {
      fvar.axes.forEach(function (axis) {
        var item = hbState._varByTag[axis.tag];
        if (!item) {
          item = hbState._varByTag[axis.tag] = new hbState.Variation(axis.tag, v[axis.tag]);
        } else {
          item.value = v[axis.tag];
        }
        vars.push(item);
      });
    }
    hbState.font.setVariations(vars);
    hbState.font.setScale(hbState.upem, hbState.upem);
    if (otFont.variation) otFont.variation.set(v);
    return v;
  }

  function samePt(ax, ay, bx, by, eps) {
    var e = eps != null ? eps : 0.5;
    return Math.abs(ax - bx) < e && Math.abs(ay - by) < e;
  }

  /**
   * HarfBuzz drawGlyph commands, placed at (gX, gY) with Y flipped like opentype.js.
   * Prefer this over Glyph.getPath() — opentype.js gvar interpolation collapses
   * stems on F/H/L/T (and others) at high CNTR + slnt.
   */
  function hbJsonToCommands(json, gX, gY, scale) {
    var cmds = [];
    if (!json || !json.length) return cmds;
    var startX = 0;
    var startY = 0;
    var curX = 0;
    var curY = 0;
    var open = false;

    function mx(x) {
      return gX + x * scale;
    }
    function my(y) {
      return gY - y * scale;
    }

    json.forEach(function (seg) {
      var v = seg.values || [];
      if (seg.type === "M") {
        curX = startX = mx(v[0]);
        curY = startY = my(v[1]);
        open = true;
        cmds.push({ type: "M", x: curX, y: curY });
      } else if (seg.type === "L") {
        var lx = mx(v[0]);
        var ly = my(v[1]);
        if (samePt(lx, ly, curX, curY)) return;
        curX = lx;
        curY = ly;
        cmds.push({ type: "L", x: lx, y: ly });
      } else if (seg.type === "Q") {
        var qx = mx(v[2]);
        var qy = my(v[3]);
        cmds.push({
          type: "Q",
          x1: mx(v[0]),
          y1: my(v[1]),
          x: qx,
          y: qy,
        });
        curX = qx;
        curY = qy;
      } else if (seg.type === "C") {
        var cx = mx(v[4]);
        var cy = my(v[5]);
        cmds.push({
          type: "C",
          x1: mx(v[0]),
          y1: my(v[1]),
          x2: mx(v[2]),
          y2: my(v[3]),
          x: cx,
          y: cy,
        });
        curX = cx;
        curY = cy;
      } else if (seg.type === "Z") {
        var last = cmds[cmds.length - 1];
        if (
          last &&
          last.type === "L" &&
          open &&
          samePt(last.x, last.y, startX, startY, 1)
        ) {
          cmds.pop();
        }
        cmds.push({ type: "Z" });
        curX = startX;
        curY = startY;
        open = false;
      }
    });
    return cmds;
  }

  function commandsForGlyph(hbState, otFont, glyphId, gX, gY, fontSize, pathOpts) {
    var scale = fontSize / ((hbState && hbState.upem) || otFont.unitsPerEm || 1000);
    if (hbState && hbState.font && typeof hbState.font.glyphToJson === "function") {
      try {
        var hbCmds = hbJsonToCommands(hbState.font.glyphToJson(glyphId), gX, gY, scale);
        if (hbCmds.length) return hbCmds;
      } catch (err) {}
    }
    var glyph = otFont.glyphs.get(glyphId);
    if (!glyph) return [];
    var glyphPath = glyph.getPath(gX, gY, fontSize, pathOpts, otFont);
    return glyphPath && glyphPath.commands ? glyphPath.commands : [];
  }

  function hbBuffer(hbState) {
    if (!hbState._buffer) hbState._buffer = new hbState.Buffer();
    else hbState._buffer.clearContents();
    return hbState._buffer;
  }

  function hbFeatures(hbState) {
    if (!hbState._features) {
      hbState._features = [
        new hbState.Feature("kern", 1),
        new hbState.Feature("liga", 1),
        new hbState.Feature("rlig", 1),
      ];
    }
    return hbState._features;
  }

  /**
   * HarfBuzz applies this font's gvar advances but drops GPOS kerning while the
   * pair adjustments still carry variation-index devices. Read the kern feature
   * (pair positioning, including type-9 extensions) and the GDEF item store so
   * the outlines match an instantiated instance of the same variation.
   */
  function buildKernModel(buffer) {
    if (!buffer) return null;
    var view = new DataView(buffer);
    var bytes = new Uint8Array(buffer);
    function u16(o) { return view.getUint16(o); }
    function i16(o) { return view.getInt16(o); }
    function u32(o) { return view.getUint32(o); }
    function tagAt(o) {
      return String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    }
    function f2(o) { return i16(o) / 16384; }
    function fixed(o) { return view.getInt32(o) / 65536; }

    var tables = {};
    var numTables = u16(4);
    for (var ti = 0; ti < numTables; ti++) {
      var rec = 12 + ti * 16;
      tables[tagAt(rec)] = u32(rec + 8);
    }
    if (tables.GPOS == null || tables.GDEF == null || tables.fvar == null) return null;

    var fvar = tables.fvar;
    var axisCount = u16(fvar + 8);
    var axisSize = u16(fvar + 10);
    var axes = [];
    for (var ai = 0; ai < axisCount; ai++) {
      var ao = fvar + u16(fvar + 4) + ai * axisSize;
      axes.push({ tag: tagAt(ao), min: fixed(ao + 4), def: fixed(ao + 8), max: fixed(ao + 12) });
    }

    var avar = null;
    if (tables.avar != null) {
      var ap = tables.avar + 8;
      avar = [];
      for (var ax = 0; ax < axisCount; ax++) {
        var segCount = u16(ap);
        ap += 2;
        var segs = [];
        for (var si = 0; si < segCount; si++) {
          segs.push([f2(ap), f2(ap + 2)]);
          ap += 4;
        }
        avar.push(segs);
      }
    }

    var gdef = tables.GDEF;
    if (u16(gdef + 2) < 3) return null;
    var storeOff = 4 + 8;
    if (u16(gdef + 2) >= 2) storeOff += 2;
    var store = gdef + u32(gdef + storeOff);
    var regionList = store + u32(store + 2);
    var regionAxisCount = u16(regionList);
    var regionCount = u16(regionList + 2);
    var regions = [];
    var rp = regionList + 4;
    for (var ri = 0; ri < regionCount; ri++) {
      var region = [];
      for (var ra = 0; ra < regionAxisCount; ra++) {
        region.push([f2(rp), f2(rp + 2), f2(rp + 4)]);
        rp += 6;
      }
      regions.push(region);
    }
    var varDataCount = u16(store + 6);
    var blocks = [];
    for (var vi = 0; vi < varDataCount; vi++) {
      var data = store + u32(store + 8 + vi * 4);
      var itemCount = u16(data);
      var numShorts = u16(data + 2);
      var varRegionCount = u16(data + 4);
      var idxs = [];
      for (var vr = 0; vr < varRegionCount; vr++) idxs.push(u16(data + 6 + vr * 2));
      var ip = data + 6 + varRegionCount * 2;
      var items = new Int16Array(itemCount * varRegionCount);
      for (var n = 0; n < itemCount; n++) {
        for (var r = 0; r < varRegionCount; r++) {
          if (r < numShorts) {
            items[n * varRegionCount + r] = i16(ip);
            ip += 2;
          } else {
            items[n * varRegionCount + r] = view.getInt8(ip);
            ip += 1;
          }
        }
      }
      blocks.push({ idxs: idxs, items: items, stride: varRegionCount });
    }

    function coverageList(base, rel) {
      var o = base + rel;
      var fmt = u16(o);
      var list = [];
      var i;
      if (fmt === 1) {
        var count = u16(o + 2);
        for (i = 0; i < count; i++) list.push(u16(o + 4 + i * 2));
      } else if (fmt === 2) {
        var ranges = u16(o + 2);
        for (i = 0; i < ranges; i++) {
          var start = u16(o + 4 + i * 6);
          var end = u16(o + 6 + i * 6);
          for (var g = start; g <= end; g++) list.push(g);
        }
      }
      return list;
    }

    function classMap(base, rel) {
      var map = new Map();
      if (!rel) return map;
      var o = base + rel;
      var fmt = u16(o);
      var i;
      if (fmt === 1) {
        var startG = u16(o + 2);
        var countC = u16(o + 4);
        for (i = 0; i < countC; i++) map.set(startG + i, u16(o + 6 + i * 2));
      } else if (fmt === 2) {
        var rangesC = u16(o + 2);
        for (i = 0; i < rangesC; i++) {
          var startC = u16(o + 4 + i * 6);
          var endC = u16(o + 6 + i * 6);
          var cls = u16(o + 8 + i * 6);
          if (!cls) continue;
          for (var g2 = startC; g2 <= endC; g2++) map.set(g2, cls);
        }
      }
      return map;
    }

    function readValue(base, o, fmt) {
      var p = o;
      var x = 0;
      var devOff = 0;
      for (var bit = 0; bit < 8; bit++) {
        if (!(fmt & (1 << bit))) continue;
        if (bit === 2) x = i16(p);
        else if (bit === 6) devOff = u16(p);
        p += 2;
      }
      var outer = 0;
      var inner = -1;
      if (devOff) {
        var d = base + devOff;
        if (u16(d + 4) === 0x8000) {
          outer = u16(d);
          inner = u16(d + 2);
        }
      }
      return { x: x, outer: outer, inner: inner, next: p };
    }

    function parsePair(base) {
      var fmt = u16(base);
      var vf1 = u16(base + 4);
      var vf2 = u16(base + 6);
      if (!(vf1 & 4) && !(vf1 & 0x40)) return null;
      var i;
      if (fmt === 1) {
        var glyphs = coverageList(base, u16(base + 2));
        var pairSets = u16(base + 8);
        var map = new Map();
        for (i = 0; i < pairSets; i++) {
          var ps = base + u16(base + 10 + i * 2);
          var pairs = u16(ps);
          var p = ps + 2;
          var innerMap = new Map();
          for (var j = 0; j < pairs; j++) {
            var second = u16(p);
            p += 2;
            var v1 = readValue(base, p, vf1);
            p = v1.next;
            if (vf2) p = readValue(base, p, vf2).next;
            if (v1.x || v1.inner >= 0) innerMap.set(second, v1);
          }
          if (innerMap.size) map.set(glyphs[i], innerMap);
        }
        return map.size ? { kind: 1, map: map } : null;
      }
      if (fmt === 2) {
        var covered = coverageList(base, u16(base + 2));
        var cov = new Set(covered);
        var c1 = classMap(base, u16(base + 8));
        var c2 = classMap(base, u16(base + 10));
        var n1 = u16(base + 12);
        var n2 = u16(base + 14);
        var p2 = base + 16;
        var recs = [];
        for (i = 0; i < n1 * n2; i++) {
          var rec = readValue(base, p2, vf1);
          p2 = rec.next;
          if (vf2) p2 = readValue(base, p2, vf2).next;
          recs.push(rec.x || rec.inner >= 0 ? rec : null);
        }
        return { kind: 2, cov: cov, c1: c1, c2: c2, n2: n2, recs: recs };
      }
      return null;
    }

    var gpos = tables.GPOS;
    var scriptList = gpos + u16(gpos + 4);
    var featureList = gpos + u16(gpos + 6);
    var lookupList = gpos + u16(gpos + 8);
    var featureIdxs = [];
    var scriptCount = u16(scriptList);
    for (var sc = 0; sc < scriptCount; sc++) {
      var scriptTag = tagAt(scriptList + 2 + sc * 6);
      if (scriptTag !== "latn" && scriptTag !== "DFLT") continue;
      var script = scriptList + u16(scriptList + 6 + sc * 6);
      var langs = [];
      if (u16(script)) langs.push(script + u16(script));
      var langCount = u16(script + 2);
      for (var li = 0; li < langCount; li++) {
        var langTag = tagAt(script + 4 + li * 6);
        if (langTag === "dflt" || langTag === "DFLT" || langTag === "latn") {
          langs.push(script + u16(script + 8 + li * 6));
        }
      }
      for (var ls = 0; ls < langs.length; ls++) {
        var lang = langs[ls];
        var featCount = u16(lang + 4);
        for (var fi = 0; fi < featCount; fi++) featureIdxs.push(u16(lang + 6 + fi * 2));
      }
    }

    var lookupIdx = {};
    for (var fx = 0; fx < featureIdxs.length; fx++) {
      var fr = featureList + 2 + featureIdxs[fx] * 6;
      if (tagAt(fr) !== "kern") continue;
      var feat = featureList + u16(fr + 4);
      var lookCount = u16(feat + 2);
      for (var lx = 0; lx < lookCount; lx++) lookupIdx[u16(feat + 4 + lx * 2)] = true;
    }

    var subs = [];
    for (var key in lookupIdx) {
      if (!lookupIdx.hasOwnProperty(key)) continue;
      var look = lookupList + u16(lookupList + 2 + Number(key) * 2);
      var kind = u16(look);
      var subCount = u16(look + 4);
      for (var s = 0; s < subCount; s++) {
        var sub = look + u16(look + 6 + s * 2);
        var subKind = kind;
        if (subKind === 9) {
          subKind = u16(sub + 2);
          sub = sub + u32(sub + 4);
        }
        if (subKind !== 2) continue;
        var parsed = parsePair(sub);
        if (parsed) subs.push(parsed);
      }
    }
    if (!subs.length) return null;

    return {
      axes: axes,
      avar: avar,
      regions: regions,
      blocks: blocks,
      subs: subs,
      scalarKey: "",
      scalars: null,
    };
  }

  function kernSupport(loc, region) {
    var scalar = 1;
    for (var i = 0; i < region.length; i++) {
      var start = region[i][0];
      var peak = region[i][1];
      var end = region[i][2];
      var v = loc[i] || 0;
      if (start > peak || peak > end) continue;
      if (start < 0 && end > 0) continue;
      if (peak === 0 || v === peak) continue;
      if (v < start || v > end) return 0;
      if (v < peak) scalar *= (v - start) / (peak - start);
      else scalar *= (end - v) / (end - peak);
    }
    return scalar;
  }

  function kernScalars(model, variation) {
    var loc = [];
    var i;
    for (i = 0; i < model.axes.length; i++) {
      var axis = model.axes[i];
      var raw = variation && variation[axis.tag] != null ? variation[axis.tag] : axis.def;
      var n = raw === axis.def ? 0 : raw > axis.def
        ? (raw - axis.def) / (axis.max - axis.def)
        : (raw - axis.def) / (axis.def - axis.min);
      if (model.avar && model.avar[i] && model.avar[i].length) {
        var segs = model.avar[i];
        if (n <= segs[0][0]) n = segs[0][1];
        else if (n >= segs[segs.length - 1][0]) n = segs[segs.length - 1][1];
        else {
          for (var j = 0; j < segs.length - 1; j++) {
            var a = segs[j];
            var b = segs[j + 1];
            if (n < a[0] || n > b[0]) continue;
            var t = b[0] === a[0] ? 0 : (n - a[0]) / (b[0] - a[0]);
            n = a[1] + t * (b[1] - a[1]);
            break;
          }
        }
      }
      loc.push(n);
    }
    var key = loc.join(",");
    if (key === model.scalarKey) return model.scalars;
    var block = model.blocks[0];
    var scalars = new Float64Array(block.stride);
    for (i = 0; i < block.stride; i++) {
      scalars[i] = kernSupport(loc, model.regions[block.idxs[i]]);
    }
    model.scalarKey = key;
    model.scalars = scalars;
    return scalars;
  }

  function kernDelta(model, outer, inner, scalars) {
    if (inner < 0) return 0;
    var block = model.blocks[outer];
    if (!block) return 0;
    var row = inner * block.stride;
    var acc = 0;
    for (var r = 0; r < block.stride; r++) acc += block.items[row + r] * scalars[r];
    return acc;
  }

  function kernPairUnits(model, variation, left, right) {
    var scalars = kernScalars(model, variation);
    var sum = 0;
    for (var i = 0; i < model.subs.length; i++) {
      var sub = model.subs[i];
      var rec = null;
      if (sub.kind === 1) {
        var inner = sub.map.get(left);
        if (inner) rec = inner.get(right) || null;
      } else if (sub.cov.has(left)) {
        rec = sub.recs[(sub.c1.get(left) || 0) * sub.n2 + (sub.c2.get(right) || 0)];
      }
      if (!rec) continue;
      sum += Math.floor(rec.x + kernDelta(model, rec.outer, rec.inner, scalars) + 0.5);
    }
    return sum;
  }

  function hbAlreadyKerns(hbState) {
    function adv(text) {
      var buffer = hbBuffer(hbState);
      buffer.addText(text);
      buffer.guessSegmentProperties();
      hbState.shape(hbState.font, buffer, hbFeatures(hbState));
      var glyphs = buffer.getGlyphInfosAndPositions();
      return glyphs.length ? glyphs[0].xAdvance : 0;
    }
    try {
      return adv("A") - adv("AT") > 1;
    } catch (err) {
      return false;
    }
  }

  function kernModel() {
    if (cachedKern !== null) return cachedKern || null;
    cachedKern = buildKernModel(cachedFontBuf) || false;
    if (cachedKern && cachedHbState && hbAlreadyKerns(cachedHbState)) cachedKern = false;
    return cachedKern || null;
  }

  /**
   * Shape with HarfBuzz. Advances follow the variation; pair kerning is applied
   * from the font's GPOS kern feature when HarfBuzz leaves it out.
   * Returns { runs, width } for one line at baseline y0, origin x0.
   * Variations must already be set on hbState.font.
   */
  function shapeLine(hbState, otFont, line, x0, y0, fontSize, variation, trackingPxVal) {
    if (!line) return { runs: [], width: 0 };
    var pathOpts = pathOptsForGlyph(variation);
    var scale = fontSize / hbState.upem;
    var trackExtra = trackingPxVal ? trackingPxVal / fontSize : 0;

    var buffer = hbBuffer(hbState);
    buffer.addText(line);
    buffer.guessSegmentProperties();
    hbState.shape(hbState.font, buffer, hbFeatures(hbState));

    var glyphs = buffer.getGlyphInfosAndPositions();
    var runs = [];
    var x = x0;
    var kern = kernModel();

    for (var i = 0; i < glyphs.length; i++) {
      var g = glyphs[i];
      var gX = x + (g.xOffset || 0) * scale;
      var gY = y0 + (g.yOffset || 0) * scale;
      var commands = commandsForGlyph(hbState, otFont, g.codepoint, gX, gY, fontSize, pathOpts);
      if (commands && commands.length) {
        runs.push({
          commands: commands,
          x: gX,
          advance: g.xAdvance * scale,
        });
      }
      x += g.xAdvance * scale;
      if (i < glyphs.length - 1) {
        if (kern) x += kernPairUnits(kern, variation, g.codepoint, glyphs[i + 1].codepoint) * scale;
        if (trackExtra) x += trackExtra * fontSize;
      }
    }

    return { runs: runs, width: x - x0 };
  }

  function lineHeightPx(font, fontSize) {
    var asc = font.ascender;
    var desc = font.descender;
    if (isFinite(asc) && isFinite(desc)) {
      return ((asc - desc) / font.unitsPerEm) * fontSize;
    }
    return fontSize;
  }

  /** Unitless CSS line-height × font size. Falls back to font metrics when unset. */
  function leadingPx(font, fontSize, opts) {
    if (opts && opts.leading != null && isFinite(Number(opts.leading))) {
      return Number(opts.leading) * fontSize;
    }
    return lineHeightPx(font, fontSize);
  }

  function splitLines(text) {
    return String(text).split(/\r\n|\r|\n/);
  }

  /** Fallback when HarfBuzz is unavailable (no GPOS kern). */
  function shapeLineOpentype(otFont, line, x0, y0, fontSize, variation, trackingPxVal) {
    if (!line) return { runs: [], width: 0 };
    var pathOpts = Object.assign({}, otFont.defaultRenderOptions || { kerning: true });
    pathOpts.kerning = true;
    pathOpts.features = { liga: true, rlig: true };
    pathOpts.variation = mergedVariation(otFont, variation);
    if (otFont.variation) otFont.variation.set(pathOpts.variation);
    var trackEm = trackingPxVal ? trackingPxVal / fontSize : 0;
    if (trackEm) pathOpts.letterSpacing = trackEm;
    var runs = [];
    var endX = otFont.forEachGlyph(line, x0, y0, fontSize, pathOpts, function (glyph, gX, gY) {
      var glyphPath = glyph.getPath(gX, gY, fontSize, pathOpts, otFont);
      if (glyphPath.commands && glyphPath.commands.length) {
        runs.push({
          commands: glyphPath.commands,
          x: gX,
          advance: glyph.advanceWidth ? (glyph.advanceWidth / otFont.unitsPerEm) * fontSize : 0,
        });
      }
    });
    return { runs: runs, width: endX - x0 };
  }

  function shapeLineWithEngine(hbState, otFont, line, x0, y0, fontSize, variation, trackingPxVal) {
    if (hbState) return shapeLine(hbState, otFont, line, x0, y0, fontSize, variation, trackingPxVal);
    return shapeLineOpentype(otFont, line, x0, y0, fontSize, variation, trackingPxVal);
  }

  function translateCommands(commands, dx, dy) {
    if (!dx && !dy) return commands;
    var out = new Array(commands.length);
    for (var i = 0; i < commands.length; i++) {
      var cmd = commands[i];
      if (cmd.type === "Z" || (cmd.x == null && cmd.x1 == null)) {
        out[i] = cmd;
        continue;
      }
      var c = { type: cmd.type };
      if (cmd.x != null) {
        c.x = cmd.x + dx;
        c.y = cmd.y + dy;
      }
      if (cmd.x1 != null) {
        c.x1 = cmd.x1 + dx;
        c.y1 = cmd.y1 + dy;
      }
      if (cmd.x2 != null) {
        c.x2 = cmd.x2 + dx;
        c.y2 = cmd.y2 + dy;
      }
      out[i] = c;
    }
    return out;
  }

  /**
   * Lay out glyphs via HarfBuzz (GPOS kern + gvar outlines).
   * Supports line breaks; lines are center-aligned; opts.tracking adds letter-spacing.
   * opts.leading is a unitless CSS line-height (× font size).
   */
  function glyphRunsForText(font, text, fontSize, variation, opts) {
    if (!text) return [];
    if (cachedHbState) setHbVariations(cachedHbState, font, variation);
    var lines = splitLines(text);
    var lineHeight = leadingPx(font, fontSize, opts);
    var track = trackingPx(opts);
    var shapedLines = lines.map(function (line) {
      return shapeLineWithEngine(cachedHbState, font, line, 0, 0, fontSize, variation, track);
    });
    var maxLineWidth = 0;
    shapedLines.forEach(function (s) {
      maxLineWidth = Math.max(maxLineWidth, s.width);
    });

    var runs = [];
    for (var li = 0; li < lines.length; li++) {
      var y = li * lineHeight;
      var x0 = (maxLineWidth - shapedLines[li].width) / 2;
      shapedLines[li].runs.forEach(function (r) {
        runs.push({
          commands: translateCommands(r.commands, x0, y),
          x: r.x + x0,
          advance: r.advance,
        });
      });
    }

    return runs;
  }

  /**
   * Bezier path + nodes always from the same commands so points stay on-curve.
   * Polygon union (pathfind) is skipped — it toggles during animation and
   * replaces nodes with flattened vertices that no longer match the stroke.
   */
  function buildOutline(commands, map) {
    var d = pathDFromCommands(commands, map);
    var geom = collectGeometryAll(commands);
    if (!d || d.indexOf("NaN") !== -1) return null;
    return { d: d, geom: geom };
  }

  function mapPoint(map, pt) {
    var p = map(pt.x, pt.y);
    return { x: fmt(p.x), y: fmt(p.y) };
  }

  function outlineDrawStyle(opts) {
    var strokeW = opts && opts.strokeWidth != null ? Number(opts.strokeWidth) : 1.25;
    var nodeStrokeW =
      opts && opts.nodeStrokeWidth != null ? Number(opts.nodeStrokeWidth) : 1;
    var handleStrokeW =
      opts && opts.handleStrokeWidth != null
        ? Number(opts.handleStrokeWidth)
        : nodeStrokeW;
    var nodeSize = opts && opts.nodeSize != null ? Number(opts.nodeSize) : 9;
    var handleSize = opts && opts.handleSize != null ? Number(opts.handleSize) : 8;
    var nodeFill = fillFlag(opts && opts.nodeFill, false);
    var handleFill =
      opts && opts.handleFill != null ? fillFlag(opts.handleFill, false) : nodeFill;
    var pathFill = "var(--bg)";
    if (opts && opts.pathFill != null && opts.pathFill !== "") {
      pathFill =
        opts.pathFill === false || opts.pathFill === "none"
          ? "none"
          : String(opts.pathFill);
    }
    var scale = opts && opts.outlineScale != null ? Number(opts.outlineScale) : 1;
    if (!isFinite(strokeW) || strokeW < 0) strokeW = 1.25;
    if (!isFinite(nodeStrokeW) || nodeStrokeW < 0) nodeStrokeW = 1;
    if (!isFinite(handleStrokeW) || handleStrokeW < 0) handleStrokeW = nodeStrokeW;
    if (!isFinite(nodeSize) || nodeSize < 0) nodeSize = 9;
    if (!isFinite(handleSize) || handleSize < 0) handleSize = 8;
    if (!isFinite(scale) || scale <= 0) scale = 1;
    return {
      strokeW: strokeW * scale,
      nodeStrokeW: nodeStrokeW * scale,
      handleStrokeW: handleStrokeW * scale,
      nodeSize: nodeSize * scale,
      handleSize: handleSize * scale,
      nodeFill: nodeFill,
      handleFill: handleFill,
      pathFill: pathFill,
    };
  }

  function fillFlag(v, fallback) {
    if (v === true || v === "filled") return true;
    if (v === false || v === "outline") return false;
    return !!fallback;
  }

  function paintPoint(el, color, filled, strokeW) {
    el.setAttribute("fill", filled ? color : "none");
    el.setAttribute("stroke", color);
    el.setAttribute("stroke-width", String(strokeW));
  }

  function patchOutlineToGroup(g, outline, map, colors, strokeAttr, style, idx) {
    var geom = outline.geom;
    var pathFill = style.pathFill != null ? style.pathFill : "var(--bg)";
    var filled = pathFill && pathFill !== "none";
    var i = idx;

    if (filled) {
      var fillEl = ensureChild(g, i, "path", "glyph-outline-path");
      fillEl.setAttribute("d", outline.d);
      fillEl.setAttribute("fill", pathFill);
      fillEl.setAttribute("fill-opacity", "1");
      fillEl.setAttribute("fill-rule", "nonzero");
      fillEl.setAttribute("stroke", "none");
      fillEl.setAttribute("stroke-width", "0");
      i++;
    }

    var strokeEl = ensureChild(g, i, "path", "glyph-outline-stroke");
    strokeEl.setAttribute("d", outline.d);
    strokeEl.setAttribute("fill", "none");
    strokeEl.setAttribute("fill-opacity", "0");
    strokeEl.setAttribute("stroke", strokeAttr || colors.path);
    strokeEl.setAttribute("stroke-width", String(style.strokeW));
    strokeEl.setAttribute("stroke-linejoin", "miter");
    strokeEl.setAttribute("stroke-miterlimit", "2.5");
    i++;

    if (style.handleSize > 0) {
      geom.handleLines.forEach(function (seg) {
        var a = mapPoint(map, seg[0]);
        var b = mapPoint(map, seg[1]);
        var line = ensureChild(g, i, "line", "glyph-outline-handle-line");
        line.setAttribute("x1", a.x);
        line.setAttribute("y1", a.y);
        line.setAttribute("x2", b.x);
        line.setAttribute("y2", b.y);
        line.setAttribute("stroke", strokeAttr || colors.handleLine);
        line.setAttribute("stroke-width", String(style.handleStrokeW));
        i++;
      });

      var handleR = style.handleSize / 2;
      geom.handles.forEach(function (h) {
        var p = mapPoint(map, h);
        var c = ensureChild(g, i, "circle", "glyph-outline-handle");
        c.setAttribute("cx", p.x);
        c.setAttribute("cy", p.y);
        c.setAttribute("r", String(handleR));
        paintPoint(
          c,
          strokeAttr || colors.offCurve,
          style.handleFill,
          style.handleStrokeW
        );
        i++;
      });
    }

    if (style.nodeSize > 0) {
      var nodeR = style.nodeSize / 2;
      geom.nodes.forEach(function (n) {
        var p = mapPoint(map, n);
        var stroke = strokeAttr || (n.smooth ? colors.onCurveSmooth : colors.onCurve);
        if (n.smooth) {
          var c = ensureChild(g, i, "circle", "glyph-outline-node glyph-outline-node-smooth");
          c.setAttribute("cx", p.x);
          c.setAttribute("cy", p.y);
          c.setAttribute("r", String(nodeR));
          paintPoint(c, stroke, style.nodeFill, style.nodeStrokeW);
        } else {
          var half = style.nodeSize / 2;
          var r = ensureChild(g, i, "rect", "glyph-outline-node glyph-outline-node-corner");
          r.setAttribute("x", fmt(p.x - half));
          r.setAttribute("y", fmt(p.y - half));
          r.setAttribute("width", String(style.nodeSize));
          r.setAttribute("height", String(style.nodeSize));
          paintPoint(r, stroke, style.nodeFill, style.nodeStrokeW);
        }
        i++;
      });
    }

    return i;
  }

  function renderTarget(svg, font, target, stageEl, root, opacity, opts, groupEl) {
    var el = target.el;
    var text =
      target.text != null
        ? target.text
        : target.char != null
          ? target.char
          : el.textContent || "";
    var fontSize = fontSizePx(el, opts);
    var variation =
      target.variation != null ? target.variation : parseVariationFromElement(el);

    var runs = glyphRunsForText(font, text, fontSize, variation, opts);
    if (!runs.length) {
      trimTo(groupEl, 0);
      return;
    }

    var anchor = resolvePlacementAnchor(font, fontSize, text, runs, opts);
    if (!anchor) {
      trimTo(groupEl, 0);
      return;
    }

    var place = placement(stageEl, root, anchor, opts);
    var map = place.map;
    var scale =
      opts && opts.outlineScale != null ? Number(opts.outlineScale) : 1;
    if (isFinite(scale) && scale > 0 && scale !== 1) {
      map = wrapScreenScale(map, scale, place.stageCx, place.stageCy);
    }
    map = wrapOffset(
      map,
      opts && opts.offsetX != null ? Number(opts.offsetX) : 0,
      opts && opts.offsetY != null ? Number(opts.offsetY) : 0
    );

    var colors = resolveColors(opts);
    var singleColor = resolveSingleColor(opts);
    var strokeAttr = singleColor ? "currentColor" : null;
    var style = outlineDrawStyle(opts);

    groupEl.setAttribute("class", "glyph-outline-group");
    if (target.kind) groupEl.setAttribute("data-kind", target.kind);
    else groupEl.removeAttribute("data-kind");
    if (opacity < 1) groupEl.setAttribute("opacity", String(opacity));
    else groupEl.removeAttribute("opacity");
    if (singleColor) groupEl.style.color = singleColor;

    var idx = 0;
    runs.forEach(function (run) {
      var outline = buildOutline(run.commands, map);
      if (outline) {
        idx = patchOutlineToGroup(groupEl, outline, map, colors, strokeAttr, style, idx);
      }
    });
    trimTo(groupEl, idx);
  }

  function renderAll(svg, stageEl, targets, font, root, opts) {
    var size = stageLayoutSize(stageEl, root);
    var w = size.w;
    var h = size.h;
    if (w > 0 && h > 0) {
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);
      svg.setAttribute("width", w);
      svg.setAttribute("height", h);
    }
    var next = 0;
    targets.forEach(function (t) {
      var g = svg.children[next];
      if (
        !g ||
        !g.tagName ||
        g.tagName.toLowerCase() !== "g" ||
        g.getAttribute("class") !== "glyph-outline-group"
      ) {
        g = ns("g");
        g.setAttribute("class", "glyph-outline-group");
        if (svg.children[next]) svg.insertBefore(g, svg.children[next]);
        else svg.appendChild(g);
      }
      var opacity = t.kind === "ghost" ? 0.35 : 1;
      renderTarget(svg, font, t, stageEl, root, opacity, opts, g);
      next++;
    });
    trimTo(svg, next);
  }

  function textOutline(fontUrl, text, fontSize, variation, opts) {
    opts = opts || {};
    return loadFont(fontUrl).then(function (font) {
      var tracking = opts.tracking || 0;
      var x0 = opts.x || 0;
      var y0 = opts.y || 0;
      if (cachedHbState) setHbVariations(cachedHbState, font, variation);
      var shaped = shapeLineWithEngine(
        cachedHbState,
        font,
        text || "",
        0,
        0,
        fontSize,
        variation,
        tracking
      );
      var commands = [];
      shaped.runs.forEach(function (run) {
        commands.push.apply(commands, run.commands);
      });
      var d = pathDFromCommands(commands, function (x, y) {
        return { x: x + x0, y: y + y0 };
      });
      return { d: d, width: shaped.width };
    });
  }

  global.GlyphOutlines = {
    loadFont: loadFont,
    parseVariation: parseVariationSettings,
    parseVariationFromElement: parseVariationFromElement,
    textOutline: textOutline,

    sync: function (svg, stageEl, targets, opts) {
      if (!svg || !stageEl || !targets || !targets.length) {
        if (svg) clearSvg(svg);
        return Promise.resolve();
      }
      opts = opts || {};
      var gen = ++syncGen;
      var root = opts.root || document.documentElement;
      var singleColor = resolveSingleColor(opts);
      if (singleColor) svg.style.color = singleColor;

      function draw(font) {
        if (gen !== syncGen) return;
        renderAll(svg, stageEl, targets, font, root, opts);
      }

      if (cachedFont && cachedFontBuf && fontUrl === opts.fontUrl) {
        draw(cachedFont);
        return Promise.resolve();
      }

      var fontChain;
      if (fontsPrimed) {
        fontChain = loadFont(opts.fontUrl);
      } else {
        var fontsReady =
          document.fonts && document.fonts.ready
            ? document.fonts.ready
            : Promise.resolve();
        fontChain = fontsReady.then(function () {
          fontsPrimed = true;
          return loadFont(opts.fontUrl);
        });
      }

      return fontChain
        .then(draw)
        .catch(function (err) {
          if (gen === syncGen) console.warn("GlyphOutlines:", err);
        });
    },
  };
})(typeof window !== "undefined" ? window : this);
