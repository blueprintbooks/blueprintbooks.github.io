// The blueprint book: reads its books from a private repository with the visitor's read-only token, in the browser.
// The repository's top-level folders are the books; each holds nav.json (title and menu) and its pages (.md or .html).
// Addresses: #/ the shelf, #/<book> its first page, #/<book>/<page> a page. A file is fetched by its git blob sha and
// kept in localStorage as bb:<book>:<sha>, so it is downloaded once until it changes; keys of a book no longer in its
// listing are dropped, and sign-out drops them all.
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
    $('book-title').textContent = '';
    $('repo').value = store.get('bb-repo') || '';
    $('signin-error').textContent = message || '';
    $('signin-error').hidden = !message;
    show();
  }

  function fail(id, err) {
    if (id !== current) return;
    if (err instanceof SignInError) return signIn(err.message);
    $('main').innerHTML = '<p class="note">' + esc(err.message || err) + '</p>';
    signedIn(true);
    show();
  }

  function shelf(id) {
    return shelfList().then(function (list) {
      return Promise.all(list.map(function (b) { return nav(b).catch(function () { return null; }); })).then(function (navList) {
        if (id !== current) return;
        var html = '<h1>Books</h1><div class="shelf">';
        list.forEach(function (b, i) { if (navList[i]) html += '<a href="' + href(b) + '">' + esc(navList[i].title) + '</a>'; });
        $('main').innerHTML = html + '</div>';
        $('side').innerHTML = '';
        $('book-title').textContent = '';
        $('menu-toggle').hidden = true;
        document.title = 'Blueprint book';
        signedIn(true);
        show();
      });
    });
  }

  function page(id, book, name) {
    return nav(book).then(function (n) {
      var first = n.sections[0] && n.sections[0].pages[0];
      name = name || (first && first.page) || 'index';
      var files = listings[book];
      var file = files[name + '.md'] ? name + '.md' : files[name + '.html'] ? name + '.html' : null;
      if (!file) throw new Error('There is no page "' + name + '" in this book.');
      return blob(book, files[file]).then(function (text) {
        if (id !== current) return;
        var side = '';
        n.sections.forEach(function (s) {
          side += '<h2>' + esc(s.section) + '</h2>';
          s.pages.forEach(function (p) { side += '<a href="' + href(book, p.page) + '">' + esc(p.title) + '</a>'; });
        });
        $('side').innerHTML = side;
        $('main').innerHTML = file.slice(-3) === '.md' ? marked.parse(text) : text;
        $('book-title').textContent = n.title;
        $('menu-toggle').hidden = false;
        if (window.matchMedia('(max-width: 760px)').matches) $('side').classList.add('closed');
        var h1 = $('main').querySelector('h1');
        document.title = (h1 ? h1.textContent + ' · ' : '') + n.title;
        signedIn(true);
        window.scrollTo(0, 0);
        show();
        prefetch(book);
      });
    });
  }

  function route() {
    var id = ++current, parts;
    if (!store.get('bb-repo') || !store.get('bb-token')) return signIn('');
    try {
      parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    } catch (e) {
      return fail(id, new Error('This address cannot be read.'));
    }
    (parts.length ? page(id, parts[0], parts[1]) : shelf(id)).catch(function (err) { fail(id, err); });
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
    $('menu-toggle').addEventListener('click', function () { $('side').classList.toggle('closed'); });
    $('side').addEventListener('click', function (e) {
      if (e.target.closest('a') && window.matchMedia('(max-width: 760px)').matches) $('side').classList.add('closed');
    });
    window.addEventListener('hashchange', route);
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
