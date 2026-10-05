# Testing

The tests form a pyramid, and each layer covers what the one below cannot reach:

- Unit tests (`npm run test:unit`, a couple of seconds): the plain modules, and every user flow at the model level.
- Component tests (`npm run test:component`, a few seconds): what the components show, which handler each control calls, and the page wired to the model, in jsdom.
- Journeys (`npm run test:e2e`, about half a minute): a few long flows in a real browser, for layout, virtualization, scrolling, highlights, drag-and-drop, downloads and history.

A change to a flow belongs in its unit flow test; a change to what a component shows or calls, in its component test; and a journey step is added only for what needs a real browser. The legacy end-to-end suite (`tests/*.spec.js`) is skipped; see Legacy End-To-End Suite.

Every suite's command, and the build, lint and type checks, are in [AGENTS.md](../AGENTS.md#commands).

## Unit Test

- Command: `npm run test:unit` (Node's test runner over `tests/unit/**/*.test.js`)
- `tests/unit/flows/` specs every user flow at the model level: one file per legacy end-to-end spec (same name) and one unit test per legacy end-to-end test, under the same title. Each one runs its scenario against the app model and the plain modules, and checks what the page would show: headings, rows, prompts, FILTER values, links, picker selections, and the layout math behind scrolling and anchors. New flows get their unit flow tests here too.
- What the model cannot show is left to the component tests (JSX copy and markup, which handler answers which question, Escape in nested dialogs, the page's wiring) and to the journeys (CSS, layout, real scrolling and measurement). The real-database scroll flow tests replay the virtual tree's measurement and anchoring rules over a synthetic database shaped like Distribution_MiSTer.
- Coverage:
  - ports the main Downloader filter expectations from the upstream Python tests into JS
  - validates positive and negative filter combinations
  - validates `all` / `!all`
  - validates untagged and `essential` behavior
  - validates `_` / `-` normalization
  - validates invalid filter fallback behavior in this app
  - validates unsupported inherited filter terms are ignored with a warning for manual filter input
  - validates archive summary filtering uses the same semantics
  - validates INI `[mister]` defaults, per-entry overrides, and inheritance expansion
  - validates effective default filter precedence: INI entry filter, then database default, then `[mister]`
  - validates the flat tree row index used by the tree sections, and how many tags a row shows
  - validates the list's outline: rows touch, each line between two rows is drawn by exactly one of them however deep the tree and whatever is collapsed, the rounded outer corners, and rows rendered apart from the rows around them drawing their lines from the whole list
  - validates the FILTER reset / link-write gating reducer
  - validates the link format: key order, escaping, reading like a query string, unknown keys, packing past 2,000 characters, damaged and oversized packed links, writes that change only what they say, the rewrite of old `?database-url=` links, anchors for every row kind that lead back to their row, and the explorer's anchor
  - validates when opening an INI entry asks before replacing a non-empty `FILTER`
  - validates session catalog merging: exact URL match first, `db_id` only when it is unique, so forks that share a `db_id` stay listed
  - validates each combined database gets the filter Downloader's `build_db_config` would give it
  - validates combining databases: merged trees, case-insensitive collisions, identical copies, archive summary files, file-versus-folder collisions, filtered views, database-scoped archive ids, issues, and the size estimate
  - validates the filters when databases start combining, and the links of combined databases, including when only one of them can be shared
  - validates the selection rules: Update All defaults, one database per `db_id` with preferences, `db_id` conflicts, loaded entries, and when opening a selection would close a loaded database
  - validates the picker's selection summary and its review of the selection
  - validates new sessions of several databases, which keep a list's section filters as written, list entry filters with and without `[mister]`, and fetching with limited concurrency
  - validates that entries list their tags rarest in the database first, counting files, folders and archive entries, with ties in the database's order
  - validates what Downloader accepts as a database, which uploaded files are read, identical files, walking dropped folders through every batch and subfolder, paths, and content digests
  - validates replacing a loaded database in place, and that no sequence of openings, combinations and replacements loads two databases with one `db_id`
  - validates reloading a loaded database fetched again from its URL, and GitHub release downloads, which browsers cannot read directly: read through gh-proxy.com only for that URL pattern and only when reading them directly fails, keeping their own URL (a relative summary file in the release going the same way, and a reload asking the mirror again), and otherwise saying why
  - validates the explorer's SD card (`explorer.test.js`): the database's files and its archives' files merged at the paths they install to, ignoring letter case and keeping the first name met; a path installed twice, or by combined databases, as one entry with every version, identical or not; folder counts and sizes; what a filter leaves; where a path leads (a file's folder, or the deepest folder still there); Back and Forward; names cut short in rows and in two lines under icons; the rows rendered and scrolled into view; the keys that move the selection; and the view remembered in the browser
  - validates the theme modes (a chosen theme stays whatever the system says, hidden themes included; Match system, no choice, anything else stored and blocked storage follow the system), and that the early script in `index.html` applies the same rule
  - validates every end-to-end flow at the model level (`tests/unit/flows/`): loading and list flows, filtering, catalog merging, combining, pickers, uploads, anchors and page features, downloads, virtualization, real-database scrolling, and the explorer over what the page shows (a link to a file in an archive's summary file, FILTER, combined databases); and links: old links, links typed in the address bar, damaged links, and long sessions packed into their link

## Component Test

- Command: `npm run test:component` (Vitest over `tests/component/**/*.test.jsx`, in jsdom, with Testing Library)
- Config: `vitest.config.js`. `tests/component/setup.js` stubs what jsdom lacks (`scrollIntoView`, `scrollTo`, `ResizeObserver`, `matchMedia`) and unmounts after each test; `tests/component/support.js` builds inspections and rows from small databases.
- jsdom has no layout: nothing here measures, scrolls or checks CSS. Those belong in the journeys.
- Coverage:
  - the dialogs: load alone or combine (with its copy for one or several databases), the loaded `db_id` question for one and several databases and its reload form, the FILTER replacement question, and the picker's `db_id` question, each button calling its own handler
  - the error panel's download link for GitHub release downloads
  - the pickers: the catalog's Update All defaults, select all and none, the `db_id` question and Escape closing only it, Loaded and approximate-ID markers, search, the selection summary and its review, a list's `[mister]` checkbox, and the upload picker's origins and `[mister]` choices
  - the FILTER panel: Enter, Clear, the default note, the help copy, the essential hint, the result summary, the size estimate with its cluster sizes and hints
  - tree rows: OPEN and Download links, details, collapse, anchors, database chips, highlights, and their tags (the first four and "+N", and all of them with their other names when asked for, with details, or for a find-in-page match)
  - a database read through gh-proxy.com saying so, alone and on a combined database's card
  - the overview cards and the compact list of more than three combined databases (a long db_id breaking after `_` and `/`, and in full in a compact row's tooltip), the combined filters (shared and own filters, adding and removing one), the applied filter list (in full, or grouped with many databases), and issues with their database chips
  - the upload, Fetch and catalog cards (the drop area opens the file chooser too), the list and upload stand-in panel, and the find bar (count, Enter, Shift+Enter, Escape)
  - the theme menu: matching the system by default and following it, the three modes with the one in use checked, a chosen theme kept whatever the system says, Match system forgetting it, a hidden theme written by hand named on the button and replaced by a choice in the menu, each opening writing to the console how to pick a hidden theme (with a line that picks one when run), the keyboard (arrow keys, Home, End, Enter, Escape), a click outside or Tab closing it, and Escape going no further than the menu
  - the explorer (`explorer.test.jsx`): a folder's entries and sizes, Back, Forward and Up waiting for somewhere to go, a click showing the details (path, origin, hash, tags, URL, OPEN and Download) and the link naming a file while its details show, a double click, Back, Forward, Up and the path moving through folders and going up selecting the folder left, the keyboard (arrows, Enter, Backspace, Alt+arrows, Escape closing the details first, and the browser told to leave Alt+← and Backspace alone), a tap going into a folder on a touch screen and the info button, a folder's details and Open folder, a link to a file or to something not there, a folder a filter emptied, the view button and the remembered view, names keeping their end, each version of a path combined databases install, a failed download, the keys staying with a dialog on top, and closing by a click outside
  - the whole page against the model (`page.test.jsx`): the hero with the project's repository, the lines and corners each tree row draws of the list's outline, folding to its title once a database is loaded or when a link names one, a row's other tags on request and for a find-in-page match, a shared link's default FILTER and link, an old link becoming its `#db=` link, the install dialog's link, a far row anchor, combining from the load prompt, reloading the loaded database, a GitHub release download's error, Escape in nested dialogs, the essential hint opening the find bar, the FILTER help following the loaded database, a FILTER that empties the Archives section, `detailed` in the link, at load and from the toggle, Escape in the theme menu leaving the find bar open, the Explorer buttons of Files and folders and of Archives (archive files in their folders, the link, the focus given back, opening again where it was left), and a link opening the explorer on a file's details while find-in-page stands aside

## End-To-End Journeys

- Command: `npm run test:e2e` (Playwright; it runs `tests/journeys/`, while the legacy specs are skipped)
- Config: `playwright.config.js`
  - Tests run fully parallel on 4 workers; keep them independent of each other.
  - The dev server listens on `[::1]:4173`. Under WSL2 mirrored networking, Playwright's check of a closed `127.0.0.1` port hangs for about two minutes before every run.
  - The opt-in real-database journey (`REAL_SCROLL_URL`) measures scroll timing, so the config runs it on a single worker.
  - Playwright ignores `tests/unit/` and `tests/component/`, which other runners own.
- Each journey is one test that walks a user flow in `test.step`s. Add a step to the closest journey rather than a new test, and only for what needs a real browser; a journey's later steps rely on its earlier ones.
- Journeys must not be flaky, so they never assume how long the page takes. A check waits for what the page shows, never for a fixed time, and each step leaves no work running for the next one:
  - Scroll with `scrollUntilSteady` (large-tree), which scrolls again until the position holds for ten frames. Rows measured during a scroll apply their heights 120 ms after it stops, which can move what was just scrolled to.
  - A find-in-page or anchor jump scrolls its row into place again 300–500 ms after it lands, and section anchors scroll smoothly: wait for the page to stop scrolling (`untilScrollStops`) or start the next step on a fresh page (`about:blank`, then the app), before anything that depends on positions or hovering. Row link icons show only under the pointer.
  - For timed behavior, pause the page clock (`page.clock.pauseAt`) and move it with `runFor`, as the row flash step does. `runFor` also runs the timers those timers start; `fastForward` does not, so their work would spill into the next step.
  - A negative check (no ghost, no question) comes after something that proves the page has caught up: a positive check, or two drawn frames (`afterTwoFrames`).
  - An emptied FILTER reaches the address 600 ms later, and from there decides the FILTER of the next database opened, so a step that relies on an empty FILTER starts on a fresh page.
  - FILTER reaches the link 600 ms after typing: wait for the link itself before reloading, unpacking a packed one (`unpackLink`, lists-and-combining).
  - Going to the same page with only another `#` does not load it again; it opens the link in the page, as the address bar does. A step that needs a fresh page goes through `about:blank` first.
- Current coverage:
  - `large-tree.spec.js`: a generated large database: virtualization, rows touching as details and tags open and close with each line between them drawn once, collapse and expand, Close all, the last rows of long lists, ghost parent rows, find-in-page jumps and URL anchors to rows far outside the rendered window, and the explorer rendering only the entries near view of a large folder, as a list and as icons, reaching the last with scrolling, Home and End, and folding its path on a phone. The find step comes last before a fresh page, since its jump keeps scrolling for a moment
  - `shared-link.spec.js`: a shared link: an old `?database-url=` link becoming its `#db=` link, its GitHub link, the default FILTER and the link, Clear, the detailed toggle, size hints and cluster sizes, OPEN and Download, find-in-page highlights and the row flash, section and row anchors across reload, the explorer (archive files in their folder, Alt+← going back a folder rather than a page, the page behind not scrolling and kept where it was, its link across a reload, the icons view remembered, Escape), back and forward, a link typed in the address bar of the open page, and the theme menu (Dark's colors, kept across a reload and the system's switches, Match system following the system from the first draw and while the page is open, and each hidden theme written by hand showing its colors and its name on the button after a reload, until the menu replaces it)
  - `uploads.spec.js`: several chosen files, a folder dropped from disk while databases are loaded (combining, and replacing a loaded `db_id`), one dropped file opening directly, uploads without databases, and uploads opening again from the catalog
  - `catalog.spec.js`: the catalog merged with loaded sources, approximate IDs resolved on opening, the Update All defaults, the `db_id` question with Escape, select all and none, the load prompt, opening several databases, the compact list of combined databases (rows opening on their own, the section collapsing, the Detailed toggle in its summary), nothing on the page, in the catalog or in the explorer (a path six databases install, with the long db_id in its details, which come up from the bottom) wider than a 360px phone with a long db_id everywhere, the selection review, and loading alone
  - `lists-and-combining.spec.js`: database lists and combining: cancel and combine, collisions, combined filters across reload and history, the loaded `db_id` questions, failed and duplicate selections, a remote list on a fresh page, the FILTER replacement question, single-entry lists, loop detection, and a long session's packed link across a reload
  - `real-database.spec.js` runs only with `REAL_SCROLL_URL` set; it measures where `riscos.rom` sits in the live Distribution_MiSTer database at run time, so it does not need recalibrating when that database changes. It measures scrolling over time (its waits are the pauses of the scrolling it plays), so it runs alone and outside the default run
- Requirement:
  - if you change any virtualization-related code, re-verify the virtualized tree behavior in Playwright before considering the change done
  - when possible, include a real-database browser verification, not only the synthetic virtualization fixture

## Legacy End-To-End Suite

- `tests/*.spec.js` hold the 60 end-to-end tests the project used to run. They are skipped: each file starts with `test.skip(!process.env.LEGACY_E2E, …)`.
- Run them on demand with `LEGACY_E2E=1 npx playwright test tests/*.spec.js` (the real-database ones also need `REAL_SCROLL_URL`).
- Their coverage moved to the layers above: each test has a unit flow test under the same title, and what it checked in the browser is in the component tests or the journeys. Mutation testing (one-line bugs across the model, the plain modules and the components) confirmed that every bug the legacy suite catches is caught by the new layers.
- Do not add to them; extend the layers above instead.

## Known Gaps

Nothing tests these yet. When you change one of them, add its tests:

- INI parsing edge cases, beyond the `[mister]` section and entry filters (`ini-source.test.js`, `database-parsing.test.js`).
- The drop area's drag states: its look while files are dragged over it (`isDragActive`) and right after a drop (`isDropPulseActive`). The uploads journey drops files and folders, but checks only what they open.
- The remote URL aliases (`REMOTE_SOURCE_URL_ALIASES` in `database.js`): no test opens an aliased URL.
- An uploaded INI list adding all its entries to the catalog.
- Catalog text staying selectable, so it can be copied.
