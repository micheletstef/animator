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
  var placementAnchor = { cx: null, cy: null };
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

  function loadFont(url) {
    if (fontUrl !== url) {
      fontUrl = url;
      fontPromise = null;
      cachedFont = null;
    }
    if (!fontPromise) {
      fontPromise = fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error("font fetch failed");
          return r.arrayBuffer();
        })
        .then(function (buf) {
          cachedFont = opentype.parse(buf);
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

  function resetPlacementAnchor() {
    placementAnchor.cx = null;
    placementAnchor.cy = null;
  }

  /**
   * getPath(…, fontSize): 1:1 px. Center path bbox on artboard (stage) center.
   * opts.smoothPlacement eases the anchor so morphing axes do not jitter the whole outline.
   */
  function placement(stageEl, root, pathBb, opts) {
    var zoom = readZoom(root);
    var stageRect = stageEl.getBoundingClientRect();
    var stageW = stageRect.width / zoom;
    var stageH = stageRect.height / zoom;
    var stageCx = stageW / 2;
    var stageCy = stageH / 2;

    var pathCx = (pathBb.x1 + pathBb.x2) / 2;
    var pathCy = (pathBb.y1 + pathBb.y2) / 2;

    if (opts && opts.resetPlacement) resetPlacementAnchor();

    if (opts && opts.smoothPlacement) {
      var alpha =
        opts.placementAlpha != null && isFinite(opts.placementAlpha)
          ? opts.placementAlpha
          : 0.22;
      if (placementAnchor.cx == null) {
        placementAnchor.cx = pathCx;
        placementAnchor.cy = pathCy;
      } else {
        var dx = pathCx - placementAnchor.cx;
        var dy = pathCy - placementAnchor.cy;
        if (Math.hypot(dx, dy) > 120) {
          placementAnchor.cx = pathCx;
          placementAnchor.cy = pathCy;
        } else {
          placementAnchor.cx += dx * alpha;
          placementAnchor.cy += dy * alpha;
        }
      }
      pathCx = placementAnchor.cx;
      pathCy = placementAnchor.cy;
    } else {
      placementAnchor.cx = pathCx;
      placementAnchor.cy = pathCy;
    }

    var map = function (ox, oy) {
      return {
        x: stageCx + (ox - pathCx),
        y: stageCy + (oy - pathCy),
      };
    };

    return { map: map, stageW: stageW, stageH: stageH, stageCx: stageCx, stageCy: stageCy };
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

  function advanceForGlyph(font, ch, nextCh, fontSize) {
    var glyph = font.charToGlyph(ch);
    var advance = (glyph.advanceWidth / font.unitsPerEm) * fontSize;
    if (nextCh != null && font.getKerningValue) {
      var g2 = font.charToGlyph(nextCh);
      advance += (font.getKerningValue(glyph, g2) / font.unitsPerEm) * fontSize;
    }
    return advance;
  }

  function layoutKernPx(opts, fontSize) {
    if (!opts) return { start: 0, end: 0 };
    var start =
      opts.kernStart != null && isFinite(opts.kernStart) ? Number(opts.kernStart) : 0;
    var end = opts.kernEnd != null && isFinite(opts.kernEnd) ? Number(opts.kernEnd) : 0;
    return { start: start, end: end };
  }

  /** One path + geometry per glyph so contours never union across letters. */
  function glyphRunsForText(font, text, fontSize, variation, opts) {
    var chars = Array.from(text);
    if (!chars.length) return [];
    var runs = [];
    var kern = layoutKernPx(opts, fontSize);
    var x = kern.start;
    var pathOpts = variation != null ? { variation: variation } : {};

    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      var path = font.getPath(ch, x, 0, fontSize, pathOpts);
      var commands = path.commands;
      if (commands && commands.length) {
        runs.push({ commands: commands, bb: path.getBoundingBox() });
      }
      x += advanceForGlyph(font, ch, chars[i + 1], fontSize);
    }
    if (runs.length && kern.end) {
      var last = runs[runs.length - 1];
      last.bb = {
        x1: last.bb.x1,
        y1: last.bb.y1,
        x2: last.bb.x2 + kern.end,
        y2: last.bb.y2,
      };
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

    var bb = unionBBox(runs.map(function (r) {
      return r.bb;
    }));
    if (!bb) return;

    var place = placement(stageEl, root, bb, opts);
    var map = place.map;
    var scale =
      opts && opts.outlineScale != null ? Number(opts.outlineScale) : 1;
    if (isFinite(scale) && scale > 0 && scale !== 1) {
      map = wrapScreenScale(map, scale, place.stageCx, place.stageCy);
    }

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
    resetPlacement: resetPlacementAnchor,

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

      if (cachedFont && fontUrl === opts.fontUrl) {
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
