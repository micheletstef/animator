/**
 * Glyphs-style glyph outline overlay (paths, on-curve nodes, off-curve handles).
 * Uses opentype.js variable-font outlines aligned to live DOM text.
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

  /** Map opentype coords (y-up, baseline y=0) to SVG coords inside the stage. */
  function placement(el, stageEl, root, bb) {
    var zoom = readZoom(root);
    var stageRect = stageEl.getBoundingClientRect();
    var elRect = el.getBoundingClientRect();

    var local = {
      left: (elRect.left - stageRect.left) / zoom,
      top: (elRect.top - stageRect.top) / zoom,
      width: elRect.width / zoom,
      height: elRect.height / zoom,
    };

    var inkW = bb.x2 - bb.x1;
    var inkH = bb.y2 - bb.y1;
    if (inkW <= 0) inkW = 1;
    if (inkH <= 0) inkH = 1;

    var inkLeft = local.left + (local.width - inkW) / 2;
    var inkTop = local.top + (local.height - inkH) / 2;

    function map(ox, oy) {
      return {
        x: inkLeft + (ox - bb.x1),
        y: inkTop + (oy - bb.y1),
      };
    }

    return { map: map, inkLeft: inkLeft, inkTop: inkTop };
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
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function clearSvg(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function ns(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  function getCommands(font, char, fontSize, variation) {
    var glyph = font.charToGlyph(char);
    var useGlyph = font.variation
      ? font.variation.getTransform(glyph, variation)
      : glyph;
    return useGlyph.path && useGlyph.path.commands
      ? useGlyph.path.commands
      : font.getPath(char, 0, 0, fontSize, { variation: variation }).commands;
  }

  function renderTarget(svg, font, target, stageEl, root, opacity) {
    var el = target.el;
    var char = target.char;
    var fontSize = target.fontSize;
    var variation =
      target.variation != null ? target.variation : parseVariationFromElement(el);

    var path = font.getPath(char, 0, 0, fontSize, { variation: variation });
    var bb = path.getBoundingBox();
    if (!isFinite(bb.x1) || !isFinite(bb.y1)) return;

    var commands = getCommands(font, char, fontSize, variation);
    var geom = collectGeometry(commands);
    var textRect = el.getBoundingClientRect();
    if (!textRect.width) return;

    var place = placement(el, stageEl, root, bb);
    var map = place.map;

    var g = ns("g");
    g.setAttribute("class", "glyph-outline-group");
    if (target.kind) g.setAttribute("data-kind", target.kind);
    if (opacity < 1) g.setAttribute("opacity", String(opacity));

    var pathEl = ns("path");
    pathEl.setAttribute("class", "glyph-outline-path");
    pathEl.setAttribute("d", pathDFromCommands(commands, map));
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", COLORS.path);
    pathEl.setAttribute("stroke-width", "1.25");
    pathEl.setAttribute("vector-effect", "non-scaling-stroke");
    g.appendChild(pathEl);

    geom.handleLines.forEach(function (seg) {
      var a = map(seg[0].x, seg[0].y);
      var b = map(seg[1].x, seg[1].y);
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
      var p = map(h.x, h.y);
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
      var p = map(n.x, n.y);
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

      return loadFont(opts.fontUrl).then(function (font) {
        clearSvg(svg);
        targets.forEach(function (t) {
          var opacity = t.kind === "ghost" ? 0.35 : 1;
          renderTarget(svg, font, t, stageEl, root, opacity);
        });
      });
    },
  };
})(typeof window !== "undefined" ? window : this);
