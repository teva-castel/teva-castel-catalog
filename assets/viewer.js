/* Flipbook viewer — reads window.FLIPBOOK (flipbook-data.js), uses StPageFlip (MIT). */
(function () {
  "use strict";
  var D = window.FLIPBOOK;
  var $ = function (id) { return document.getElementById(id); };
  var RTL = D.dir !== "ltr";
  var N = D.pages.length;

  var I18N = {
    he: {
      loading: "טוען קבצים", pages: "דפים:", search: "חיפוש", toc: "תוכן העניינים", thumbs: "תמונות ממוזערות",
      share: "שתף", fullscreen: "מסך מלא", zoom: "הגדל תצוגה", zoomIn: "הגדל", zoomOut: "הקטן", close: "סגור",
      next: "הדף הבא", prev: "הדף הקודם", first: "דף ראשון", last: "דף אחרון", download: "הורדת PDF",
      copy: "העתק קישור", copied: "הקישור הועתק", searchPlaceholder: "חפש בחוברת…", noResults: "לא נמצאו תוצאות",
      typeMore: "הקלידו לפחות 2 תווים", page: "עמוד", noToc: "אין תוכן עניינים לחוברת זו", results: "תוצאות"
    },
    en: {
      loading: "Loading", pages: "Pages:", search: "Search", toc: "Contents", thumbs: "Thumbnails",
      share: "Share", fullscreen: "Full screen", zoom: "Zoom", zoomIn: "Zoom in", zoomOut: "Zoom out", close: "Close",
      next: "Next page", prev: "Previous page", first: "First page", last: "Last page", download: "Download PDF",
      copy: "Copy link", copied: "Link copied", searchPlaceholder: "Search this booklet…", noResults: "No results",
      typeMore: "Type at least 2 characters", page: "Page", noToc: "No table of contents", results: "results"
    }
  };
  var T = I18N[D.lang] || I18N.he;

  // ---------------------------------------------------------- setup chrome
  document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = T[el.dataset.i18n] || ""; });
  document.querySelectorAll("[data-i18n-title]").forEach(function (el) {
    var t = T[el.dataset.i18nTitle] || ""; el.title = t; el.setAttribute("aria-label", t);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) { el.placeholder = T[el.dataset.i18nPlaceholder] || ""; });

  var root = document.documentElement.style;
  if (D.brand) root.setProperty("--brand", D.brand);
  if (D.accent) root.setProperty("--accent", D.accent);
  else if (D.brand) root.setProperty("--accent", "color-mix(in srgb, " + D.brand + " 12%, #fff)");
  if (D.background) { document.body.classList.add("has-bg"); document.body.style.backgroundImage = "url('" + D.background + "')"; }
  $("bookTitle").textContent = D.title;
  $("pageTotal").textContent = N;
  if (D.logo) {
    var lg = $("logo"); lg.hidden = false; lg.querySelector("img").src = D.logo; lg.querySelector("img").alt = D.title;
    if (D.homeUrl) lg.href = D.homeUrl; else lg.removeAttribute("href");
  }
  if (D.pdf) { var dl = $("btnDownload"); dl.hidden = false; dl.href = D.pdf; }
  if (!D.searchable) $("btnSearch").hidden = true;
  if (!D.toc.length) { $("btnToc").hidden = true; $("btnToc2").hidden = true; }
  if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) $("btnFull").hidden = true;

  // ---------------------------------------------------------- page order
  // StPageFlip is left-to-right only. For RTL we feed the pages reversed and start at the end,
  // so "forward" in the booklet is flipPrev() in the library. 0 = blank filler page.
  var order = D.pages.map(function (p) { return p.n; });
  if (RTL && N > 1 && N % 2 === 1) order.push(0); // keeps the cover single and spreads aligned (2-3, 4-5…)
  if (RTL) order.reverse();
  var TOTAL = order.length;
  var idxOf = function (n) { return order.indexOf(n); };

  function linkEl(l) {
    var a = document.createElement("a");
    a.className = "hot";
    var r = l.r;
    a.style.left = (r[0] * 100) + "%"; a.style.top = (r[1] * 100) + "%";
    a.style.width = ((r[2] - r[0]) * 100) + "%"; a.style.height = ((r[3] - r[1]) * 100) + "%";
    if (l.title) a.title = l.title;
    if (l.url) {
      a.href = l.url;
      if (!/^(mailto:|tel:|#)/i.test(l.url)) { a.target = "_blank"; a.rel = "noopener"; }
      a.addEventListener("click", function () { track("link_click", { url: l.url }); });
    } else if (l.page) {
      a.href = "#p=" + l.page;
      a.addEventListener("click", function (e) { e.preventDefault(); closeZoom(); goTo(l.page); });
    }
    // keep StPageFlip from starting a flip when the user taps a link
    ["mousedown", "touchstart", "pointerdown"].forEach(function (ev) {
      a.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true });
    });
    return a;
  }

  function pageEl(n, zoom) {
    var d = document.createElement("div");
    d.className = "page";
    d.dataset.density = "soft";
    if (!n) { d.classList.add("blank"); return d; }
    var p = D.pages[n - 1];
    var inner = document.createElement("div");
    inner.className = "page-inner";
    var img = document.createElement("img");
    img.alt = T.page + " " + n;
    img.draggable = false;
    img.decoding = "async";
    if (zoom) img.src = p.zoom; else img.dataset.src = p.img; // book pages load lazily (loadAround)
    inner.appendChild(img);
    p.links.forEach(function (l) { inner.appendChild(linkEl(l)); });
    d.appendChild(inner);
    return d;
  }

  // ---------------------------------------------------------- book
  var book = $("book");
  order.forEach(function (n) { book.appendChild(pageEl(n, false)); });

  var first = D.pages[0];
  var baseW = 600, baseH = Math.round(baseW * first.h / first.w);
  var startN = parseHash() || D.startPage || 1;

  // Load only the pages around the ones on screen, so a visitor who reads 3 spreads
  // doesn't download the whole booklet (saves hosting bandwidth and mobile data).
  var pageImgs = {};
  book.querySelectorAll(".page img").forEach(function (im) { var m = /p(\d+)\./.exec(im.dataset.src); if (m) pageImgs[+m[1]] = im; });
  function loadAround(v) {
    var lo = Math.max(1, v[0] - 4), hi = Math.min(N, v[v.length - 1] + 4);
    for (var n = lo; n <= hi; n++) { var im = pageImgs[n]; if (im && !im.src) im.src = im.dataset.src; }
  }
  loadAround([startN]);

  // Decide one page vs. two-page spread from the space we have: a spread is used only when its
  // pages would be at least 70% of the height a single page would get (phones/portrait tablets -> single).
  var wrap = $("bookWrap");
  function minWidthFor() {
    var W = wrap.clientWidth || window.innerWidth, H = wrap.clientHeight || window.innerHeight, r = first.w / first.h;
    var spreadH = Math.min(H, W / (2 * r)), singleH = Math.min(H, W / r);
    return spreadH >= 0.7 * singleH ? 1 : Math.ceil(W / 2) + 1;
  }
  var pf = new St.PageFlip(book, {
    width: baseW, height: baseH, size: "stretch",
    minWidth: minWidthFor(), maxWidth: 3000, minHeight: 200, maxHeight: 4000,
    showCover: true, usePortrait: true, autoSize: true,
    maxShadowOpacity: 0.45, flippingTime: 750, drawShadow: true,
    mobileScrollSupport: false, clickEventForward: true, showPageCorners: true,
    startPage: Math.max(0, idxOf(startN))
  });
  pf.loadFromHTML(book.querySelectorAll(".page"));

  function visible() {
    var i = pf.getCurrentPageIndex();
    var ids;
    if (pf.getOrientation() === "portrait") ids = [i];
    else if (i === 0) ids = [0];
    else { var s = i % 2 === 1 ? i : i - 1; ids = [s, s + 1]; }
    return ids.filter(function (k) { return k >= 0 && k < TOTAL; })
      .map(function (k) { return order[k]; }).filter(Boolean).sort(function (a, b) { return a - b; });
  }

  function goTo(n) {
    n = Math.max(1, Math.min(N, parseInt(n, 10) || 1));
    if (visible().indexOf(n) >= 0) return;
    var cur = visible()[0] || 1;
    var target = idxOf(n);
    if (Math.abs(n - cur) <= 2) pf.flip(target); else pf.turnToPage(target);
    setTimeout(update, Math.abs(n - cur) <= 2 ? 800 : 30);
  }
  var fwd = function () { RTL ? pf.flipPrev() : pf.flipNext(); };
  var back = function () { RTL ? pf.flipNext() : pf.flipPrev(); };

  function update() {
    var v = visible();
    if (!v.length) return;
    loadAround(v);
    centerSingle();
    var label = v.length > 1 ? v[0] + "-" + v[v.length - 1] : String(v[0]);
    var inp = $("pageInput");
    if (document.activeElement !== inp) inp.value = label;
    $("navBack").disabled = $("navFirst").disabled = v[0] <= 1;
    $("navFwd").disabled = $("navLast").disabled = v[v.length - 1] >= N;
    try { history.replaceState(null, "", "#p=" + v[0]); } catch (e) { /* file:// in some browsers */ }
    markCurrent(v);
    track("page_view_flipbook", { page: label });
  }
  // In a two-page layout a lone page (front/back cover) sits in one half of the book —
  // slide the book so that page is centred, like a closed booklet on a table.
  function centerSingle() {
    var shift = 0;
    if (pf.getOrientation() === "landscape" && visible().length === 1) {
      var i = pf.getCurrentPageIndex();
      shift = (i === 0) ? -25 : 25;   // index 0 shows in the right half, the last index in the left half
    }
    book.style.transform = shift ? "translateX(" + shift + "%)" : "";
  }
  pf.on("flip", update);
  pf.on("changeState", function (e) { if (e.data === "flipping" || e.data === "user_fold") book.style.transform = ""; });
  pf.on("changeOrientation", function () { setTimeout(update, 50); });
  pf.on("init", update);
  setTimeout(update, 60);

  function parseHash() {
    var m = /(?:^#|&)p=(\d+)/.exec(location.hash);
    return m ? Math.max(1, Math.min(N, parseInt(m[1], 10))) : 0;
  }
  window.addEventListener("hashchange", function () { var h = parseHash(); if (h) goTo(h); });

  // loader: wait for the start pages to decode
  (function () {
    var imgs = Array.prototype.slice.call(book.querySelectorAll("img")).filter(function (im) {
      var m = /p(\d+)\./.exec(im.dataset.src || ""); var n = m && +m[1]; return im.src && n && Math.abs(n - startN) <= 2;
    });
    var done = false;
    var finish = function () { if (done) return; done = true; $("loader").classList.add("done"); setTimeout(function () { $("loader").hidden = true; }, 450); update(); };
    Promise.all(imgs.map(function (im) { return im.decode ? im.decode().catch(function () {}) : Promise.resolve(); })).then(finish);
    setTimeout(finish, 6000);
  })();

  // ---------------------------------------------------------- navigation controls
  $("navFwd").onclick = fwd;
  $("navBack").onclick = back;
  $("navFirst").onclick = function () { goTo(1); };
  $("navLast").onclick = function () { goTo(N); };
  var pi = $("pageInput");
  pi.addEventListener("focus", function () { pi.select(); });
  pi.addEventListener("keydown", function (e) { if (e.key === "Enter") { goTo(pi.value.split("-")[0]); pi.blur(); } });
  pi.addEventListener("blur", update);

  document.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT") { if (e.key === "Escape") e.target.blur(); return; }
    if (!$("zoom").hidden) {
      if (e.key === "Escape") closeZoom();
      if (e.key === "+" || e.key === "=") setZoom(zoomLevel + 1);
      if (e.key === "-") setZoom(zoomLevel - 1);
      return;
    }
    switch (e.key) {
      case "ArrowLeft": RTL ? fwd() : back(); break;
      case "ArrowRight": RTL ? back() : fwd(); break;
      case "PageDown": case " ": fwd(); e.preventDefault(); break;
      case "PageUp": back(); break;
      case "Home": goTo(1); break;
      case "End": goTo(N); break;
      case "Escape": closePanel(); $("sharePop").hidden = true; break;
    }
  });

  // ---------------------------------------------------------- side panel (toc / thumbs / search)
  var panelMode = null;
  function openPanel(mode) {
    if (panelMode === mode) return closePanel();
    panelMode = mode;
    document.body.classList.add("panel-open");
    $("panel").setAttribute("aria-hidden", "false");
    $("panelTitle").textContent = T[mode];
    $("panelSearch").hidden = mode !== "search";
    ["btnToc", "btnToc2", "btnThumbs", "btnSearch"].forEach(function (id) { $(id).classList.remove("active"); });
    ({ toc: ["btnToc", "btnToc2"], thumbs: ["btnThumbs"], search: ["btnSearch"] })[mode].forEach(function (id) { $(id).classList.add("active"); });
    if (mode === "toc") renderToc();
    if (mode === "thumbs") renderThumbs();
    if (mode === "search") { renderSearch(); setTimeout(function () { $("searchInput").focus(); }, 260); }
    setTimeout(resizeBook, 280);
  }
  function closePanel() {
    if (!panelMode) return;
    panelMode = null;
    document.body.classList.remove("panel-open");
    $("panel").setAttribute("aria-hidden", "true");
    ["btnToc", "btnToc2", "btnThumbs", "btnSearch"].forEach(function (id) { $(id).classList.remove("active"); });
    setTimeout(resizeBook, 280);
  }
  function resizeBook() {
    try { pf.getSettings().minWidth = minWidthFor(); pf.update(); } catch (e) {}
    setTimeout(update, 50);
  }
  var rz;
  window.addEventListener("resize", function () { clearTimeout(rz); rz = setTimeout(resizeBook, 120); });
  $("panelClose").onclick = closePanel;
  $("btnToc").onclick = $("btnToc2").onclick = function () { openPanel("toc"); };
  $("btnThumbs").onclick = function () { openPanel("thumbs"); };
  $("btnSearch").onclick = function () { openPanel("search"); };
  var isNarrow = function () { return window.matchMedia("(max-width: 760px)").matches; };
  var pick = function (n) { goTo(n); if (isNarrow()) closePanel(); };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function renderToc() {
    var body = $("panelBody"); body.innerHTML = "";
    if (!D.toc.length) { body.appendChild(el("div", "empty", T.noToc)); return; }
    D.toc.forEach(function (t, k) {
      var b = el("button", "toc-item");
      b.dataset.page = t.page;
      b.dataset.end = (D.toc[k + 1] ? D.toc[k + 1].page - 1 : N);
      b.appendChild(el("span", "", t.title));
      b.appendChild(el("span", "pg", t.page));
      b.onclick = function () { pick(t.page); };
      body.appendChild(b);
    });
    markCurrent(visible());
  }
  function renderThumbs() {
    var body = $("panelBody"); body.innerHTML = "";
    var g = el("div", "thumbs");
    D.pages.forEach(function (p) {
      var b = el("button", "thumb"); b.dataset.page = p.n;
      var im = new Image(); im.loading = "lazy"; im.src = p.thumb; im.alt = "";
      b.appendChild(im); b.appendChild(el("div", "", p.n));
      b.onclick = function () { pick(p.n); };
      g.appendChild(b);
    });
    body.appendChild(g);
    markCurrent(visible(), true);
  }
  function markCurrent(v, scroll) {
    if (!panelMode || !v.length) return;
    var lo = v[0], hi = v[v.length - 1];
    document.querySelectorAll(".toc-item").forEach(function (b) {
      var on = +b.dataset.page <= hi && +b.dataset.end >= lo; b.classList.toggle("current", on);
    });
    var cur = null;
    document.querySelectorAll(".thumb").forEach(function (b) {
      var on = +b.dataset.page >= lo && +b.dataset.page <= hi; b.classList.toggle("current", on); if (on && !cur) cur = b;
    });
    if (scroll && cur) cur.scrollIntoView({ block: "center" });
  }

  // search: tolerant to niqqud, case, extra spaces and to visually-reversed Hebrew text in some PDFs
  function norm(s) { return s.toLowerCase().replace(/[֑-ׇ]/g, "").replace(/[״"׳']/g, "").replace(/\s+/g, " "); }
  var normPages = D.pages.map(function (p) { return norm(p.text || ""); });
  function renderSearch() {
    var q = norm($("searchInput").value.trim());
    var body = $("panelBody"); body.innerHTML = "";
    if (q.length < 2) { body.appendChild(el("div", "empty", T.typeMore)); return; }
    var qr = q.split("").reverse().join("");
    var count = 0;
    normPages.forEach(function (txt, k) {
      var pos = txt.indexOf(q), len = q.length;
      if (pos < 0 && /[א-ת]/.test(q)) { pos = txt.indexOf(qr); }
      if (pos < 0) return;
      count++;
      var b = el("button", "hit");
      b.appendChild(el("span", "pg", T.page + " " + (k + 1)));
      var s = Math.max(0, pos - 40), e = Math.min(txt.length, pos + len + 60);
      var snip = el("span", "snip");
      snip.appendChild(document.createTextNode((s > 0 ? "…" : "") + txt.slice(s, pos)));
      snip.appendChild(el("mark", "", txt.slice(pos, pos + len)));
      snip.appendChild(document.createTextNode(txt.slice(pos + len, e) + (e < txt.length ? "…" : "")));
      b.appendChild(snip);
      b.onclick = function () { pick(k + 1); };
      body.appendChild(b);
    });
    if (!count) body.appendChild(el("div", "empty", T.noResults));
    track("search", { search_term: q });
  }
  var st;
  $("searchInput").addEventListener("input", function () { clearTimeout(st); st = setTimeout(renderSearch, 180); });

  // ---------------------------------------------------------- zoom
  var ZOOMS = [1, 1.5, 2, 3], zoomLevel = 0, zoomPages = [];
  function openZoom() {
    zoomPages = visible();
    var inner = $("zoomInner"); inner.innerHTML = "";
    zoomPages.forEach(function (n) { inner.appendChild(pageEl(n, true)); });
    $("zoom").hidden = false;
    setZoom(isNarrow() ? 0 : 1);
    track("zoom", {});
  }
  function setZoom(level) {
    zoomLevel = Math.max(0, Math.min(ZOOMS.length - 1, level));
    var sc = $("zoomScroll");
    var cx = (sc.scrollLeft + sc.clientWidth / 2) / (sc.scrollWidth || 1), cy = (sc.scrollTop + sc.clientHeight / 2) / (sc.scrollHeight || 1);
    var availH = window.innerHeight - 48, availW = window.innerWidth - 48;
    var p = D.pages[(zoomPages[0] || 1) - 1];
    var ratio = p.w / p.h;
    var fitH = Math.min(availH, availW / (ratio * zoomPages.length));
    var h = fitH * ZOOMS[zoomLevel];
    $("zoomInner").querySelectorAll(".page").forEach(function (pg) { pg.style.height = h + "px"; pg.style.width = (h * ratio) + "px"; });
    requestAnimationFrame(function () {
      sc.scrollLeft = cx * sc.scrollWidth - sc.clientWidth / 2;
      sc.scrollTop = cy * sc.scrollHeight - sc.clientHeight / 2;
    });
    $("zoomOut").disabled = zoomLevel === 0; $("zoomIn").disabled = zoomLevel === ZOOMS.length - 1;
  }
  function closeZoom() { $("zoom").hidden = true; $("zoomInner").innerHTML = ""; }
  $("btnZoom").onclick = openZoom;
  $("zoomIn").onclick = function () { setZoom(zoomLevel + 1); };
  $("zoomOut").onclick = function () { setZoom(zoomLevel - 1); };
  $("zoomClose").onclick = closeZoom;
  book.addEventListener("dblclick", function (e) { if (!e.target.closest(".hot")) openZoom(); });
  // drag-to-pan with the mouse
  (function () {
    var sc = $("zoomScroll"), sx, sy, sl, stp, down = false, moved = false;
    sc.addEventListener("mousedown", function (e) { if (e.target.closest(".hot")) return; down = true; moved = false; sx = e.clientX; sy = e.clientY; sl = sc.scrollLeft; stp = sc.scrollTop; sc.classList.add("dragging"); e.preventDefault(); });
    window.addEventListener("mousemove", function (e) { if (!down) return; moved = true; sc.scrollLeft = sl - (e.clientX - sx); sc.scrollTop = stp - (e.clientY - sy); });
    window.addEventListener("mouseup", function () { down = false; sc.classList.remove("dragging"); });
    sc.addEventListener("dblclick", function () { if (!moved) setZoom(zoomLevel === ZOOMS.length - 1 ? 0 : zoomLevel + 1); });
  })();

  // ---------------------------------------------------------- fullscreen
  $("btnFull").onclick = function () {
    var d = document, de = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else (de.requestFullscreen || de.webkitRequestFullscreen).call(de);
  };
  document.addEventListener("fullscreenchange", function () { setTimeout(resizeBook, 150); });

  // ---------------------------------------------------------- share
  function shareUrl() { var v = visible(); return location.href.split("#")[0] + (v[0] > 1 ? "#p=" + v[0] : ""); }
  $("btnShare").onclick = function (e) {
    e.stopPropagation();
    var url = shareUrl();
    if (navigator.share && isNarrow()) {
      navigator.share({ title: D.title, url: url }).catch(function () {});
      track("share", { method: "native" });
      return;
    }
    var pop = $("sharePop");
    var enc = encodeURIComponent(url), t = encodeURIComponent(D.title);
    $("shareWa").href = "https://wa.me/?text=" + t + "%20" + enc;
    $("shareFb").href = "https://www.facebook.com/sharer/sharer.php?u=" + enc;
    $("shareMail").href = "mailto:?subject=" + t + "&body=" + enc;
    pop.hidden = !pop.hidden;
  };
  document.addEventListener("click", function (e) { if (!e.target.closest("#sharePop")) $("sharePop").hidden = true; });
  $("shareCopy").onclick = function () {
    var url = shareUrl();
    var ok = function () { toast(T.copied); $("sharePop").hidden = true; };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(ok, function () { prompt("", url); });
    else { prompt("", url); }
  };
  ["shareWa", "shareFb", "shareMail"].forEach(function (id) { $(id).addEventListener("click", function () { track("share", { method: id }); }); });

  var tt;
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(function () { t.hidden = true; }, 2000); }

  function track(name, params) { try { if (window.gtag) window.gtag("event", name, params); } catch (e) {} }

  // hint where the clickable areas are, once, on first link-bearing page
  var hinted = false;
  pf.on("flip", function () {
    if (hinted) return;
    var v = visible();
    if (v.some(function (n) { return D.pages[n - 1].links.length; })) {
      hinted = true; book.classList.add("flash-links"); setTimeout(function () { book.classList.remove("flash-links"); }, 1800);
    }
  });
})();
