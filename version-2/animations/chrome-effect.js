/* Optional chrome treatment. Same masks and gradients as line cascade opt 1. */
(function (global) {
  "use strict";

  var chromeSeq = 0;
  var FIGMA_EM = 425.59;

  function figmaPx(px, fontSize) {
    return (Number(px) || 0) * (Number(fontSize) || 0) / FIGMA_EM;
  }

  function ensureStyle() {
    if (document.getElementById("chromeEffectStyle")) return;
    var style = document.createElement("style");
    style.id = "chromeEffectStyle";
    style.textContent = [
      ".is-chrome{position:relative;color:transparent!important;}",
      ".is-chrome-inline{display:inline-block;vertical-align:baseline;}",
      ".is-chrome>svg.chrome{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;}"
    ].join("");
    document.head.appendChild(style);
  }

var SVGNS = "http://www.w3.org/2000/svg";
var CHROME_FONT = "../../fonts/ABCIkarusPlusVariable.ttf";
var CHROME_FILL_STOPS = [
  [0.11, "#FBFCFE"],
  [0.32, "#C0C9E1"],
  [0.4, "#969AA5"],
  [0.57, "#707078"],
  [0.63, "#6A696F"],
  [0.69, "#47454B"],
  [0.81, "#7A7C88"],
  [0.99, "#BCD1DF"],
];
var CHROME_STROKE_STOPS = [
  [0, "#F8F9FB"],
  [1, "#EBEDF2"],
];
var OFFSET_FILL_STOPS = [
  [0, "#393F52"],
  [0.45, "#A3A7B3"],
  [0.72, "#525A69"],
  [1, "#323444"],
];
var OFFSET_STROKE_STOPS = [
  [0, "#353D52"],
  [0.44, "#2D3345"],
  [1, "#212534"],
];
var FACE_GRADIENT_END = 0.74;

function flattenPath(d, tol) {
  var tok = String(d || "").match(/[MLQCZ]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g);
  if (!tok) return [];
  var i = 0;
  var subs = [];
  var sub = [];
  var cx = 0;
  var cy = 0;
  function push(x, y) {
    var last = sub[sub.length - 1];
    if (!last || Math.hypot(last.x - x, last.y - y) > 0.02) sub.push({ x: x, y: y });
    cx = x;
    cy = y;
  }
  function mid(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  function flatCubic(a, b, c, e, depth) {
    var dx = e.x - a.x;
    var dy = e.y - a.y;
    var len = Math.hypot(dx, dy);
    var dev =
      len < 1e-6
        ? Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y))
        : Math.max(
            Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx),
            Math.abs((c.x - a.x) * dy - (c.y - a.y) * dx)
          ) / len;
    if (dev <= tol || depth > 10) {
      push(e.x, e.y);
      return;
    }
    var ab = mid(a, b);
    var bc = mid(b, c);
    var ce = mid(c, e);
    var abc = mid(ab, bc);
    var bce = mid(bc, ce);
    var abcd = mid(abc, bce);
    flatCubic(a, ab, abc, abcd, depth + 1);
    flatCubic(abcd, bce, ce, e, depth + 1);
  }
  function closeSub() {
    if (sub.length >= 3) {
      var a = sub[0];
      var b = sub[sub.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.05) sub.pop();
      if (sub.length >= 3) subs.push(sub);
    }
    sub = [];
  }
  while (i < tok.length) {
    var op = tok[i++];
    if (op === "M") {
      if (sub.length) closeSub();
      cx = parseFloat(tok[i++]);
      cy = parseFloat(tok[i++]);
      sub = [{ x: cx, y: cy }];
    } else if (op === "L") {
      push(parseFloat(tok[i++]), parseFloat(tok[i++]));
    } else if (op === "Q") {
      var x1 = parseFloat(tok[i++]);
      var y1 = parseFloat(tok[i++]);
      var x = parseFloat(tok[i++]);
      var y = parseFloat(tok[i++]);
      var p0 = { x: cx, y: cy };
      var p2 = { x: x, y: y };
      flatCubic(
        p0,
        { x: p0.x + (2 / 3) * (x1 - p0.x), y: p0.y + (2 / 3) * (y1 - p0.y) },
        { x: p2.x + (2 / 3) * (x1 - p2.x), y: p2.y + (2 / 3) * (y1 - p2.y) },
        p2,
        0
      );
    } else if (op === "C") {
      var c1x = parseFloat(tok[i++]);
      var c1y = parseFloat(tok[i++]);
      var c2x = parseFloat(tok[i++]);
      var c2y = parseFloat(tok[i++]);
      var ex = parseFloat(tok[i++]);
      var ey = parseFloat(tok[i++]);
      flatCubic({ x: cx, y: cy }, { x: c1x, y: c1y }, { x: c2x, y: c2y }, { x: ex, y: ey }, 0);
    } else if (op === "Z") {
      closeSub();
    }
  }
  if (sub.length) closeSub();
  return subs;
}

