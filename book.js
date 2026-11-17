// Blueprint books: reads its books from a private repository with the visitor's read-only token, in the browser.
// The repository's top-level folders are the books; each holds nav.json (title and menu) and its pages (.md or .html).
// Addresses: #/<book> its first page, #/<book>/<page> a page; #/ opens the book last read in this browser, else
// the first. The top bar holds the book's name (its menu lists the other books) and the book's chapters (nav.json's
// sections); the side menu lists the pages of the chapter shown, and is left out for a chapter of one page. A file
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
  var shown = null;   // the book shown, left out of the books menu (null on an error: every book listed)

  function clearPages() { store.keys().forEach(function (k) { if (k.slice(0, 3) === 'bb:') store.del(k); }); }
  function forget() { books = null; listings = {}; navs = {}; }
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
    signedIn(false);
    $('menu-toggle').hidden = true;
    $('books').hidden = true;
    $('chapters').innerHTML = '';
    $('repo').value = store.get('bb-repo') || '';
    $('signin-error').textContent = message || '';
    $('signin-error').hidden = !message;
    show();
  }

  function fail(id, err) {
    if (id !== current) return;
    if (err instanceof SignInError) return signIn(err.message);
    $('main').innerHTML = '<p class="note">' + esc(err.message || err) + '</p>';
    // No book's chapters over the error; the books menu stays, as the way to a book that opens.
    shown = null;
    $('book-title').textContent = 'Books';
    $('books').hidden = false;
    $('chapters').innerHTML = '';
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

  // The book's name opens a menu of the other books, read when it is opened.
  function booksMenu() {
    var id = current, book = shown;
    return shelfList().then(function (list) {
      var others = list.filter(function (b) { return b !== book; });
      return Promise.all(others.map(function (b) { return nav(b).catch(function () { return null; }); })).then(function (navList) {
        if (id !== current) return;
        var html = '';
        others.forEach(function (b, i) { if (navList[i]) html += '<a href="' + href(b) + '">' + esc(navList[i].title) + '</a>'; });
        $('books-menu').innerHTML = html || '<span>No other books yet</span>';
      });
    });
  }

  function closeBooks() { $('books-menu').hidden = true; $('book-title').setAttribute('aria-expanded', 'false'); }

  function page(id, book, name) {
    return nav(book).then(function (n) {
      var first = n.sections[0] && n.sections[0].pages[0];
      name = name || (first && first.page) || 'index';
      var files = listings[book];
      var file = files[name + '.md'] ? name + '.md' : files[name + '.html'] ? name + '.html' : null;
      if (!file) throw new Error('There is no page "' + name + '" in this book.');
      return blob(book, files[file]).then(function (text) {
        if (id !== current) return;
        var chapter = n.sections.filter(function (s) {
          return s.pages.some(function (p) { return p.page === name; });
        })[0];
        $('chapters').innerHTML = n.sections.map(function (s) {
          return s.pages.length ? '<a href="' + href(book, s.pages[0].page) + '">' + esc(s.section) + '</a>' : '';
        }).join('');
        var pages = chapter ? chapter.pages : [];
        $('side').innerHTML = pages.map(function (p) { return '<a href="' + href(book, p.page) + '">' + esc(p.title) + '</a>'; }).join('');
        $('main').innerHTML = file.slice(-3) === '.md' ? marked.parse(text) : text;
        $('book-title').textContent = n.title;
        $('books').hidden = false;
        shown = book;
        store.set('bb-last', book);
        signedIn(true);
        $('side').hidden = pages.length < 2;
        $('menu-toggle').hidden = pages.length < 2;
        if (window.matchMedia('(max-width: 760px)').matches) $('side').classList.add('closed');
        var h1 = $('main').querySelector('h1');
        document.title = (h1 ? h1.textContent + ' · ' : '') + n.title;
        window.scrollTo(0, 0);
        show();
        prefetch(book);
      });
    });
  }

  function route() {
    var id = ++current, parts;
    closeBooks();
    if (!store.get('bb-repo') || !store.get('bb-token')) return signIn('');
    try {
      parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    } catch (e) {
      return fail(id, new Error('This address cannot be read.'));
    }
    (parts.length ? page(id, parts[0], parts[1]) : openDefault(id)).catch(function (err) { fail(id, err); });
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
      forget();
      current++;
      signIn('');
    });
    $('book-title').addEventListener('click', function (e) {
      e.stopPropagation();
      var open = $('books-menu').hidden;
      if (open) {
        $('books-menu').innerHTML = '<span>Reading the books</span>';
        booksMenu().catch(function () { $('books-menu').innerHTML = '<span>The books could not be read</span>'; });
      }
      $('books-menu').hidden = !open;
      $('book-title').setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('#books-menu')) closeBooks(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeBooks(); });
    splitter();
    $('menu-toggle').addEventListener('click', function () { $('side').classList.toggle('closed'); });
    $('side').addEventListener('click', function (e) {
      if (e.target.closest('a') && window.matchMedia('(max-width: 760px)').matches) $('side').classList.add('closed');
    });
    window.addEventListener('hashchange', route);
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
