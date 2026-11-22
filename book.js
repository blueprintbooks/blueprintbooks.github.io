// Blueprint books: reads its books from a private repository with the visitor's read-only token, in the browser.
// The repository's top-level folders are the books; each holds nav.json (title and menu) and its pages (.md or .html).
// Addresses: #/<book> its first page, #/<book>/<page> a page; #/ opens the book last read in this browser, else
// the first. The top bar holds the book's name (its menu lists every book); #/<book>/<page>#<heading> opens a
// page at a heading (headings get GitHub's ids), and a link #<heading> in a page goes to that heading of the page
// shown. The side menu is the book's contents, as a book's: every section of nav.json with its pages, always whole;
// an entry in a section's pages is a page ({page, title}) or a section of its own ({section, pages}), so a book has
// up to three layers (part, chapter, page); a section of one page named as the page is that page's line alone. A file
// is fetched by its git blob sha and kept in localStorage as bb:<book>:<sha>, so it is downloaded once until it
// changes; keys of a book no longer in its listing are dropped, and sign-out drops them all.
(function () {
  'use strict';
  var API = 'https://api.github.com/repos/';
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) {
      try { localStorage.setItem(k, v); return true; } catch (e) {
        if (k.slice(0, 3) === 'bb:') return false;  // a page not kept: read again next time
        try { clearPages(); localStorage.setItem(k, v); return true; } catch (e2) { return false; }
      }
    },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* nothing kept */ } },
    keys: function () { try { return Object.keys(localStorage); } catch (e) { return []; } }
  };
  var books = null;   // the repository's books, read once per visit (also checks repository and token)
  var listings = {};  // book -> {file name: sha}, read once per visit
  var navs = {};      // book -> nav.json
  var current = 0;    // the route being shown; an older one that finishes late is dropped
  var shown = null;   // the book shown, marked in the books menu (null on an error: none marked)

  function clearPages() { store.keys().forEach(function (k) { if (k.slice(0, 3) === 'bb:') store.del(k); }); }
  function forget() { books = null; listings = {}; navs = {}; shownPage = null; titlesRead = null; titlesDone = false; }
  function show() { document.documentElement.classList.remove('hold'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function href(book, page) { return esc('#/' + encodeURIComponent(book) + (page ? '/' + encodeURIComponent(page) : '')); }

  function SignInError(message) { this.message = message; }

  function api(path, raw) {
    var repo = store.get('bb-repo'), token = store.get('bb-token');
    if (!repo || !token) return Promise.reject(new SignInError(''));
    return fetch(API + repo + path, {
      headers: { Authorization: 'Bearer ' + token, Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json' },
      cache: 'no-store'
    }).catch(function () {
      throw new Error('GitHub could not be reached. Check the connection and reload.');
    }).then(function (r) {
      if (r.status === 401) throw new SignInError('The token was not accepted.');
      if (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0') throw new Error('GitHub\'s rate limit is reached. Try again in a few minutes.');
      if ((r.status === 403 || r.status === 404) && path === '/contents/') throw new SignInError('The repository was not found, or the token cannot read it.');
      if (!r.ok) throw new Error('GitHub answered ' + r.status + '.');
      return raw ? r.text() : r.json();
    });
  }

  function shelfList() {
    if (books) return Promise.resolve(books);
    return api('/contents/').then(function (items) {
      return (books = items.filter(function (it) { return it.type === 'dir'; }).map(function (it) { return it.name; }));
    });
  }

  function listing(book) {
    if (listings[book]) return Promise.resolve(listings[book]);
    return shelfList().then(function (list) {
      if (list.indexOf(book) < 0) throw new Error('There is no book "' + book + '".');
      return api('/contents/' + encodeURIComponent(book));
    }).then(function (items) {
      var map = {}, keep = {}, prefix = 'bb:' + book + ':';
      items.forEach(function (it) { if (it.type === 'file') { map[it.name] = it.sha; keep[prefix + it.sha] = 1; } });
      store.keys().forEach(function (k) { if (k.indexOf(prefix) === 0 && !keep[k]) store.del(k); });
      return (listings[book] = map);
    });
  }

  function blob(book, sha) {
    var key = 'bb:' + book + ':' + sha, kept = store.get(key);
    if (kept !== null) return Promise.resolve(kept);
    return api('/git/blobs/' + sha, true).then(function (text) { store.set(key, text); return text; });
  }

  function nav(book) {
    if (navs[book]) return Promise.resolve(navs[book]);
    return listing(book).then(function (files) {
      if (!files['nav.json']) throw new Error('This book has no menu.');
      return blob(book, files['nav.json']);
    }).then(function (text) { return (navs[book] = JSON.parse(text)); });
  }

  // Everything of a book downloaded quietly once its first page is shown, so the next pages open at once.
  function prefetch(book) {
    var files = listings[book] || {};
    Object.keys(files).reduce(function (p, name) {
      return p.then(function () { return blob(book, files[name]); }).catch(function () { /* fetched when opened */ });
    }, Promise.resolve());
  }

  function signedIn(on) {
    $('signin').hidden = on;
    $('layout').hidden = !on;
    $('signout').hidden = !on;
  }

  function signIn(message) {
    shownPage = null;
    signedIn(false);
    $('menu-toggle').hidden = true;
    $('books').hidden = true;
    $('repo').value = store.get('bb-repo') || '';
    $('signin-error').textContent = message || '';
    $('signin-error').hidden = !message;
    show();
  }

  function fail(id, err) {
    if (id !== current) return;
    shownPage = null;
    if (err instanceof SignInError) return signIn(err.message);
    $('main').innerHTML = '<p class="note">' + esc(err.message || err) + '</p>';
    // No book's contents beside the error; the books menu stays, as the way to a book that opens.
    shown = null;
    $('book-title').textContent = 'Books';
    $('books').hidden = false;
    signedIn(true);
    $('side').hidden = true;
    $('menu-toggle').hidden = true;
    document.title = 'Books';
    show();
  }

  // #/ opens a book: the one last read in this browser, else the first.
  function openDefault(id) {
    return shelfList().then(function (list) {
      if (id !== current) return;
      if (!list.length) throw new Error('There are no books yet.');
      var last = store.get('bb-last');
      location.replace(href(list.indexOf(last) >= 0 ? last : list[0]));
    });
  }

  // The book's name opens a menu of every book, listed by title, the open one on a pale grey row with a thin bar.
  // The titles are kept in the browser (bb-titles) and read again quietly once per visit after the first page is
  // shown, so the menu opens at once with what is kept and changes only if a book was added, renamed or removed.
  var titlesRead = null;  // this visit's reading of the titles, started once
  var titlesDone = false; // and finished
  function keptTitles() { try { return JSON.parse(store.get('bb-titles')) || {}; } catch (e) { return {}; } }
  function menuHtml() {
    var titles = keptTitles(), html = '';
    Object.keys(titles).sort(function (x, y) { return titles[x].localeCompare(titles[y]); }).forEach(function (b) { html += '<a href="' + href(b) + '"' + (b === shown ? ' class="open"' : '') + '>' + esc(titles[b]) + '</a>'; });
    return html || (titlesDone ? '<span>No books yet</span>' : '<span>Reading the books</span>');
  }
  function readTitles() {
    if (titlesRead) return titlesRead;
    return (titlesRead = shelfList().then(function (list) {
      return Promise.all(list.map(function (b) { return nav(b).catch(function () { return null; }); })).then(function (navList) {
        var titles = {};
        list.forEach(function (b, i) { if (navList[i]) titles[b] = navList[i].title; });
        titlesDone = true;
        var text = JSON.stringify(titles);
        if (text !== store.get('bb-titles')) store.set('bb-titles', text);
        if (!$('books-menu').hidden) $('books-menu').innerHTML = menuHtml();
      });
    }).catch(function () { titlesRead = null; }));
  }

  // Headings get the ids GitHub gives them, so links to a section of a page (#a-heading) find it.
  // Duplicates as github-slugger numbers them: a, a-1, a-2, never an id already given.
  function headingIds() {
    var hs = $('main').querySelectorAll('h1, h2, h3, h4, h5, h6'), seen = {};
    hs.forEach(function (h) { if (h.id) seen[h.id] = 1; });
    hs.forEach(function (h) {
      if (h.id) return;
      var base = h.textContent.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-');
      var slug = base, n = 0;
      while (seen[slug]) slug = base + '-' + (++n);
      seen[slug] = 1;
      h.id = slug;
    });
  }

  // A page's own scripts (an HTML page that draws its figure) run once it is in place.
  // An inline classic script runs in its own function, so a page opened again does not redeclare its names; a data
  // block (type application/json, ...) is left as it is.
  function runScripts() {
    $('main').querySelectorAll('script').forEach(function (old) {
      var type = (old.getAttribute('type') || '').trim().toLowerCase();
      if (type && type !== 'module' && !/^(text|application)\/(java|ecma)script$/.test(type)) return;
      var s = document.createElement('script');
      Array.prototype.forEach.call(old.attributes, function (a) { s.setAttribute(a.name, a.value); });
      s.textContent = old.src || type === 'module' ? old.textContent : '(function () {\n' + old.textContent + '\n})();';
      old.replaceWith(s);
    });
  }

  function scrollToHeading(anchor) {
    var main = $('main'), el = null;
    if (anchor) {
      try {
        el = main.querySelector('[id="' + CSS.escape(anchor) + '"]') || main.querySelector('[id="' + CSS.escape(anchor.toLowerCase()) + '"]');
      } catch (e) { el = null; }
    }
    if (el) el.scrollIntoView(); else window.scrollTo(0, 0);
  }

  function closeBooks() { $('books-menu').hidden = true; $('book-title').setAttribute('aria-expanded', 'false'); }

  // The book's contents: each section as a heading with its entries set in under it, a page or a section of its own
  // (as deep as nav.json goes); a section of one page with the page's own title is the page's line alone
  // (Architecture), so a heading never sits over a single line repeating it.
  function contents(book, n) {
    function entries(list) {
      return list.map(function (e) {
        if (!e.section) return '<a href="' + href(book, e.page) + '">' + esc(e.title) + '</a>';
        var inner = entries(e.pages || []);
        if (!inner) return '';
        if (e.pages.length === 1 && !e.pages[0].section && e.pages[0].title === e.section) return '<div class="part">' + inner + '</div>';
        return '<div class="part"><div class="part-name">' + esc(e.section) + '</div><div class="part-pages">' + inner + '</div></div>';
      }).join('');
    }
    return entries(n.sections);
  }

  // Every page of a book in the order of its contents.
  function pagesOf(n) {
    var out = [];
    (function walk(list) { list.forEach(function (e) { if (e.section) walk(e.pages || []); else out.push(e); }); })(n.sections);
    return out;
  }

  var shownPage = null;   // book/page shown, so a link to another heading of it only scrolls
  var shownBy = 0;        // the route that showed it

  function page(id, book, name, anchor) {
    if (shownPage === book + '/' + name && name) { shownBy = id; scrollToHeading(anchor); return Promise.resolve(); }
    return nav(book).then(function (n) {
      var first = pagesOf(n)[0];
      name = name || (first && first.page) || 'index';
      var files = listings[book];
      var file = files[name + '.md'] ? name + '.md' : files[name + '.html'] ? name + '.html' : null;
      if (!file) throw new Error('There is no page "' + name + '" in this book.');
      return blob(book, files[file]).then(function (text) {
        if (id !== current) return;
        $('side').innerHTML = contents(book, n);
        $('main').innerHTML = file.slice(-3) === '.md' ? marked.parse(text) : text;
        headingIds();
        shownPage = book + '/' + name;
        shownBy = id;
        $('book-title').textContent = n.title;
        $('books').hidden = false;
        shown = book;
        store.set('bb-last', book);
        signedIn(true);
        var count = pagesOf(n).length;
        $('side').hidden = count < 2;
        $('menu-toggle').hidden = count < 2;
        if (window.matchMedia('(max-width: 760px)').matches) $('side').classList.add('closed');
        var h1 = $('main').querySelector('h1');
        document.title = h1 && h1.textContent !== n.title ? h1.textContent + ' · ' + n.title : n.title;
        runScripts();   // with the page in view, so a script can measure
        scrollToHeading(anchor);
        show();
        readTitles().then(function () { prefetch(book); });
      });
    });
  }

  function route() {
    var id = ++current, parts, anchor;
    closeBooks();
    if (!store.get('bb-repo') || !store.get('bb-token')) return signIn('');
    try {
      var hash = location.hash.replace(/^#\/?/, ''), at = hash.indexOf('#');
      if (at >= 0) { anchor = decodeURIComponent(hash.slice(at + 1)); hash = hash.slice(0, at); }
      parts = hash.split('/').filter(Boolean).map(decodeURIComponent);
    } catch (e) {
      return fail(id, new Error('This address cannot be read.'));
    }
    (parts.length ? page(id, parts[0], parts[1], anchor) : openDefault(id)).catch(function (err) { fail(id, err); });
  }

  // The side menu's width: dragged by the gap after it, a double click gives the usual width back; kept in the browser.
  function splitter() {
    var side = $('side'), split = $('split'), drag = null;
    function setW(w, save) {
      w = Math.round(Math.max(120, Math.min(600, w)));
      if (w === 240) document.documentElement.style.removeProperty('--side-w');
      else document.documentElement.style.setProperty('--side-w', w + 'px');
      if (save) { if (w === 240) store.del('bb-side-w'); else store.set('bb-side-w', String(w)); }
    }
    var kept = parseFloat(store.get('bb-side-w'));
    if (kept > 0) setW(kept, false);
    split.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      split.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, w: side.getBoundingClientRect().width };
      document.body.classList.add('splitting');
    });
    split.addEventListener('pointermove', function (e) { if (drag) setW(drag.w + e.clientX - drag.x, false); });
    function end() {
      if (!drag) return;
      drag = null;
      document.body.classList.remove('splitting');
      setW(side.getBoundingClientRect().width, true);
    }
    split.addEventListener('pointerup', end);
    split.addEventListener('pointercancel', end);
    split.addEventListener('dblclick', function () { setW(240, true); });
  }

  function start() {
    $('signin').addEventListener('submit', function (e) {
      e.preventDefault();
      store.set('bb-repo', $('repo').value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, ''));
      store.set('bb-token', $('token').value.trim());
      $('token').value = '';
      forget();
      route();
    });
    $('signout').addEventListener('click', function () {
      store.del('bb-token');
      clearPages();
      store.del('bb-titles');
      forget();
      current++;
      signIn('');
    });
    $('book-title').addEventListener('click', function (e) {
      e.stopPropagation();
      var open = $('books-menu').hidden;
      if (open) {
        $('books-menu').innerHTML = menuHtml();
        readTitles();
      }
      $('books-menu').hidden = !open;
      $('book-title').setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('#books-menu')) closeBooks(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeBooks(); });
    splitter();
    $('menu-toggle').addEventListener('click', function () { $('side').classList.toggle('closed'); });
    // A link to a heading of the page shown (#a-heading) scrolls there; the address keeps the page.
    $('main').addEventListener('click', function (e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
      var a = e.target.closest('a'), XLINK = 'http://www.w3.org/1999/xlink';
      var h = a && (a.getAttribute('href') || a.getAttributeNS(XLINK, 'href') || '');
      if (!h || h.charAt(0) !== '#' || h.charAt(1) === '/') return;
      e.preventDefault();
      var anchor;
      try { anchor = decodeURIComponent(h.slice(1)); } catch (err) { anchor = h.slice(1); }
      if (shownPage && shownBy === current) history.replaceState(null, '', '#/' + shownPage.split('/').map(encodeURIComponent).join('/') + '#' + encodeURIComponent(anchor));
      scrollToHeading(anchor);
    });
    $('side').addEventListener('click', function (e) {
      if (e.target.closest('a') && window.matchMedia('(max-width: 760px)').matches) $('side').classList.add('closed');
    });
    window.addEventListener('hashchange', route);
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