function ringsToD(rings) {
  var parts = [];
  rings.forEach(function (ring) {
    if (!ring || ring.length < 3) return;
    parts.push("M" + ring[0].x.toFixed(2) + " " + ring[0].y.toFixed(2));
    for (var i = 1; i < ring.length; i++) {
      parts.push("L" + ring[i].x.toFixed(2) + " " + ring[i].y.toFixed(2));
    }
    parts.push("Z");
  });
  return parts.join("");
}

function offsetRing(pts, dist, radius) {
  var n = pts.length;
  if (n < 3) return [];
  if (dist <= 0.05) {
    return pts.map(function (p) {
      return { x: p.x, y: p.y };
    });
  }
  var dirs = [];
  var nors = [];
  var i;
  for (i = 0; i < n; i++) {
    var a = pts[i];
    var b = pts[(i + 1) % n];
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len = Math.hypot(dx, dy) || 1;
    dirs.push({ x: dx / len, y: dy / len });
    nors.push({ x: dy / len, y: -dx / len });
  }
  function intersect(p, d, q, e) {
    var cross = d.x * e.y - d.y * e.x;
    if (Math.abs(cross) < 1e-9) return null;
    var ddx = q.x - p.x;
    var ddy = q.y - p.y;
    var t = (ddx * e.y - ddy * e.x) / cross;
    return { x: p.x + d.x * t, y: p.y + d.y * t };
  }
  function onSeg(T, A, B) {
    var sx = B.x - A.x;
    var sy = B.y - A.y;
    var L2 = sx * sx + sy * sy;
    if (L2 < 1e-6) return false;
    var u = ((T.x - A.x) * sx + (T.y - A.y) * sy) / L2;
    return u >= -0.04 && u <= 1.04;
  }
  function normAng(ang) {
    while (ang <= -Math.PI) ang += Math.PI * 2;
    while (ang > Math.PI) ang -= Math.PI * 2;
    return ang;
  }
  var out = [];
  for (i = 0; i < n; i++) {
    var ip = (i + n - 1) % n;
    var inn = (i + 1) % n;
    var n0 = nors[ip];
    var n1 = nors[i];
    var d0 = dirs[ip];
    var d1 = dirs[i];
    var v = pts[i];
    var vp = pts[ip];
    var vn = pts[inn];
    var edge0 = { x: vp.x + n0.x * dist, y: vp.y + n0.y * dist };
    var p0 = { x: v.x + n0.x * dist, y: v.y + n0.y * dist };
    var p1 = { x: v.x + n1.x * dist, y: v.y + n1.y * dist };
    var edge1 = { x: vn.x + n1.x * dist, y: vn.y + n1.y * dist };
    var M = intersect(p0, d0, p1, d1) || p1;
    var cross = d0.x * d1.y - d0.y * d1.x;
    var dot = d0.x * d1.x + d0.y * d1.y;
    var turn = Math.atan2(cross, dot);
    var fitted = false;
    if (turn > 0.32 && radius > 0.3) {
      var det = n0.x * n1.y - n0.y * n1.x;
      if (Math.abs(det) > 1e-8) {
        var target = dist - radius;
        var C = {
          x: v.x + (target * (n1.y - n0.y)) / det,
          y: v.y + (target * (n0.x - n1.x)) / det,
        };
        var T0 = { x: C.x + n0.x * radius, y: C.y + n0.y * radius };
        var T1 = { x: C.x + n1.x * radius, y: C.y + n1.y * radius };
        if (onSeg(T0, edge0, p0) && onSeg(T1, p1, edge1)) {
          var a0 = Math.atan2(T0.y - C.y, T0.x - C.x);
          var a1 = Math.atan2(T1.y - C.y, T1.x - C.x);
          var am = Math.atan2(M.y - C.y, M.x - C.x);
          var delta = normAng(a1 - a0);
          var alt = delta > 0 ? delta - Math.PI * 2 : delta + Math.PI * 2;
          function contains(span) {
            var rel = normAng(am - a0);
            if (span >= 0) return rel >= -0.08 && rel <= span + 0.08;
            return rel <= 0.08 && rel >= span - 0.08;
          }
          if (!contains(delta) && contains(alt)) delta = alt;
          if (Math.abs(delta) <= Math.PI * 0.96) {
            var steps = Math.max(2, Math.ceil(Math.abs(delta) / (Math.PI / 10)));
            var s;
            for (s = 0; s <= steps; s++) {
              var ang = a0 + delta * (s / steps);
              out.push({ x: C.x + Math.cos(ang) * radius, y: C.y + Math.sin(ang) * radius });
            }
            fitted = true;
          }
        }
      }
    }
    if (!fitted) {
      var md = Math.hypot(M.x - v.x, M.y - v.y);
      var outward = (n0.x + n1.x) * (M.x - v.x) + (n0.y + n1.y) * (M.y - v.y);
      if (md > dist * 2 || outward < 0) {
        out.push(p0);
        out.push(p1);
      } else {
        out.push(M);
      }
    }
  }
  var clean = [];
  for (i = 0; i < out.length; i++) {
    var prev = clean[clean.length - 1];
    if (!prev || Math.hypot(prev.x - out[i].x, prev.y - out[i].y) > 0.04) clean.push(out[i]);
  }
  if (clean.length > 2 && Math.hypot(clean[0].x - clean[clean.length - 1].x, clean[0].y - clean[clean.length - 1].y) < 0.05) {
    clean.pop();
  }
  return clean.length >= 3 ? clean : [];
}

