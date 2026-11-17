# Blueprint books

A closed reading site for the internal documentation of a set of tools: how each is built, its earlier versions and
its guide. Each tool is one book. The page holds no content: it reads the books from a private repository in the
browser with a read-only GitHub token, which the visitor types once (a password manager can fill both fields).

- `index.html`, `book.css`, `book.js`: the page. Addresses: `#/<book>` its first page,
  `#/<book>/<page>` a page; `#/` opens the book last read in this browser, else the first. The top bar holds the
  book's name (a menu of the other books); the side menu is the book's contents, every section of its `nav.json` with
  its pages (a section of one page named as the page shows as that page alone). `#/<book>/<page>#<heading>` opens a page at a heading (GitHub's heading ids), a link
  `#<heading>` in a page scrolls to it, and an HTML page's own scripts run (a figure drawn by the page). Pages read are kept in the browser until sign-out.
- `marked.min.js`: marked 12.0.2 (MIT licence), turns the Markdown pages into HTML.

The token is kept in the browser's storage for this origin, which every Pages site of the organisation shares
(`https://blueprintbooks.github.io/<repository>/`). So the organisation has no other Pages site.
