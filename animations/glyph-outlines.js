/**
 * Glyphs-style glyph outline overlay (paths, on-curve nodes, off-curve handles).
 * Uses opentype.js variable-font outlines aligned to live DOM text.
 * Overlapping components are merged via martinez polygon union (pathfind).
 */
(function (global) {
  var fontPromise = null;
  var fontUrl = null;
  var COLORS = {
    path: "rgba(0, 120, 255, 0.85)",
    handleLine: "rgba(0, 120, 255, 0.45)",
    offCurve: "rgba(255, 120, 0, 0.95)",
    onCurve: "rgba(0, 120, 255, 0.95)",
    onCurveSmooth: "rgba(0, 180, 80, 0.95)",
  };

  function loadFont(url) {
    if (fontUrl !== url) {
      fontUrl = url;
      fontPromise = null;
    }
    if (!fontPromise) {
      fontPromise = fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error("font fetch failed");
          return r.arrayBuffer();
        })
        .then(function (buf) {
          return opentype.parse(buf);
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

  function measureInk(el, char) {
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d");
    var cs = getComputedStyle(el);
    ctx.font = cs.font;
    if (ctx.fontVariationSettings !== undefined && cs.fontVariationSettings) {
      ctx.fontVariationSettings = cs.fontVariationSettings;
    }
    if (ctx.letterSpacing !== undefined && cs.letterSpacing && cs.letterSpacing !== "normal") {
      ctx.letterSpacing = cs.letterSpacing;
    }
    var m = ctx.measureText(char);
    return {
      left: typeof m.actualBoundingBoxLeft === "number" ? m.actualBoundingBoxLeft : 0,
      right:
        typeof m.actualBoundingBoxRight === "number" ? m.actualBoundingBoxRight : 0,
      ascent:
        typeof m.actualBoundingBoxAscent === "number" ? m.actualBoundingBoxAscent : 0,
      descent:
        typeof m.actualBoundingBoxDescent === "number"
          ? m.actualBoundingBoxDescent
          : 0,
    };
  }

  /**
   * getPath(0,0, fontSize): pen at (0,0), y up. Match browser pen via ink metrics.
   */
  function placement(stageEl, root, el, char, pathBb) {
    var zoom = readZoom(root);
    var stageRect = stageEl.getBoundingClientRect();
    var elRect = el.getBoundingClientRect();
    var stageW = stageRect.width / zoom;
    var stageH = stageRect.height / zoom;

    var localLeft = (elRect.left - stageRect.left) / zoom;
    var localTop = (elRect.top - stageRect.top) / zoom;
    var localH = elRect.height / zoom;
    var localBottom = (elRect.bottom - stageRect.top) / zoom;
    var fs = fontSizePx(el);

    var ink = measureInk(el, char);
    // Canvas often under-reports variable-font ink boxes at large sizes
    var metricsOk = ink.ascent + ink.descent > fs * 0.35;

    var originX = localLeft;
    var baselineY = localTop + localH;

    var map;

    if (metricsOk) {
      originX = localLeft + ink.left;
      baselineY = localTop + ink.ascent;
      map = function (ox, oy) {
        return { x: originX + ox, y: baselineY + oy };
      };
    } else if (pathBb && isFinite(pathBb.x1) && isFinite(pathBb.y1)) {
      var pathW = pathBb.x2 - pathBb.x1;
      var pathH = pathBb.y2 - pathBb.y1;
      var elW = elRect.width / zoom;
      if (pathW > 0 && pathH > 0 && elW > 0 && localH > 0) {
        map = function (ox, oy) {
          return {
            x: localLeft + ((ox - pathBb.x1) / pathW) * elW,
            y: localTop + ((oy - pathBb.y1) / pathH) * localH,
          };
        };
      }
    }

    if (!map) {
      map = function (ox, oy) {
        return { x: originX + ox, y: baselineY + oy };
      };
    }

    return { map: map, stageW: stageW, stageH: stageH };
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
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function clearSvg(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function ns(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  function renderTarget(svg, font, target, stageEl, root, opacity) {
    var el = target.el;
    var char = target.char;
    var fontSize = fontSizePx(el);
    var variation =
      target.variation != null ? target.variation : parseVariationFromElement(el);

    var path = font.getPath(char, 0, 0, fontSize, { variation: variation });
    var bb = path.getBoundingBox();
    if (!isFinite(bb.x1) || !isFinite(bb.y1)) return;

    var commands = path.commands;
    if (!commands || !commands.length) return;

    var place = placement(stageEl, root, el, char, bb);
    var map = place.map;
    var subpaths = splitSubpaths(commands);
    var tol = Math.max(0.2, fontSize * 0.0004);
    var merged =
      subpaths.length > 1 ? pathfindContours(subpaths, map, tol) : null;
    var d = merged ? merged.d : pathDFromCommands(commands, map);
    var geom = merged
      ? {
          nodes: merged.nodes,
          handles: [],
          handleLines: [],
          screenSpace: true,
        }
      : collectGeometry(commands);
    if (!d || d.indexOf("NaN") !== -1) return;

    var g = ns("g");
    g.setAttribute("class", "glyph-outline-group");
    if (target.kind) g.setAttribute("data-kind", target.kind);
    if (opacity < 1) g.setAttribute("opacity", String(opacity));

    var pathEl = ns("path");
    pathEl.setAttribute("class", "glyph-outline-path");
    pathEl.setAttribute("d", d);
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", COLORS.path);
    pathEl.setAttribute("stroke-width", "1.25");
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
      line.setAttribute("x1", a.x);
      line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x);
      line.setAttribute("y2", b.y);
      line.setAttribute("stroke", COLORS.handleLine);
      line.setAttribute("stroke-width", "1");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      g.appendChild(line);
    });

    geom.handles.forEach(function (h) {
      var p = toScreen(h);
      var c = ns("circle");
      c.setAttribute("class", "glyph-outline-handle");
      c.setAttribute("cx", p.x);
      c.setAttribute("cy", p.y);
      c.setAttribute("r", "4");
      c.setAttribute("fill", COLORS.offCurve);
      c.setAttribute("stroke", "#fff");
      c.setAttribute("stroke-width", "1");
      g.appendChild(c);
    });

    geom.nodes.forEach(function (n) {
      var p = toScreen(n);
      var fill = n.smooth ? COLORS.onCurveSmooth : COLORS.onCurve;
      if (n.smooth) {
        var c = ns("circle");
        c.setAttribute("class", "glyph-outline-node glyph-outline-node-smooth");
        c.setAttribute("cx", p.x);
        c.setAttribute("cy", p.y);
        c.setAttribute("r", "4.5");
        c.setAttribute("fill", fill);
        c.setAttribute("stroke", "#fff");
        c.setAttribute("stroke-width", "1");
        g.appendChild(c);
      } else {
        var size = 9;
        var r = ns("rect");
        r.setAttribute("class", "glyph-outline-node glyph-outline-node-corner");
        r.setAttribute("x", p.x - size / 2);
        r.setAttribute("y", p.y - size / 2);
        r.setAttribute("width", size);
        r.setAttribute("height", size);
        r.setAttribute("fill", fill);
        r.setAttribute("stroke", "#fff");
        r.setAttribute("stroke-width", "1");
        g.appendChild(r);
      }
    });

    svg.appendChild(g);
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
      var root = opts.root || document.documentElement;
      var fontsReady =
        document.fonts && document.fonts.ready
          ? document.fonts.ready
          : Promise.resolve();

      return fontsReady
        .then(function () {
          return loadFont(opts.fontUrl);
        })
        .then(function (font) {
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
            renderTarget(svg, font, t, stageEl, root, opacity);
          });
        })
        .catch(function (err) {
          console.warn("GlyphOutlines:", err);
        });
    },
  };
})(typeof window !== "undefined" ? window : this);
