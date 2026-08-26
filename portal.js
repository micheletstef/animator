(function () {
  var LAST_KEY = "animator:portal:last";
  var COLLAPSE_KEY = "animator:portal:collapsed";
  var DIR_KEY = "animator:portal:directory";
  var root = document.body.getAttribute("data-portal-root") || "";
  var defaultVersion = document.body.getAttribute("data-default-version") || "v1";
  if (defaultVersion !== "v1" && defaultVersion !== "v2") defaultVersion = "v1";

  var editorLink = document.getElementById("editorLink");
  if (editorLink) editorLink.setAttribute("href", root + "index.html");

  var VERSIONS = {
    v1: {
      key: "v1",
      label: "version 1",
      manifest: root + "animations/animations.json",
      list: document.getElementById("v1List"),
      toggle: document.getElementById("v1Toggle"),
      prefix: root,
      items: [],
    },
    v2: {
      key: "v2",
      label: "version 2",
      manifest: root + "version-2/animations/animations.json",
      list: document.getElementById("v2List"),
      toggle: document.getElementById("v2Toggle"),
      prefix: root + "version-2/",
      items: [],
    },
  };

  var frame = document.getElementById("frame");
  var viewer = document.getElementById("viewer");
  var viewerHint = document.getElementById("viewerHint");
  var collapsed = { v1: true, v2: true };
  var directory = { v1: null, v2: null };
  var current = null;
  var listsReady = false;
  var drag = { id: null, key: null, moved: false };
  var suppressClick = false;
  var renameCloser = null;

  function slugify(stem) {
    return (
      String(stem)
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "animation"
    );
  }

  function humanise(stem) {
    return String(stem).replace(/[-_]+/g, " ").trim();
  }

  function resolveUrl(version, url) {
    var u = String(url || "");
    if (!u) return u;
    if (/^[a-z]+:|^\/\//i.test(u) || u.charAt(0) === "/") return u;
    if (u.charAt(0) === ".") return u;
    if (version.prefix && u.indexOf(version.prefix) === 0) return u;
    return version.prefix + u.replace(/^\.\//, "");
  }

  function readCollapsed() {
    try {
      var raw = localStorage.getItem(COLLAPSE_KEY);
      if (!raw) return;
      var obj = JSON.parse(raw);
      if (obj && typeof obj === "object") {
        if (typeof obj.v1 === "boolean") collapsed.v1 = obj.v1;
        if (typeof obj.v2 === "boolean") collapsed.v2 = obj.v2;
      }
    } catch (e) {}
  }

  function writeCollapsed() {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed));
    } catch (e) {}
  }

  function readDirectory() {
    try {
      var raw = localStorage.getItem(DIR_KEY);
      if (!raw) return;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return;
      if (obj.v1) directory.v1 = obj.v1;
      if (obj.v2) directory.v2 = obj.v2;
    } catch (e) {}
  }

  function packDirectory(version) {
    var order = [];
    var labels = {};
    for (var i = 0; i < version.items.length; i++) {
      var a = version.items[i];
      order.push(a.id);
      if (a.label !== a.originalLabel) labels[a.id] = a.label;
    }
    return { order: order, labels: labels };
  }

  function writeDirectory() {
    directory.v1 = packDirectory(VERSIONS.v1);
    directory.v2 = packDirectory(VERSIONS.v2);
    try {
      localStorage.setItem(DIR_KEY, JSON.stringify(directory));
    } catch (e) {}
  }

  function applyDirectory(version) {
    var saved = directory[version.key];
    if (!saved) return;
    var byId = {};
    for (var i = 0; i < version.items.length; i++) {
      byId[version.items[i].id] = version.items[i];
    }
    var labels = saved.labels || {};
    Object.keys(labels).forEach(function (id) {
      if (byId[id] && labels[id]) byId[id].label = String(labels[id]);
    });
    var order = saved.order || [];
    if (!order.length) return;
    var next = [];
    var seen = {};
    for (var j = 0; j < order.length; j++) {
      var id = order[j];
      if (byId[id] && !seen[id]) {
        next.push(byId[id]);
        seen[id] = true;
      }
    }
    for (var k = 0; k < version.items.length; k++) {
      if (!seen[version.items[k].id]) next.push(version.items[k]);
    }
    version.items = next;
  }

  function setCollapsed(key, isCollapsed) {
    var version = VERSIONS[key];
    if (!version) return;
    collapsed[key] = !!isCollapsed;
    version.list.hidden = collapsed[key];
    version.toggle.textContent = collapsed[key] ? "+" : "-";
    version.toggle.setAttribute("aria-expanded", String(!collapsed[key]));
    version.toggle.setAttribute(
      "aria-label",
      (collapsed[key] ? "expand " : "collapse ") + version.label
    );
    writeCollapsed();
  }

  function loadManifest(version) {
    return fetch(version.manifest + (version.manifest.indexOf("?") >= 0 ? "&" : "?") + "v=19", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("manifest " + r.status);
        return r.json();
      })
      .then(function (data) {
        var list = (data && data.animations) || [];
        version.items = list.map(function (a) {
          var label = a.label || humanise(a.id || "");
          return {
            id: a.id || slugify(a.url || a.label || ""),
            label: label,
            originalLabel: label,
            url: resolveUrl(version, a.url),
            mtime: a.mtime != null ? a.mtime : null,
          };
        });
        applyDirectory(version);
      })
      .catch(function () {
        version.items = [];
      });
  }

  function iframeSrc(anim) {
    var u = anim && anim.url ? String(anim.url) : "";
    if (!u) return "about:blank";
    if (anim.mtime == null) return u;
    return u + (u.indexOf("?") >= 0 ? "&" : "?") + "v=" + anim.mtime;
  }

  function findAnim(versionKey, id) {
    var version = VERSIONS[versionKey];
    if (!version) return null;
    for (var i = 0; i < version.items.length; i++) {
      if (version.items[i].id === id) return version.items[i];
    }
    return null;
  }

  function lookupBareId(id) {
    if (findAnim(defaultVersion, id)) return { version: defaultVersion, id: id };
    var other = defaultVersion === "v2" ? "v1" : "v2";
    if (findAnim(other, id)) return { version: other, id: id };
    return null;
  }

  function parseHash() {
    var h = (window.location.hash || "").replace(/^#/, "").trim();
    if (!h) return null;
    var m = h.match(/^(v[12])\/(.+)$/);
    if (m) return { version: m[1], id: decodeURIComponent(m[2]) };
    try {
      return lookupBareId(decodeURIComponent(h));
    } catch (e) {
      return lookupBareId(h);
    }
  }

  function itemEl(list, id) {
    var nodes = list.querySelectorAll("li[data-id]");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute("data-id") === id) return nodes[i];
    }
    return null;
  }

  function makeLink(version, anim, isActive) {
    var link = document.createElement("a");
    link.href = "#" + version.key + "/" + encodeURIComponent(anim.id);
    link.className = "saved-billboard-button";
    link.draggable = false;
    link.textContent = anim.label;
    if (isActive) {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
    }
    return link;
  }

  function activeIdFor(version) {
    return current && current.version === version.key ? current.id : null;
  }

  function setActiveClass(active) {
    ["v1", "v2"].forEach(function (key) {
      var links = VERSIONS[key].list.querySelectorAll(".saved-billboard-button");
      for (var i = 0; i < links.length; i++) {
        var li = links[i].closest("li");
        var on =
          active &&
          li &&
          active.version === key &&
          li.getAttribute("data-id") === active.id;
        links[i].classList.toggle("is-active", !!on);
        if (on) links[i].setAttribute("aria-current", "page");
        else links[i].removeAttribute("aria-current");
      }
    });
  }

  function renderList(version, activeId) {
    version.list.innerHTML = "";
    if (!version.items.length) {
      var empty = document.createElement("li");
      empty.className = "saved-billboards-empty";
      empty.textContent = "no animations found";
      version.list.appendChild(empty);
      return;
    }
    version.items.forEach(function (a) {
      var li = document.createElement("li");
      li.setAttribute("data-id", a.id);
      li.draggable = true;
      li.appendChild(makeLink(version, a, a.id === activeId));
      version.list.appendChild(li);
    });
  }

  function render(active) {
    renderList(VERSIONS.v1, active && active.version === "v1" ? active.id : null);
    renderList(VERSIONS.v2, active && active.version === "v2" ? active.id : null);
  }

  function showHint() {
    viewer.classList.remove("has-frame");
    if (viewerHint) viewerHint.hidden = false;
    frame.src = "about:blank";
    frame.removeAttribute("data-current");
    document.title = "animator";
  }

  function load(versionKey, id, opts) {
    var anim = findAnim(versionKey, id);
    var forceOpen = opts && opts.forceOpen;
    if (!anim) {
      current = null;
      if (!listsReady) {
        render(null);
        listsReady = true;
      } else {
        setActiveClass(null);
      }
      showHint();
      return;
    }
    current = { version: versionKey, id: anim.id };
    var src = iframeSrc(anim);
    if (frame.getAttribute("data-current") !== src) {
      frame.src = src;
      frame.setAttribute("data-current", src);
    }
    viewer.classList.add("has-frame");
    if (viewerHint) viewerHint.hidden = true;
    if (!listsReady) {
      render(current);
      listsReady = true;
    } else {
      setActiveClass(current);
    }
    document.title = "animator — " + anim.label;
    if (forceOpen) setCollapsed(versionKey, false);
    try {
      localStorage.setItem(
        LAST_KEY,
        JSON.stringify({ version: versionKey, id: anim.id })
      );
    } catch (e) {}
  }

  function readLast() {
    try {
      var raw = localStorage.getItem(LAST_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (obj && (obj.version === "v1" || obj.version === "v2") && obj.id) {
        return obj;
      }
    } catch (e) {}
    return null;
  }

  function initial() {
    var fromHash = parseHash();
    if (fromHash && findAnim(fromHash.version, fromHash.id)) return fromHash;
    var saved = readLast();
    if (saved && findAnim(saved.version, saved.id)) return saved;
    return null;
  }

  function commitOrder(version) {
    var nodes = version.list.querySelectorAll("li[data-id]");
    var byId = {};
    for (var i = 0; i < version.items.length; i++) {
      byId[version.items[i].id] = version.items[i];
    }
    var next = [];
    for (var j = 0; j < nodes.length; j++) {
      var item = byId[nodes[j].getAttribute("data-id")];
      if (item) next.push(item);
    }
    var changed = next.length !== version.items.length;
    if (!changed) {
      for (var k = 0; k < next.length; k++) {
        if (next[k] !== version.items[k]) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;
    version.items = next;
    writeDirectory();
  }

  function startRename(version, li) {
    if (!li || li.querySelector(".saved-billboard-rename")) return;
    var id = li.getAttribute("data-id");
    var anim = findAnim(version.key, id);
    if (!anim) return;
    if (renameCloser) renameCloser(true);
    var link = li.querySelector("a");
    if (!link) return;
    var input = document.createElement("input");
    input.type = "text";
    input.className = "saved-billboard-rename";
    input.value = anim.label;
    input.setAttribute("aria-label", "rename " + anim.label);
    li.draggable = false;
    li.replaceChild(input, link);
    input.focus();
    input.select();

    var done = false;
    function finish(save) {
      if (done) return;
      done = true;
      if (renameCloser === finish) renameCloser = null;
      if (save) {
        var next = String(input.value || "").replace(/\s+/g, " ").trim();
        if (next) anim.label = next;
      }
      writeDirectory();
      var active = activeIdFor(version) === anim.id;
      if (input.parentNode === li) {
        li.replaceChild(makeLink(version, anim, active), input);
      }
      li.draggable = true;
      if (active) document.title = "animator — " + anim.label;
    }

    renameCloser = finish;
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", function () {
      finish(true);
    });
    input.addEventListener("click", function (e) {
      e.stopPropagation();
    });
  }

  function bindList(key) {
    var version = VERSIONS[key];
    var list = version.list;
    if (!list) return;

    list.addEventListener("dragstart", function (e) {
      var li = e.target.closest("li");
      if (!li || !li.getAttribute("data-id") || li.querySelector(".saved-billboard-rename")) {
        e.preventDefault();
        return;
      }
      drag.id = li.getAttribute("data-id");
      drag.key = key;
      drag.moved = false;
      li.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", drag.id);
    });

    list.addEventListener("dragover", function (e) {
      if (drag.key !== key || !drag.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      var dragged = itemEl(list, drag.id);
      if (!dragged) return;
      var over = e.target.closest("li");
      if (!over || !over.getAttribute("data-id") || over === dragged) return;
      var rect = over.getBoundingClientRect();
      var before = e.clientY < rect.top + rect.height / 2;
      if (before) {
        if (over.previousSibling !== dragged) {
          list.insertBefore(dragged, over);
          drag.moved = true;
        }
      } else if (over.nextSibling !== dragged) {
        list.insertBefore(dragged, over.nextSibling);
        drag.moved = true;
      }
    });

    list.addEventListener("drop", function (e) {
      if (drag.key !== key) return;
      e.preventDefault();
      commitOrder(version);
    });

    list.addEventListener("dragend", function () {
      var dragged = drag.id ? itemEl(list, drag.id) : null;
      if (dragged) dragged.classList.remove("is-dragging");
      if (drag.key === key) commitOrder(version);
      if (drag.moved) {
        suppressClick = true;
        setTimeout(function () {
          suppressClick = false;
        }, 100);
      }
      drag.id = null;
      drag.key = null;
      drag.moved = false;
    });

    list.addEventListener(
      "click",
      function (e) {
        if (!suppressClick) return;
        e.preventDefault();
        e.stopPropagation();
        suppressClick = false;
      },
      true
    );

    list.addEventListener("dblclick", function (e) {
      var li = e.target.closest("li");
      if (!li || !li.getAttribute("data-id")) return;
      if (e.target.closest(".saved-billboard-rename")) return;
      e.preventDefault();
      startRename(version, li);
    });
  }

  function bindAccordion(key) {
    var version = VERSIONS[key];
    var row = version.toggle && version.toggle.closest(".assets-section-title-row");
    if (!row) return;
    row.addEventListener("click", function (e) {
      e.preventDefault();
      setCollapsed(key, !collapsed[key]);
    });
  }
  bindAccordion("v1");
  bindAccordion("v2");
  bindList("v1");
  bindList("v2");

  window.addEventListener("hashchange", function () {
    var parsed = parseHash();
    if (parsed && findAnim(parsed.version, parsed.id)) {
      load(parsed.version, parsed.id, { forceOpen: true });
    }
  });

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "textarea" || tag === "select") return true;
    if (tag === "input") return true;
    return !!el.isContentEditable;
  }

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || e.repeat) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== "g" && e.key !== "G") return;
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
    try {
      var win = frame && frame.contentWindow;
      if (!win || !win.ArtboardView || typeof win.ArtboardView.toggleGuides !== "function") {
        return;
      }
      e.preventDefault();
      win.ArtboardView.toggleGuides();
    } catch (err) {}
  });

  readCollapsed();
  readDirectory();
  Promise.all([loadManifest(VERSIONS.v1), loadManifest(VERSIONS.v2)]).then(
    function () {
      setCollapsed("v1", collapsed.v1);
      setCollapsed("v2", collapsed.v2);
      var start = initial();
      if (start) {
        if (!parseHash()) {
          history.replaceState(
            null,
            "",
            "#" + start.version + "/" + encodeURIComponent(start.id)
          );
        }
        load(start.version, start.id, { forceOpen: true });
      } else {
        render(null);
        listsReady = true;
        showHint();
      }
    }
  );
})();
