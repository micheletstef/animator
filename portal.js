(function () {
  var LAST_KEY = "animator:portal:last";
  var COLLAPSE_KEY = "animator:portal:collapsed";
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
    return fetch(version.manifest + (version.manifest.indexOf("?") >= 0 ? "&" : "?") + "v=4", { cache: "no-store" })
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
            url: resolveUrl(version, a.url),
            mtime: a.mtime != null ? a.mtime : null,
          };
        });
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
      var link = document.createElement("a");
      link.href = "#" + version.key + "/" + encodeURIComponent(a.id);
      link.className = "saved-billboard-button";
      link.textContent = a.label;
      if (a.id === activeId) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "page");
      }
      li.appendChild(link);
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
      render(null);
      showHint();
      return;
    }
    var src = iframeSrc(anim);
    if (frame.getAttribute("data-current") !== src) {
      frame.src = src;
      frame.setAttribute("data-current", src);
    }
    viewer.classList.add("has-frame");
    if (viewerHint) viewerHint.hidden = true;
    render({ version: versionKey, id: anim.id });
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

  window.addEventListener("hashchange", function () {
    var parsed = parseHash();
    if (parsed && findAnim(parsed.version, parsed.id)) {
      load(parsed.version, parsed.id, { forceOpen: true });
    }
  });

  readCollapsed();
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
        showHint();
      }
    }
  );
})();
