/**
 * Glyph outline overlay: Bézier paths, on-curve nodes, and off-curve handles
 * aligned to live DOM text via opentype.js + canvas ink metrics.
 */
(function (global) {
  var fontPromise = null;
  var fontUrl = null;
  var measureCanvas = null;

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

  function measureInk(char, el, fontSize) {
    if (!measureCanvas) measureCanvas = document.createElement("canvas");
    var ctx = measureCanvas.getContext("2d");
    var cs = getComputedStyle(el);
    ctx.font = cs.font;
    if (ctx.fontVariationSettings !== undefined && cs.fontVariationSettings) {
      ctx.fontVariationSettings = cs.fontVariationSettings;
    }
    var m = ctx.measureText(char);
    return {
      left: m.actualBoundingBoxLeft,
      right: m.actualBoundingBoxRight,
      ascent: m.actualBoundingBoxAscent,
      descent: m.actualBoundingBoxDescent,
    };
  }

  function inkBox(textRect, ink) {
    var w = ink.left + ink.right;
    var h = ink.ascent + ink.descent;
    return {
      left: textRect.left + (textRect.width - w) / 2,
      top: textRect.top + (textRect.height - h) / 2,
      width: w,
      height: h,
    };
  }

  function mapPoint(ox, oy, bb, ink, stageRect, zoom) {
    var bbW = bb.x2 - bb.x1;
    var bbH = bb.y2 - bb.y1;
    if (bbW <= 0) bbW = 1;
    if (bbH <= 0) bbH = 1;
    return {
      x: (ink.left - stageRect.left) / zoom + ((ox - bb.x1) / bbW) * ink.width,
      y: (ink.top - stageRect.top) / zoom + ((oy - bb.y1) / bbH) * ink.height,
    };
  }

  function collectGeometry(path) {
    var nodes = [];
    var handles = [];
    var handleLines = [];
    var cur = null;
    var start = null;

    function onNode(x, y) {
      nodes.push({ x: x, y: y, on: true });
      return { x: x, y: y };
    }

    function offNode(x, y) {
      handles.push({ x: x, y: y });
      return { x: x, y: y };
    }

    path.commands.forEach(function (cmd) {
      if (cmd.type === "M") {
        cur = onNode(cmd.x, cmd.y);
        start = cur;
      } else if (cmd.type === "L") {
        if (cur) handleLines.push([cur, { x: cmd.x, y: cmd.y }]);
        cur = onNode(cmd.x, cmd.y);
      } else if (cmd.type === "C") {
        var c1 = offNode(cmd.x1, cmd.y1);
        var c2 = offNode(cmd.x2, cmd.y2);
        if (cur) {
          handleLines.push([cur, c1]);
          handleLines.push([c2, { x: cmd.x, y: cmd.y }]);
        }
        cur = onNode(cmd.x, cmd.y);
      } else if (cmd.type === "Q") {
        var qc = offNode(cmd.x1, cmd.y1);
        if (cur) handleLines.push([cur, qc]);
        cur = onNode(cmd.x, cmd.y);
      } else if (cmd.type === "Z") {
        if (cur && start) handleLines.push([cur, start]);
        cur = start;
      }
    });

    return {
      d: path.toPathData(2),
      nodes: nodes,
      handles: handles,
      handleLines: handleLines,
    };
  }

  function clearSvg(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function ns(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  function renderTarget(svg, font, target, stageEl, zoom, strokeColor) {
    var el = target.el;
    var char = target.char;
    var fontSize = target.fontSize;
    var variation =
      target.variation != null ? target.variation : parseVariationFromElement(el);

    var path = font.getPath(char, 0, 0, fontSize, { variation: variation });
    var bb = path.getBoundingBox();
    if (!isFinite(bb.x1) || !isFinite(bb.y1)) return;

    var geom = collectGeometry(path);
    var textRect = el.getBoundingClientRect();
    if (!textRect.width) return;

    var inkMetrics = measureInk(char, el, fontSize);
    var ink = inkBox(textRect, inkMetrics);
    var stageRect = stageEl.getBoundingClientRect();

    function mp(x, y) {
      return mapPoint(x, y, bb, ink, stageRect, zoom);
    }

    var g = ns("g");
    g.setAttribute("class", "glyph-outline-group");
    if (target.kind) g.setAttribute("data-kind", target.kind);

    var pathEl = ns("path");
    pathEl.setAttribute("class", "glyph-outline-path");
    pathEl.setAttribute("d", geom.d);
    pathEl.setAttribute(
      "transform",
      buildTransform(bb, ink, stageRect, zoom)
    );
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", strokeColor);
    pathEl.setAttribute("vector-effect", "non-scaling-stroke");
    g.appendChild(pathEl);

    var nodesG = ns("g");
    nodesG.setAttribute("class", "glyph-outline-nodes");

    geom.handleLines.forEach(function (seg) {
      var a = mp(seg[0].x, seg[0].y);
      var b = mp(seg[1].x, seg[1].y);
      var line = ns("line");
      line.setAttribute("class", "glyph-outline-handle-line");
      line.setAttribute("x1", a.x);
      line.setAttribute("y1", a.y);
      line.setAttribute("x2", b.x);
      line.setAttribute("y2", b.y);
      line.setAttribute("stroke", strokeColor);
      line.setAttribute("vector-effect", "non-scaling-stroke");
      nodesG.appendChild(line);
    });

    geom.handles.forEach(function (h) {
      var p = mp(h.x, h.y);
      var c = ns("circle");
      c.setAttribute("class", "glyph-outline-handle");
      c.setAttribute("cx", p.x);
      c.setAttribute("cy", p.y);
      c.setAttribute("r", "3");
      c.setAttribute("fill", strokeColor);
      nodesG.appendChild(c);
    });

    geom.nodes.forEach(function (n) {
      var p = mp(n.x, n.y);
      var r = ns("rect");
      r.setAttribute("class", "glyph-outline-node");
      r.setAttribute("x", p.x - 3);
      r.setAttribute("y", p.y - 3);
      r.setAttribute("width", "6");
      r.setAttribute("height", "6");
      r.setAttribute("fill", strokeColor);
      nodesG.appendChild(r);
    });

    g.appendChild(nodesG);
    svg.appendChild(g);
  }

  function buildTransform(bb, ink, stageRect, zoom) {
    var bbW = bb.x2 - bb.x1;
    var bbH = bb.y2 - bb.y1;
    if (bbW <= 0) bbW = 1;
    if (bbH <= 0) bbH = 1;
    var tx = (ink.left - stageRect.left) / zoom - bb.x1 * (ink.width / bbW);
    var ty = (ink.top - stageRect.top) / zoom - bb.y1 * (ink.height / bbH);
    var sx = ink.width / bbW;
    var sy = ink.height / bbH;
    return (
      "translate(" +
      tx +
      "," +
      ty +
      ") scale(" +
      sx +
      "," +
      sy +
      ")"
    );
  }

  function readZoom(root) {
    if (!root) return 1;
    var z = parseFloat(getComputedStyle(root).getPropertyValue("--zoom"));
    return isFinite(z) && z > 0 ? z : 1;
  }

  global.GlyphOutlines = {
    loadFont: loadFont,
    parseVariation: parseVariationSettings,
    parseVariationFromElement: parseVariationFromElement,

    /**
     * @param {SVGElement} svg
     * @param {HTMLElement} stageEl
     * @param {Array<{el:HTMLElement,char:string,fontSize:number,variation?:object,kind?:string}>} targets
     * @param {{ fontUrl: string, root?: HTMLElement, strokeColor?: string }} opts
     */
    sync: function (svg, stageEl, targets, opts) {
      if (!svg || !stageEl || !targets || !targets.length) {
        if (svg) clearSvg(svg);
        return Promise.resolve();
      }
      var root = opts.root || document.documentElement;
      var zoom = readZoom(root);
      var strokeColor = opts.strokeColor || "currentColor";

      return loadFont(opts.fontUrl).then(function (font) {
        clearSvg(svg);
        targets.forEach(function (t) {
          renderTarget(svg, font, t, stageEl, zoom, strokeColor);
        });
      });
    },
  };
})(typeof window !== "undefined" ? window : this);
