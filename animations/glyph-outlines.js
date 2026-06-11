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

  function fontSizePx(el) {
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

    if (runs.length === 1) {
      var subs = splitSubpaths(runs[0].commands);
      if (subs.length > 1) {
        var outer = outerContourBBox(runs[0].commands);
        if (outer) cy = (outer.y1 + outer.y2) / 2;
      }
    }
    return { cx: cx, cy: cy };
  }

  /** Map path coordinates so the anchor sits at the artboard center. */
  function placement(stageEl, root, anchor) {
    var zoom = readZoom(root);
    var stageRect = stageEl.getBoundingClientRect();
    var stageW = stageRect.width / zoom;
    var stageH = stageRect.height / zoom;
    var stageCx = stageW / 2;
    var stageCy = stageH / 2;

    var pathCx = anchor.cx;
    var pathCy = anchor.cy;

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
        handleLines.push([cur, qc]);
        cur = onNode(cmd.x, cmd.y, true);
      } else if (cmd.type === "Z") {
        if (cur && start && cur !== start) handleLines.push([cur, start]);
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

  function pathDFromCommands(commands, map) {
    var parts = [];
    commands.forEach(function (cmd) {
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
    var vars = [];
    var fvar = otFont.tables && otFont.tables.fvar;
    if (fvar && fvar.axes) {
      fvar.axes.forEach(function (axis) {
        vars.push(new hbState.Variation(axis.tag, v[axis.tag]));
      });
    }
    hbState.font.setVariations(vars);
    hbState.font.setScale(hbState.upem, hbState.upem);
    if (otFont.variation) otFont.variation.set(v);
    return v;
  }

  /**
   * Shape with HarfBuzz (full GPOS kern, like InDesign / Core Text).
   * Returns { runs, width } for one line at baseline y0, origin x0.
   */
  function shapeLine(hbState, otFont, line, x0, y0, fontSize, variation, trackingPxVal) {
    if (!line) return { runs: [], width: 0 };
    var v = setHbVariations(hbState, otFont, variation);
    var pathOpts = pathOptsForGlyph(v);
    var scale = fontSize / hbState.upem;
    var trackExtra = trackingPxVal ? trackingPxVal / fontSize : 0;

    var buffer = new hbState.Buffer();
    buffer.addText(line);
    buffer.guessSegmentProperties();
    hbState.shape(hbState.font, buffer, [
      new hbState.Feature("kern", 1),
      new hbState.Feature("liga", 1),
      new hbState.Feature("rlig", 1),
    ]);

    var glyphs = buffer.getGlyphInfosAndPositions();
    var runs = [];
    var x = x0;

    for (var i = 0; i < glyphs.length; i++) {
      var g = glyphs[i];
      var gX = x + (g.xOffset || 0) * scale;
      var gY = y0 + (g.yOffset || 0) * scale;
      var glyph = otFont.glyphs.get(g.codepoint);
      if (!glyph) continue;
      var glyphPath = glyph.getPath(gX, gY, fontSize, pathOpts, otFont);
      if (glyphPath.commands && glyphPath.commands.length) {
        runs.push({
          commands: glyphPath.commands,
          x: gX,
          advance: g.xAdvance * scale,
        });
      }
      x += g.xAdvance * scale;
      if (trackExtra && i < glyphs.length - 1) x += trackExtra * fontSize;
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

  /**
   * Lay out glyphs via HarfBuzz (GPOS kern) + opentype paths.
   * Supports line breaks; lines are center-aligned; opts.tracking adds letter-spacing.
   */
  function glyphRunsForText(font, text, fontSize, variation, opts) {
    if (!text) return [];
    var lines = splitLines(text);
    var lineHeight = lineHeightPx(font, fontSize);
    var track = trackingPx(opts);
    var lineWidths = lines.map(function (line) {
      return shapeLineWithEngine(cachedHbState, font, line, 0, 0, fontSize, variation, track).width;
    });
    var maxLineWidth = 0;
    lineWidths.forEach(function (w) {
      maxLineWidth = Math.max(maxLineWidth, w);
    });

    var runs = [];

    for (var li = 0; li < lines.length; li++) {
      var y = li * lineHeight;
      var x0 = (maxLineWidth - lineWidths[li]) / 2;
      var shaped = shapeLineWithEngine(
        cachedHbState,
        font,
        lines[li],
        x0,
        y,
        fontSize,
        variation,
        track
      );
      runs.push.apply(runs, shaped.runs);
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

  function appendOutlineToGroup(g, outline, map, colors, strokeW, nodeStrokeW, strokeAttr) {
    var geom = outline.geom;
    var pathEl = ns("path");
    pathEl.setAttribute("class", "glyph-outline-path");
    pathEl.setAttribute("d", outline.d);
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", strokeAttr || colors.path);
    pathEl.setAttribute("stroke-width", String(strokeW));
    pathEl.setAttribute("vector-effect", "non-scaling-stroke");
    g.appendChild(pathEl);

    geom.handleLines.forEach(function (seg) {
      var a = mapPoint(map, seg[0]);
      var b = mapPoint(map, seg[1]);
      var line = ns("line");
      line.setAttribute("class", "glyph-outline-handle-line");
      line.setAttribute("x1", a.x);
      line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x);
      line.setAttribute("y2", b.y);
      line.setAttribute("stroke", strokeAttr || colors.handleLine);
      line.setAttribute("stroke-width", String(nodeStrokeW));
      line.setAttribute("vector-effect", "non-scaling-stroke");
      g.appendChild(line);
    });

    geom.handles.forEach(function (h) {
      var p = mapPoint(map, h);
      var c = ns("circle");
      c.setAttribute("class", "glyph-outline-handle");
      c.setAttribute("cx", p.x);
      c.setAttribute("cy", p.y);
      c.setAttribute("r", "4");
      c.setAttribute("fill", "none");
      c.setAttribute("stroke", strokeAttr || colors.offCurve);
      c.setAttribute("stroke-width", String(nodeStrokeW));
      g.appendChild(c);
    });

    geom.nodes.forEach(function (n) {
      var p = mapPoint(map, n);
      var stroke = strokeAttr || (n.smooth ? colors.onCurveSmooth : colors.onCurve);
      if (n.smooth) {
        var c = ns("circle");
        c.setAttribute("class", "glyph-outline-node glyph-outline-node-smooth");
        c.setAttribute("cx", p.x);
        c.setAttribute("cy", p.y);
        c.setAttribute("r", "4.5");
        c.setAttribute("fill", "none");
        c.setAttribute("stroke", stroke);
        c.setAttribute("stroke-width", String(nodeStrokeW));
        g.appendChild(c);
      } else {
        var size = 9;
        var half = size / 2;
        var r = ns("rect");
        r.setAttribute("class", "glyph-outline-node glyph-outline-node-corner");
        r.setAttribute("x", fmt(p.x - half));
        r.setAttribute("y", fmt(p.y - half));
        r.setAttribute("width", size);
        r.setAttribute("height", size);
        r.setAttribute("fill", "none");
        r.setAttribute("stroke", stroke);
        r.setAttribute("stroke-width", String(nodeStrokeW));
        g.appendChild(r);
      }
    });
  }

  function renderTarget(svg, font, target, stageEl, root, opacity, opts) {
    var el = target.el;
    var text =
      target.text != null
        ? target.text
        : target.char != null
          ? target.char
          : el.textContent || "";
    var fontSize = fontSizePx(el);
    var variation =
      target.variation != null ? target.variation : parseVariationFromElement(el);

    var runs = glyphRunsForText(font, text, fontSize, variation, opts);
    if (!runs.length) return;

    var anchor = placementAnchorForRuns(runs);
    if (!anchor) return;

    var place = placement(stageEl, root, anchor);
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
    var strokeW = opts && opts.strokeWidth != null ? opts.strokeWidth : 1.25;
    var nodeStrokeW = opts && opts.nodeStrokeWidth != null ? opts.nodeStrokeWidth : 1;
    var strokeAttr = singleColor ? "currentColor" : null;

    var g = ns("g");
    g.setAttribute("class", "glyph-outline-group");
    if (target.kind) g.setAttribute("data-kind", target.kind);
    if (opacity < 1) g.setAttribute("opacity", String(opacity));
    if (singleColor) g.style.color = singleColor;

    runs.forEach(function (run) {
      var outline = buildOutline(run.commands, map);
      if (outline) appendOutlineToGroup(g, outline, map, colors, strokeW, nodeStrokeW, strokeAttr);
    });

    svg.appendChild(g);
  }

  function renderAll(svg, stageEl, targets, font, root, opts) {
    clearSvg(svg);
    var zoom = readZoom(root);
    var sr = stageEl.getBoundingClientRect();
    var w = sr.width / zoom;
    var h = sr.height / zoom;
    if (w > 0 && h > 0) {
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);
      svg.setAttribute("width", w);
      svg.setAttribute("height", h);
    }
    targets.forEach(function (t) {
      var opacity = t.kind === "ghost" ? 0.35 : 1;
      renderTarget(svg, font, t, stageEl, root, opacity, opts);
    });
  }

  global.GlyphOutlines = {
    loadFont: loadFont,
    parseVariation: parseVariationSettings,
    parseVariationFromElement: parseVariationFromElement,

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
