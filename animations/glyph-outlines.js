/**
 * Glyphs-style glyph outline overlay (paths, on-curve nodes, off-curve handles).
 * Uses opentype.js variable-font outlines aligned to live DOM text.
 * Overlapping components are merged via martinez polygon union (pathfind).
 */
(function (global) {
  var fontPromise = null;
  var fontUrl = null;
  var loadedFont = null;
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
      loadedFont = null;
    }
    if (!fontPromise) {
      fontPromise = fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error("font fetch failed");
          return r.arrayBuffer();
        })
        .then(function (buf) {
          loadedFont = opentype.parse(buf);
          return loadedFont;
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

  /**
   * getPath(…, fontSize): 1:1 px. Center on artboard using a stable path-space anchor
   * (defaults to bbox center; use lockAnchor to freeze anchor while animating axes).
   */
  function placement(stageEl, root, pathBb, pathAnchor) {
    var zoom = readZoom(root);
    var stageRect = stageEl.getBoundingClientRect();
    var stageW = stageRect.width / zoom;
    var stageH = stageRect.height / zoom;
    var stageCx = stageW / 2;
    var stageCy = stageH / 2;

    var pathCx = pathAnchor ? pathAnchor.x : (pathBb.x1 + pathBb.x2) / 2;
    var pathCy = pathAnchor ? pathAnchor.y : (pathBb.y1 + pathBb.y2) / 2;

    var map = function (ox, oy) {
      return {
        x: stageCx + (ox - pathCx),
        y: stageCy + (oy - pathCy),
      };
    };

    return { map: map, stageW: stageW, stageH: stageH, stageCx: stageCx, stageCy: stageCy };
  }

  function resolvePathAnchor(svg, opts, pathBb) {
    if (opts && opts.pathAnchor) return opts.pathAnchor;
    if (opts && opts.lockAnchor && svg) {
      if (!svg._goPathAnchor) {
        svg._goPathAnchor = {
          x: (pathBb.x1 + pathBb.x2) / 2,
          y: (pathBb.y1 + pathBb.y2) / 2,
        };
      }
      return svg._goPathAnchor;
    }
    return {
      x: (pathBb.x1 + pathBb.x2) / 2,
      y: (pathBb.y1 + pathBb.y2) / 2,
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

  function mid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function distToSegment(p, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
    var t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function flattenCubic(p0, p1, p2, p3, tol, out) {
    if (
      distToSegment(p1, p0, p3) <= tol &&
      distToSegment(p2, p0, p3) <= tol
    ) {
      var last = out[out.length - 1];
      if (!last || last.x !== p3.x || last.y !== p3.y) out.push({ x: p3.x, y: p3.y });
      return;
    }
    var p01 = mid(p0, p1);
    var p12 = mid(p1, p2);
    var p23 = mid(p2, p3);
    var p012 = mid(p01, p12);
    var p123 = mid(p12, p23);
    var p0123 = mid(p012, p123);
    flattenCubic(p0, p01, p012, p0123, tol, out);
    flattenCubic(p0123, p123, p23, p3, tol, out);
  }

  function flattenQuad(p0, p1, p2, tol, out) {
    flattenCubic(p0, mid(p0, p1), mid(p1, p2), p2, tol, out);
  }

  function flattenContour(commands, tol) {
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
        flattenCubic(
          cur,
          { x: cmd.x1, y: cmd.y1 },
          { x: cmd.x2, y: cmd.y2 },
          { x: cmd.x, y: cmd.y },
          tol,
          pts
        );
        cur = { x: cmd.x, y: cmd.y };
      } else if (cmd.type === "Q") {
        flattenQuad(
          cur,
          { x: cmd.x1, y: cmd.y1 },
          { x: cmd.x, y: cmd.y },
          tol,
          pts
        );
        cur = { x: cmd.x, y: cmd.y };
      }
    });
    if (pts.length > 1) {
      var first = pts[0];
      var last = pts[pts.length - 1];
      if (first.x === last.x && first.y === last.y) pts.pop();
    }
    return pts;
  }

  function ringArea(ring) {
    var a = 0;
    for (var i = 0; i < ring.length; i++) {
      var j = (i + 1) % ring.length;
      a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1];
    }
    return a / 2;
  }

  function ringCentroid(ring) {
    var x = 0;
    var y = 0;
    ring.forEach(function (p) {
      x += p[0];
      y += p[1];
    });
    return { x: x / ring.length, y: y / ring.length };
  }

  function pointInRing(pt, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0];
      var yi = ring[i][1];
      var xj = ring[j][0];
      var yj = ring[j][1];
      var hit =
        yi > pt.y !== yj > pt.y &&
        pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
      if (hit) inside = !inside;
    }
    return inside;
  }

  function insideFraction(inner, outer) {
    if (!inner.length) return 0;
    var inside = 0;
    inner.forEach(function (p) {
      if (pointInRing({ x: p[0], y: p[1] }, outer)) inside++;
    });
    return inside / inner.length;
  }

  function multiPolyToPathD(multi) {
    var parts = [];
    multi.forEach(function (poly) {
      poly.forEach(function (ring) {
        if (ring.length < 2) return;
        ring.forEach(function (pt, i) {
          if (i === 0) parts.push("M" + fmt(pt[0]) + " " + fmt(pt[1]));
          else parts.push("L" + fmt(pt[0]) + " " + fmt(pt[1]));
        });
        parts.push("Z");
      });
    });
    return parts.join(" ");
  }

  function nodesFromMulti(multi) {
    var nodes = [];
    multi.forEach(function (poly) {
      poly.forEach(function (ring) {
        ring.forEach(function (pt) {
          nodes.push({ x: pt[0], y: pt[1], smooth: false });
        });
      });
    });
    return nodes;
  }

  /**
   * Union overlapping solids, subtract counter holes (by winding in SVG space).
   */
  function pathfindContours(subpaths, map, tolerance) {
    var clip = global.martinez;
    if (!clip || !clip.union || !clip.diff || subpaths.length < 2) return null;

    var contours = [];
    subpaths.forEach(function (sub) {
      var flat = flattenContour(sub, tolerance);
      if (flat.length < 3) return;
      var ring = flat.map(function (p) {
        var m = map(p.x, p.y);
        return [m.x, m.y];
      });
      var area = Math.abs(ringArea(ring));
      if (area < 0.5) return;
      contours.push({ ring: ring, area: area });
    });
    if (contours.length < 2) return null;

    contours.sort(function (a, b) {
      return b.area - a.area;
    });

    var solids = [];
    var holes = [];
    contours.forEach(function (c, i) {
      var isHole = false;
      for (var j = 0; j < i; j++) {
        var parent = contours[j];
        var frac = insideFraction(c.ring, parent.ring);
        if (frac >= 0.75 && c.area < parent.area * 0.4) {
          isHole = true;
          break;
        }
      }
      if (isHole) holes.push(c.ring);
      else solids.push(c.ring);
    });
    if (!solids.length) return null;
    if (solids.length < 2) return null;

    var overlapSolids = false;
    for (var si = 0; si < solids.length; si++) {
      for (var sj = si + 1; sj < solids.length; sj++) {
        if (
          insideFraction(solids[si], solids[sj]) > 0 ||
          insideFraction(solids[sj], solids[si]) > 0
        ) {
          overlapSolids = true;
          break;
        }
      }
      if (overlapSolids) break;
    }
    if (!overlapSolids) return null;

    var acc = [solids[0]];
    for (var i = 1; i < solids.length; i++) {
      acc = clip.union(acc, [solids[i]]);
      if (!acc || !acc.length) return null;
    }
    for (var h = 0; h < holes.length; h++) {
      acc = clip.diff(acc, [holes[h]]);
      if (!acc || !acc.length) return null;
    }

    var d = multiPolyToPathD(acc);
    if (!d || d.indexOf("NaN") !== -1) return null;
    return { d: d, nodes: nodesFromMulti(acc), screenSpace: true };
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

    commands.forEach(function (cmd) {
      if (cmd.type === "M") {
        cur = onNode(cmd.x, cmd.y, false);
        start = cur;
      } else if (cmd.type === "L") {
        cur = onNode(cmd.x, cmd.y, false);
      } else if (cmd.type === "C") {
        var c1 = offNode(cmd.x1, cmd.y1);
        var c2 = offNode(cmd.x2, cmd.y2);
        if (cur) {
          handleLines.push([cur, c1]);
          handleLines.push([c2, { x: cmd.x, y: cmd.y }]);
        }
        cur = onNode(cmd.x, cmd.y, true);
      } else if (cmd.type === "Q") {
        var qc = offNode(cmd.x1, cmd.y1);
        if (cur) handleLines.push([cur, qc]);
        cur = onNode(cmd.x, cmd.y, true);
      } else if (cmd.type === "Z") {
        if (cur && start) handleLines.push([cur, start]);
        cur = start;
      }
    });

    return { nodes: nodes, handles: handles, handleLines: handleLines };
  }

  function pathDFromCommands(commands, map, prec) {
    var parts = [];
    commands.forEach(function (cmd) {
      if (cmd.type === "M") {
        var m = map(cmd.x, cmd.y);
        parts.push("M" + fmt(m.x, prec) + " " + fmt(m.y, prec));
      } else if (cmd.type === "L") {
        var l = map(cmd.x, cmd.y);
        parts.push("L" + fmt(l.x, prec) + " " + fmt(l.y, prec));
      } else if (cmd.type === "Q") {
        var q1 = map(cmd.x1, cmd.y1);
        var q = map(cmd.x, cmd.y);
        parts.push(
          "Q" +
            fmt(q1.x, prec) +
            " " +
            fmt(q1.y, prec) +
            " " +
            fmt(q.x, prec) +
            " " +
            fmt(q.y, prec)
        );
      } else if (cmd.type === "C") {
        var c1 = map(cmd.x1, cmd.y1);
        var c2 = map(cmd.x2, cmd.y2);
        var c = map(cmd.x, cmd.y);
        parts.push(
          "C" +
            fmt(c1.x, prec) +
            " " +
            fmt(c1.y, prec) +
            " " +
            fmt(c2.x, prec) +
            " " +
            fmt(c2.y, prec) +
            " " +
            fmt(c.x, prec) +
            " " +
            fmt(c.y, prec)
        );
      } else if (cmd.type === "Z") {
        parts.push("Z");
      }
    });
    return parts.join(" ");
  }

  function fmt(n, prec) {
    if (!isFinite(n)) return "0";
    var p = prec == null ? 2 : prec;
    var m = Math.pow(10, p);
    return (Math.round(n * m) / m).toFixed(p);
  }

  function clearSvg(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function ns(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  function computeOutline(font, target, stageEl, root, opts) {
    var el = target.el;
    var char = target.char;
    var fontSize = fontSizePx(el);
    var variation =
      target.variation != null ? target.variation : parseVariationFromElement(el);
    var coordPrec = opts && opts.coordPrecision != null ? opts.coordPrecision : 2;

    var path = font.getPath(char, 0, 0, fontSize, { variation: variation });
    var bb = path.getBoundingBox();
    if (!isFinite(bb.x1) || !isFinite(bb.y1)) return null;

    var commands = path.commands;
    if (!commands || !commands.length) return null;

    var pathAnchor = resolvePathAnchor(
      opts && opts.svg ? opts.svg : null,
      opts,
      bb
    );
    var place = placement(stageEl, root, bb, pathAnchor);
    var map = place.map;
    var scale =
      opts && opts.outlineScale != null ? Number(opts.outlineScale) : 1;
    if (isFinite(scale) && scale > 0 && scale !== 1) {
      map = wrapScreenScale(map, scale, place.stageCx, place.stageCy);
    }

    var usePathfind = opts && opts.pathfind === true;
    var subpaths = splitSubpaths(commands);
    var tol = Math.max(0.2, fontSize * 0.0004);
    var merged =
      usePathfind && subpaths.length > 1
        ? pathfindContours(subpaths, map, tol)
        : null;
    var d = merged ? merged.d : pathDFromCommands(commands, map, coordPrec);
    var geom = merged
      ? {
          nodes: merged.nodes,
          handles: [],
          handleLines: [],
          screenSpace: true,
        }
      : collectGeometry(commands);

    if (!d || d.indexOf("NaN") !== -1) return null;

    return {
      d: d,
      geom: geom,
      map: map,
      coordPrec: coordPrec,
    };
  }

  function updateOutlineGroup(g, data, colors, strokeAttr, strokeW, nodeStrokeW) {
    var geom = data.geom;
    var map = data.map;
    var prec = data.coordPrec;

    var pathEl = g.querySelector(".glyph-outline-path");
    if (!pathEl) return false;
    pathEl.setAttribute("d", data.d);

    var toScreen = geom.screenSpace
      ? function (pt) {
          return { x: pt.x, y: pt.y };
        }
      : function (pt) {
          return map(pt.x, pt.y);
        };

    var lines = g.querySelectorAll(".glyph-outline-handle-line");
    if (lines.length !== geom.handleLines.length) return false;
    for (var i = 0; i < lines.length; i++) {
      var a = toScreen(geom.handleLines[i][0]);
      var b = toScreen(geom.handleLines[i][1]);
      lines[i].setAttribute("x1", fmt(a.x, prec));
      lines[i].setAttribute("y1", fmt(a.y, prec));
      lines[i].setAttribute("x2", fmt(b.x, prec));
      lines[i].setAttribute("y2", fmt(b.y, prec));
    }

    var handleEls = g.querySelectorAll(".glyph-outline-handle");
    if (handleEls.length !== geom.handles.length) return false;
    for (var h = 0; h < handleEls.length; h++) {
      var hp = toScreen(geom.handles[h]);
      handleEls[h].setAttribute("cx", fmt(hp.x, prec));
      handleEls[h].setAttribute("cy", fmt(hp.y, prec));
    }

    var nodeEls = g.querySelectorAll(".glyph-outline-node");
    if (nodeEls.length !== geom.nodes.length) return false;
    for (var n = 0; n < nodeEls.length; n++) {
      var node = geom.nodes[n];
      var p = toScreen(node);
      var el = nodeEls[n];
      if (node.smooth) {
        el.setAttribute("cx", fmt(p.x, prec));
        el.setAttribute("cy", fmt(p.y, prec));
      } else {
        var size = 9;
        el.setAttribute("x", fmt(p.x - size / 2, prec));
        el.setAttribute("y", fmt(p.y - size / 2, prec));
      }
    }

    return true;
  }

  function renderTarget(svg, font, target, stageEl, root, opacity, opts) {
    opts = opts || {};
    opts.svg = svg;
    var data = computeOutline(font, target, stageEl, root, opts);
    if (!data) return false;

    var colors = resolveColors(opts);
    var singleColor = resolveSingleColor(opts);
    var strokeW = opts && opts.strokeWidth != null ? opts.strokeWidth : 1.25;
    var nodeStrokeW = opts && opts.nodeStrokeWidth != null ? opts.nodeStrokeWidth : 1;
    var strokeAttr = singleColor ? "currentColor" : null;

    var existing =
      opts.inPlace !== false ? svg.querySelector(".glyph-outline-group") : null;
    if (
      existing &&
      updateOutlineGroup(
        existing,
        data,
        colors,
        strokeAttr,
        strokeW,
        nodeStrokeW
      )
    ) {
      return true;
    }

    if (existing) existing.remove();

    var g = ns("g");
    g.setAttribute("class", "glyph-outline-group");
    if (target.kind) g.setAttribute("data-kind", target.kind);
    if (opacity < 1) g.setAttribute("opacity", String(opacity));
    if (singleColor) g.style.color = singleColor;

    var d = data.d;
    var geom = data.geom;
    var map = data.map;
    var prec = data.coordPrec;

    var pathEl = ns("path");
    pathEl.setAttribute("class", "glyph-outline-path");
    pathEl.setAttribute("d", d);
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", strokeAttr || colors.path);
    pathEl.setAttribute("stroke-width", String(strokeW));
    pathEl.setAttribute("vector-effect", "non-scaling-stroke");
    g.appendChild(pathEl);

    var toScreen = geom.screenSpace
      ? function (pt) {
          return { x: pt.x, y: pt.y };
        }
      : function (pt) {
          return map(pt.x, pt.y);
        };

    geom.handleLines.forEach(function (seg) {
      var a = toScreen(seg[0]);
      var b = toScreen(seg[1]);
      var line = ns("line");
      line.setAttribute("class", "glyph-outline-handle-line");
      line.setAttribute("x1", fmt(a.x, prec));
      line.setAttribute("y1", fmt(a.y, prec));
      line.setAttribute("x2", fmt(b.x, prec));
      line.setAttribute("y2", fmt(b.y, prec));
      line.setAttribute("stroke", strokeAttr || colors.handleLine);
      line.setAttribute("stroke-width", String(nodeStrokeW));
      line.setAttribute("vector-effect", "non-scaling-stroke");
      g.appendChild(line);
    });

    geom.handles.forEach(function (h) {
      var p = toScreen(h);
      var c = ns("circle");
      c.setAttribute("class", "glyph-outline-handle");
      c.setAttribute("cx", fmt(p.x, prec));
      c.setAttribute("cy", fmt(p.y, prec));
      c.setAttribute("r", "4");
      c.setAttribute("fill", "none");
      c.setAttribute("stroke", strokeAttr || colors.offCurve);
      c.setAttribute("stroke-width", String(nodeStrokeW));
      g.appendChild(c);
    });

    geom.nodes.forEach(function (n) {
      var p = toScreen(n);
      var stroke = strokeAttr || (n.smooth ? colors.onCurveSmooth : colors.onCurve);
      if (n.smooth) {
        var c = ns("circle");
        c.setAttribute("class", "glyph-outline-node glyph-outline-node-smooth");
        c.setAttribute("cx", fmt(p.x, prec));
        c.setAttribute("cy", fmt(p.y, prec));
        c.setAttribute("r", "4.5");
        c.setAttribute("fill", "none");
        c.setAttribute("stroke", stroke);
        c.setAttribute("stroke-width", String(nodeStrokeW));
        g.appendChild(c);
      } else {
        var size = 9;
        var r = ns("rect");
        r.setAttribute("class", "glyph-outline-node glyph-outline-node-corner");
        r.setAttribute("x", fmt(p.x - size / 2, prec));
        r.setAttribute("y", fmt(p.y - size / 2, prec));
        r.setAttribute("width", size);
        r.setAttribute("height", size);
        r.setAttribute("fill", "none");
        r.setAttribute("stroke", stroke);
        r.setAttribute("stroke-width", String(nodeStrokeW));
        g.appendChild(r);
      }
    });

    svg.appendChild(g);
    return true;
  }

  function resetAnchor(svg) {
    if (svg) svg._goPathAnchor = null;
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
      var root = opts.root || document.documentElement;
      var singleColor = resolveSingleColor(opts);
      if (singleColor) svg.style.color = singleColor;
      var syncId = (svg._goSync = (svg._goSync || 0) + 1);

      function paint(font) {
        if (svg._goSync !== syncId) return;
        var zoom = readZoom(root);
        var sr = stageEl.getBoundingClientRect();
        var w = sr.width / zoom;
        var h = sr.height / zoom;
        if (w > 0 && h > 0) {
          svg.setAttribute("viewBox", "0 0 " + w + " " + h);
          svg.setAttribute("width", w);
          svg.setAttribute("height", h);
        }
        var inPlace = opts.inPlace !== false && targets.length === 1;
        var hasGroup = !!svg.querySelector(".glyph-outline-group");
        if (!inPlace || !hasGroup) clearSvg(svg);
        targets.forEach(function (t) {
          var opacity = t.kind === "ghost" ? 0.35 : 1;
          renderTarget(svg, font, t, stageEl, root, opacity, opts);
        });
      }

      if (loadedFont && fontUrl === opts.fontUrl) {
        paint(loadedFont);
        return Promise.resolve();
      }

      var fontsReady =
        document.fonts && document.fonts.ready
          ? document.fonts.ready
          : Promise.resolve();

      return fontsReady
        .then(function () {
          return loadFont(opts.fontUrl);
        })
        .then(function (font) {
          paint(font);
        })
        .catch(function (err) {
          console.warn("GlyphOutlines:", err);
        });
    },

    resetAnchor: resetAnchor,
  };
})(typeof window !== "undefined" ? window : this);
