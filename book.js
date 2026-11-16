// The blueprint book: reads its books from a private repository with the visitor's read-only token, in the browser.
// The repository's top-level folders are the books; each holds nav.json (title and menu) and its pages (.md or .html).
// Addresses: #/ the shelf, #/<book> its first page, #/<book>/<page> a page. A file is fetched by its git blob sha and
// kept in localStorage under that sha, so it is downloaded once until it changes.
(function () {
  'use strict';
  var API = 'https://api.github.com/repos/';
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* full or blocked: read again next time */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* nothing kept */ } }
  };
  var listings = {};  // book -> {name: sha}, fetched once per visit
  var navs = {};      // book -> nav.json

  function show() { document.documentElement.classList.remove('hold'); }

  function SignInError(message) { this.message = message; }

  function api(path, raw) {
    var repo = store.get('bb-repo'), token = store.get('bb-token');
    if (!repo || !token) return Promise.reject(new SignInError(''));
    return fetch(API + repo + path, {
      headers: { Authorization: 'Bearer ' + token, Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json' },
      cache: 'no-store'
    }).then(function (r) {
      if (r.status === 401) throw new SignInError('The token was not accepted.');
      if (r.status === 403 || r.status === 404) throw new SignInError('The repository was not found, or the token cannot read it.');
      if (!r.ok) throw new Error('GitHub answered ' + r.status + '.');
      return raw ? r.text() : r.json();
    });
  }

  function listing(book) {
    if (listings[book]) return Promise.resolve(listings[book]);
    return api('/contents/' + encodeURIComponent(book)).then(function (items) {
      var map = {};
      items.forEach(function (it) { if (it.type === 'file') map[it.name] = it.sha; });
      return (listings[book] = map);
    });
  }

  function blob(sha) {
    var kept = store.get('bb:' + sha);
    if (kept !== null) return Promise.resolve(kept);
    return api('/git/blobs/' + sha, true).then(function (text) { store.set('bb:' + sha, text); return text; });
  }

  function nav(book) {
    if (navs[book]) return Promise.resolve(navs[book]);
    return listing(book).then(function (files) {
      if (!files['nav.json']) throw new Error('This book has no menu.');
      return blob(files['nav.json']);
    }).then(function (text) { return (navs[book] = JSON.parse(text)); });
  }

  // Everything of a book downloaded quietly once its first page is shown, so the next pages open at once.
  function prefetch(book) {
    var files = listings[book] || {};
    Object.keys(files).reduce(function (p, name) {
      return p.then(function () { return blob(files[name]); }).catch(function () { /* fetched when opened */ });
    }, Promise.resolve());
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

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

  function fail(err) {
    if (err instanceof SignInError) return signIn(err.message);
    $('main').innerHTML = '<p class="note">' + esc(err.message || err) + '</p>';
    show();
  }

  function shelf() {
    $('book-title').textContent = '';
    $('side').innerHTML = '';
    $('menu-toggle').hidden = true;
    return api('/contents/').then(function (items) {
      var books = items.filter(function (it) { return it.type === 'dir'; }).map(function (it) { return it.name; });
      return Promise.all(books.map(function (b) { return nav(b).catch(function () { return null; }); })).then(function (navList) {
        var html = '<h1>Books</h1><div class="shelf">';
        books.forEach(function (b, i) { if (navList[i]) html += '<a href="#/' + esc(b) + '">' + esc(navList[i].title) + '</a>'; });
        $('main').innerHTML = html + '</div>';
        document.title = 'Blueprint book';
        signedIn(true);
        show();
      });
    });
  }

  function page(book, name) {
    return nav(book).then(function (n) {
      var first = n.sections[0] && n.sections[0].pages[0];
      name = name || (first && first.page) || 'index';
      var files = listings[book];
      var file = files[name + '.md'] ? name + '.md' : files[name + '.html'] ? name + '.html' : null;
      if (!file) throw new Error('No page "' + name + '" in this book.');
      return blob(files[file]).then(function (text) {
        var side = '';
        n.sections.forEach(function (s) {
          side += '<h2>' + esc(s.section) + '</h2>';
          s.pages.forEach(function (p) {
            side += '<a href="#/' + esc(book) + '/' + esc(p.page) + '"' + (p.page === name ? ' class="active"' : '') + '>' + esc(p.title) + '</a>';
          });
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
    var parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (!store.get('bb-repo') || !store.get('bb-token')) return signIn('');
    (parts.length ? page(parts[0], parts[1]) : shelf()).catch(fail);
  }

  function start() {
    $('signin').addEventListener('submit', function (e) {
      e.preventDefault();
      store.set('bb-repo', $('repo').value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, ''));
      store.set('bb-token', $('token').value.trim());
      $('token').value = '';
      listings = {}; navs = {};
      route();
    });
    $('signout').addEventListener('click', function () {
      store.del('bb-token');
      listings = {}; navs = {};
      signIn('');
    });
    $('menu-toggle').addEventListener('click', function () { $('side').classList.toggle('closed'); });
    window.addEventListener('hashchange', route);
    route();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