function expandRings(rings, dist, radius) {
  var out = [];
  rings.forEach(function (ring) {
    var next = offsetRing(ring, dist, radius);
    if (next.length >= 3) out.push(next);
  });
  return out;
}

function cornerDotsD(rings, radius) {
  if (radius < 0.4) return "";
  var parts = [];
  rings.forEach(function (ring) {
    var n = ring.length;
    var i;
    for (i = 0; i < n; i++) {
      var b = ring[i];
      var a = null;
      var c = null;
      var k;
      var j = i;
      for (k = 0; k < n; k++) {
        j = (j - 1 + n) % n;
        if (Math.hypot(ring[j].x - b.x, ring[j].y - b.y) >= 1.8) {
          a = ring[j];
          break;
        }
      }
      j = i;
      for (k = 0; k < n; k++) {
        j = (j + 1) % n;
        if (Math.hypot(ring[j].x - b.x, ring[j].y - b.y) >= 1.8) {
          c = ring[j];
          break;
        }
      }
      if (!a || !c) continue;
      var d0x = b.x - a.x;
      var d0y = b.y - a.y;
      var d1x = c.x - b.x;
      var d1y = c.y - b.y;
      var ang = Math.abs(Math.atan2(d0x * d1y - d0y * d1x, d0x * d1x + d0y * d1y));
      if (ang < 0.62) continue;
      var r = radius.toFixed(2);
      var x = b.x.toFixed(2);
      var y = b.y.toFixed(2);
      parts.push(
        "M" + x + " " + (b.y - radius).toFixed(2) +
          "A" + r + " " + r + " 0 1 1 " + x + " " + (b.y + radius).toFixed(2) +
          "A" + r + " " + r + " 0 1 1 " + x + " " + (b.y - radius).toFixed(2) + "Z"
      );
    }
  });
  return parts.join("");
}

