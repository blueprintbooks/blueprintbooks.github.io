# Blueprint book

A closed reading site for the internal documentation of a set of tools: how each is built, its earlier versions and
its guide. Each tool is one book. The page holds no content: it reads the books from a private repository in the
browser with a read-only GitHub token, which the visitor types once (a password manager can fill both fields).

- `index.html`, `book.css`, `book.js`: the page. Addresses: `#/` the list of books, `#/<book>` its
  first page, `#/<book>/<page>` a page. Pages read are kept in the browser until sign-out.
- `marked.min.js`: marked 12.0.2 (MIT licence), turns the Markdown pages into HTML.

The token is kept in the browser's storage for this origin, which every Pages site of the organisation shares
(`https://blueprint-book.github.io/<repository>/`). So the organisation has no other Pages site.