function ensureChrome(el) {
  var svg = el.querySelector("svg.chrome");
  if (svg) return svg;
  var index = el.getAttribute("data-chrome-id");
  if (!index) {
    chromeSeq += 1;
    index = String(chromeSeq);
    el.setAttribute("data-chrome-id", index);
  }
  svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("class", "chrome");
  svg.setAttribute("aria-hidden", "true");
  var defs = document.createElementNS(SVGNS, "defs");
  function makeGrad(id, stops) {
    var grad = document.createElementNS(SVGNS, "linearGradient");
    grad.setAttribute("id", id);
    grad.setAttribute("gradientUnits", "userSpaceOnUse");
    grad.setAttribute("x1", "0");
    grad.setAttribute("x2", "0");
    stops.forEach(function (stop) {
      var node = document.createElementNS(SVGNS, "stop");
      node.setAttribute("offset", stop[0] * 100 + "%");
      node.setAttribute("stop-color", stop[1]);
      if (stop.length > 2) node.setAttribute("stop-opacity", String(stop[2]));
      grad.appendChild(node);
    });
    return grad;
  }
  defs.appendChild(makeGrad("chromeOffsetFill" + index, OFFSET_FILL_STOPS));
  defs.appendChild(makeGrad("chromeOffsetStroke" + index, OFFSET_STROKE_STOPS));
  var faceGrad = makeGrad("chromeGrad" + index, CHROME_FILL_STOPS);
  faceGrad.setAttribute("class", "face-grad");
  defs.appendChild(faceGrad);
  defs.appendChild(makeGrad("chromeStroke" + index, CHROME_STROKE_STOPS));
  function userMask(id) {
    var node = document.createElementNS(SVGNS, "mask");
    node.setAttribute("id", id);
    node.setAttribute("class", "chrome-region");
    node.setAttribute("maskUnits", "userSpaceOnUse");
    node.setAttribute("maskContentUnits", "userSpaceOnUse");
    return node;
  }
  function glyphPath(className, fill) {
    var node = document.createElementNS(SVGNS, "path");
    node.setAttribute("class", "glyph " + className);
    node.setAttribute("fill", fill || "#ffffff");
    node.setAttribute("fill-rule", "nonzero");
    node.setAttribute("stroke", "none");
    return node;
  }
  function offsetStroke(className, paint, widthClass) {
    var node = glyphPath(className, "none");
    node.setAttribute("stroke", paint);
    node.setAttribute("stroke-linejoin", "round");
    node.setAttribute("stroke-linecap", "round");
    node.setAttribute("class", node.getAttribute("class") + " " + widthClass);
    return node;
  }
  function plainPath(className, fill) {
    var node = document.createElementNS(SVGNS, "path");
    node.setAttribute("class", className);
    node.setAttribute("fill", fill || "#ffffff");
    node.setAttribute("fill-rule", "nonzero");
    node.setAttribute("stroke", "none");
    return node;
  }
  function filterNode(name, attrs) {
    var node = document.createElementNS(SVGNS, name);
    Object.keys(attrs).forEach(function (key) {
      node.setAttribute(key, attrs[key]);
    });
    return node;
  }
  var fillMask = userMask("chromeOffsetFillMask" + index);
  fillMask.appendChild(plainPath("expand-fill", "#ffffff"));
  defs.appendChild(fillMask);
  var strokeMask = userMask("chromeOffsetStrokeMask" + index);
  strokeMask.appendChild(plainPath("expand-outer", "#ffffff"));
  strokeMask.appendChild(plainPath("expand-inner", "#000000"));
  defs.appendChild(strokeMask);
  var mask = userMask("chromeStrokeMask" + index);
  mask.appendChild(glyphPath("edge-fill", "#ffffff"));
  mask.appendChild(offsetStroke("edge-rim", "#ffffff", "width-edge"));
  mask.appendChild(glyphPath("edge-hole", "#000000"));
  defs.appendChild(mask);
  var filter = document.createElementNS(SVGNS, "filter");
  filter.setAttribute("id", "chromeFx" + index);
  filter.setAttribute("class", "chrome-region");
  filter.setAttribute("filterUnits", "userSpaceOnUse");
  filter.setAttribute("primitiveUnits", "userSpaceOnUse");
  filter.setAttribute("color-interpolation-filters", "sRGB");
  filter.appendChild(filterNode("feGaussianBlur", { in: "SourceAlpha", stdDeviation: "4", result: "dropBlur", class: "drop-blur" }));
  filter.appendChild(filterNode("feFlood", { "flood-color": "#000000", "flood-opacity": "0.5", result: "dropColor" }));
  filter.appendChild(filterNode("feComposite", { in: "dropColor", in2: "dropBlur", operator: "in", result: "drop" }));
  filter.appendChild(filterNode("feFlood", { "flood-color": "#ffffff", "flood-opacity": "1", result: "lipColor" }));
  filter.appendChild(filterNode("feComposite", { in: "lipColor", in2: "SourceAlpha", operator: "out", result: "outside" }));
  filter.appendChild(filterNode("feOffset", { in: "outside", dx: "1.55", dy: "1.55", result: "shifted", class: "inner-offset" }));
  filter.appendChild(filterNode("feGaussianBlur", { in: "shifted", stdDeviation: "4", result: "lipBlur", class: "inner-blur" }));
  filter.appendChild(filterNode("feComposite", { in: "lipBlur", in2: "SourceAlpha", operator: "in", result: "inner" }));
  var merge = document.createElementNS(SVGNS, "feMerge");
  merge.appendChild(filterNode("feMergeNode", { in: "drop" }));
  merge.appendChild(filterNode("feMergeNode", { in: "SourceGraphic" }));
  merge.appendChild(filterNode("feMergeNode", { in: "inner" }));
  filter.appendChild(merge);
  defs.appendChild(filter);
  function plate(className, fill, maskId) {
    var node = document.createElementNS(SVGNS, "rect");
    node.setAttribute("class", "plate " + className);
    node.setAttribute("fill", fill);
    if (maskId) node.setAttribute("mask", "url(#" + maskId + ")");
    return node;
  }
  var offset = document.createElementNS(SVGNS, "g");
  offset.setAttribute("class", "chrome-offset");
  offset.appendChild(plate("offset-fill", "url(#chromeOffsetFill" + index + ")", "chromeOffsetFillMask" + index));
  offset.appendChild(plate("offset-stroke", "url(#chromeOffsetStroke" + index + ")", "chromeOffsetStrokeMask" + index));
  var face = glyphPath("face", "url(#chromeGrad" + index + ")");
  var innerPlate = plate("stroke-plate", "url(#chromeStroke" + index + ")", "chromeStrokeMask" + index);
  innerPlate.setAttribute("opacity", "0.6");
  var ink = document.createElementNS(SVGNS, "g");
  ink.setAttribute("class", "chrome-ink");
  ink.setAttribute("filter", "url(#chromeFx" + index + ")");
  ink.appendChild(face);
  ink.appendChild(innerPlate);
  svg.appendChild(defs);
  svg.appendChild(offset);
  svg.appendChild(ink);
  el.appendChild(svg);
  return svg;
}

  function numSpec(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function paint(el, spec) {
    if (!el || !global.GlyphOutlines || !global.GlyphOutlines.textOutline) return Promise.resolve();
    ensureStyle();
    spec = spec || {};
    var text = spec.text == null ? "" : String(spec.text);
    if (!text.replace(/\s/g, "")) {
      clear(el);
      return Promise.resolve();
    }
    var display = window.getComputedStyle(el).display;
    el.classList.add("is-chrome");
    if (display === "inline") el.classList.add("is-chrome-inline");
    var width = el.clientWidth;
    var height = el.clientHeight;
    if (width < 2 || height < 2) {
      el._chromeReady = Promise.resolve();
      return el._chromeReady;
    }
    var fontSize = numSpec(spec.size, 100);
    var wght = numSpec(spec.wght, 400);
    var wdth = numSpec(spec.wdth, 100);
    var cntr = numSpec(spec.cntr, 0);
    var slnt = numSpec(spec.slnt, 0);
    var track = numSpec(spec.track, 0);
    var align = spec.align || "center";
    var offsetPx = numSpec(spec.offset, 14);
    var roundPx = numSpec(spec.round, 14);
    var strokePx = numSpec(spec.stroke, 6.19);
    var features = spec.features || (spec.feature ? [spec.feature] : []);
    var disabled = spec.disabled || [];
    var variation = { wght: wght, wdth: wdth, CNTR: cntr, slnt: slnt };
    var key = [
      text, Math.round(width), Math.round(height), fontSize.toFixed(1),
      wght.toFixed(1), wdth.toFixed(1), cntr.toFixed(1), slnt.toFixed(2), track.toFixed(4),
      align, offsetPx.toFixed(2), roundPx.toFixed(2), strokePx.toFixed(2),
      features.join(","), disabled.join(",")
    ].join("|");
    var drawn = el.querySelector("svg.chrome .glyph");
    if (el._chromeKey === key && drawn && drawn.getAttribute("d")) {
      el._chromeReady = Promise.resolve();
      return el._chromeReady;
    }
    if (el._chromeBusy) {
      el._chromeQueued = spec;
      return el._chromeReady || Promise.resolve();
    }
    el._chromeBusy = true;
    var svg = ensureChrome(el);
    var gen = (el._chromeGen || 0) + 1;
    el._chromeGen = gen;
    var cap = fontSize * 0.7;
    var baseline = (height - cap) / 2 + cap;
    var outlineOpts = { tracking: track * fontSize, y: baseline };
    if (features.length) outlineOpts.features = features;
    if (disabled.length) outlineOpts.disabled = disabled;
    var job = global.GlyphOutlines.textOutline(spec.font || CHROME_FONT, text, fontSize, variation, outlineOpts).then(function (out) {
      if (el._chromeGen !== gen) return;
      var textWidth = out.width || 0;
      var x0 = align === "left" ? 0 : align === "right" ? width - textWidth : (width - textWidth) / 2;
      var d = out.d || "";
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      var top = baseline - cap;
      var bot = baseline + fontSize * 0.02;
      svg.querySelectorAll("linearGradient").forEach(function (grad) {
        grad.setAttribute("y1", String(top));
        grad.setAttribute("y2", String(bot));
      });
      var faceGradNode = svg.querySelector(".face-grad");
      if (faceGradNode) faceGradNode.setAttribute("y2", String(top + (bot - top) * FACE_GRADIENT_END));
      var edgeW = figmaPx(strokePx, fontSize);
      var innerEdge = figmaPx(6.19, fontSize);
      var offsetD = figmaPx(offsetPx, fontSize);
      var roundR = figmaPx(roundPx, fontSize);
      var pad = Math.max(24, figmaPx(21.66, fontSize) * 3, (offsetD + edgeW + roundR) * 2);
      svg.querySelectorAll(".chrome-region").forEach(function (node) {
        node.setAttribute("x", String(-pad));
        node.setAttribute("y", String(-pad));
        node.setAttribute("width", String(width + pad * 2));
        node.setAttribute("height", String(height + pad * 2));
      });
      svg.querySelectorAll(".width-edge").forEach(function (node) {
        node.setAttribute("stroke-width", String(Math.max(0.4, innerEdge)));
      });
      var drop = svg.querySelector(".drop-blur");
      if (drop) drop.setAttribute("stdDeviation", String(figmaPx(21.66, fontSize) / 2));
      var innerOff = svg.querySelector(".inner-offset");
      if (innerOff) {
        innerOff.setAttribute("dx", String(figmaPx(1.55, fontSize)));
        innerOff.setAttribute("dy", String(figmaPx(1.55, fontSize)));
      }
      var innerBlur = svg.querySelector(".inner-blur");
      if (innerBlur) innerBlur.setAttribute("stdDeviation", String(figmaPx(15.47, fontSize) / 2));
      var shift = "translate(" + x0 + " 0)";
      svg.querySelectorAll(".glyph").forEach(function (node) {
        node.setAttribute("d", d);
        node.setAttribute("transform", shift);
      });
      var rings = flattenPath(d, 0.45);
      function putRings(selector, dist, rad) {
        var pathD = dist <= 0.2 ? d : ringsToD(expandRings(rings, dist, Math.max(0, rad)));
        svg.querySelectorAll(selector).forEach(function (node) {
          if (node.classList.contains("glyph")) return;
          node.setAttribute("d", pathD || "");
          node.setAttribute("transform", shift);
        });
      }
      putRings(".expand-fill", offsetD, roundR);
      putRings(".expand-outer", offsetD + edgeW / 2, roundR + edgeW / 2);
      putRings(".expand-inner", Math.max(0, offsetD - edgeW / 2), Math.max(0, roundR - edgeW / 2));
      svg.querySelectorAll(".plate").forEach(function (node) {
        node.setAttribute("x", String(-pad));
        node.setAttribute("y", String(-pad));
        node.setAttribute("width", String(width + pad * 2));
        node.setAttribute("height", String(height + pad * 2));
      });
      if (el._chromeGen === gen) el._chromeKey = key;
    });
    function finish() {
      if (el._chromeGen !== gen) return;
      el._chromeBusy = false;
      var next = el._chromeQueued;
      el._chromeQueued = null;
      if (next) return paint(el, next);
    }
    el._chromeReady = job.then(finish, finish);
    return el._chromeReady;
  }

  function clear(el) {
    if (!el) return;
    el._chromeGen = (el._chromeGen || 0) + 1;
    el._chromeKey = "";
    el._chromeBusy = false;
    el._chromeQueued = null;
    el._chromeReady = Promise.resolve();
    el.classList.remove("is-chrome", "is-chrome-inline");
    var svg = el.querySelector("svg.chrome");
    if (svg) svg.remove();
  }

  function ready(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll(".is-chrome");
    return Promise.all(Array.prototype.map.call(nodes, function (node) {
      return node._chromeReady || Promise.resolve();
    }));
  }

  global.ChromeEffect = { paint: paint, clear: clear, ready: ready };
})(typeof window !== "undefined" ? window : this);
