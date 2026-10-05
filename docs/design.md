# Design

What the inspector is for, and the decisions behind how it works. The rules for changing it are in [AGENTS.md](../AGENTS.md), and its tests in [testing.md](testing.md).

## Purpose

This repository is a static browser app for inspecting MiSTer Downloader databases and related archive summaries.
It is built to help users answer practical questions quickly:

- What is inside a database?
- Which files, folders, and archives does it define?
- Which warnings or schema issues are present?
- Which database URL or list entry should be opened next?

The app is meant to run entirely in the browser, including on GitHub Pages, without a backend.

## Product Goals

- Support local uploads of MiSTer Downloader database sources.
- Support direct remote loading from URLs when the host allows browser access.
- Support both single databases and database lists.
- Inspect archive summaries and render filesystem/archive trees clearly.
- Surface schema inconsistencies and path issues without mutating the source data.
- Keep the UI usable on large databases through virtualization.
- Let users re-open previously loaded custom databases from the in-app catalog during the current session.
- Let users preview Downloader-style filter behavior against an inspected database.
- Let users combine several databases to inspect them together, with the paths they share listed as collisions.
- Let users choose several databases at once, in the catalog and in database lists.
- Let users upload several files, or whole folders, and choose among the databases they hold.
- Offer a light and a dark theme that follow the system's setting, unless the visitor picks one from the menu in the page's top corner.
- Let users browse what the databases would install, one folder at a time, as a file explorer shows a drive.

## Important Technical Decisions

### 1. Browser-Only, Static Deployment

The app is designed to run without a server. That keeps deployment simple, but it means remote loading is constrained by browser fetch rules and the target host's headers.

Consequence:

- Remote URLs can fail even when they are downloadable from a shell.
- Error handling must explain browser-access limitations clearly.
- GitHub release downloads (`https://github.com/<owner>/<repo>/releases/latest/download/<file>`, or `releases/download/<tag>/<file>`) cannot be read directly: GitHub sends no CORS headers at any step of their redirects, the API's asset download included (`api.github.com` serves only the release metadata with CORS). Update All's Degauss database is one.
  - When reading one directly fails, and only for a URL of that pattern (`findGitHubReleaseDownload`), the page reads it through gh-proxy.com (`GITHUB_RELEASE_PROXY_URL`), a public mirror of GitHub downloads that lets websites read them. The database keeps the release URL, in its link, in "Loaded from" and as the base for what it names relatively (a relative summary file in the release goes the same way), and its details add "Read through: gh-proxy.com".
  - When the mirror fails too, or answers with an error, the error says why and offers the file to download and drag into Upload (`ErrorPanel`).
  - gh-proxy.com is a third party with no guarantee: it may go away, it sees which release is opened, and nothing checks what it returns against the checksum GitHub publishes for each release file.

### 2. Parsing Happens Client-Side

All source parsing is performed in the browser:

- JSON databases
- INI database lists
- ZIP containers through `fflate`

This avoids any upload backend and preserves the static-site model.

### 3. Runtime Catalog From `databases.py`

The known-database catalog is not hardcoded in the UI. It is fetched at runtime from `Update_All_MiSTer` and parsed from `Database(...)` entries.

Consequence:

- The count shown in the catalog reflects the currently parsed upstream source.
- Parsing failures in that upstream file affect catalog availability.

### 4. Session Catalog Overlay For Custom Sources

The app merges two catalogs:

- runtime catalog entries from `Update_All_MiSTer`
- session-local custom entries loaded by URL, upload, or uploaded list

Custom entries override runtime entries by exact URL match first, and only fall back to `db_id` replacement when that `db_id` is unique.

Consequence:

- A custom database can temporarily replace a known one for re-checking later in the same session.
- Alternative forks that intentionally share the same `db_id` stay visible in the catalog unless the loaded custom entry matches one of them specifically.
- Uploaded single databases are re-openable only for the current page session because they use object URLs; the app keeps each upload's file under its object URL and reads it again from there.

### 5. Downloader Filter Semantics Are Replayed Client-Side

The inspector derives a filtered view from the raw inspection data instead of mutating the loaded database.

Rationale:

- Downloader filter behavior depends on tag matching rules that users expect to be stable and recognizable.
- The raw inspection must remain available so the UI can switch filters instantly without reloading the source.
- Manual filter input still follows Downloader-style positive/negative semantics, while database defaults and INI-scoped defaults are resolved through an explicit precedence model.

Filter precedence and reset behavior:

- INI entry `filter` takes precedence when it exists.
- Database `default_options.filter` applies when the INI entry does not define its own filter, but only if `[mister]` sets no filter or that default inherits `[mister]`; otherwise `[mister]` wins. This is Downloader's own rule (`build_db_config`).
- INI `[mister]` filter is used as the fallback default when neither the INI entry nor the database defines a default filter.
- INI entry filters and database defaults can inherit from `[mister]`; `[mister]` is expanded inline, or replaced with an empty string if no `[mister]` filter exists.
- Clearing the `FILTER` input resets it to the effective default for the current database, not to an unconditional empty string.
- If opening an INI-selected database would replace a non-empty current `FILTER`, the UI asks for confirmation and lets the user keep the current filter or accept the incoming one.

### 6. Virtualized Tree Rendering

Large filesystem and archive trees are virtualized instead of rendering every row at once.

Rationale:

- MiSTer Downloader databases can contain enough rows to make naive rendering expensive.
- The app keeps tree interaction responsive by rendering only the visible slice plus overscan.
- Any change that touches virtualization, row measurement, scroll behavior, detail toggles, or tree layout must be verified in a real browser against virtualization behavior again, not only by reasoning or unit tests.
- Prefer verifying virtualization against a real database in Playwright, not only a synthetic fixture.
- In `TreeSection`, hook order matters: the navigation effects run before the viewport and measurement effects (hence the two hooks in `useVirtualTree.js`). Keep that order when editing.
- Do not use `useEffectEvent` inside the tree components: React 19.2 does not refresh Effect Events inside `memo()` or `forwardRef` components, so they would keep calling the first render's callback.
- A row's measured height is cached under what the row shows: collapsed or open, its details, and all its tags or only the first few (`getRowMeasurementKey`). Anything new that changes a row's height needs its own part of that key, passed through the layout like `expandedTagIds`; otherwise the layout places the rows after it with a height measured for something else.
- Tags are listed rarest first: when a database is read, each entry's tags are sorted by how many of its files, folders and archive entries use them, ties keeping the database's order (`sortTagsByRareness` in `database.js`). The counts cover the whole database, so filters do not change the order, and every view (rows, details, combined databases) shares it.
- Tree rows show their first four tags, one name each (the others in the chip's tooltip), and "+N" for the rest; a row with just one more shows all five (`compactTagList`). All of them show, with their other names, when the user asks ("+N", then "Show fewer"), with the row's details, and on the row of the find-in-page match in one of its tags.
- Rows are compact: with its details hidden, a row is its heading and its tags, and ends at its last line (a file with a line of tags measures about 101px, a row without tags 61px, a file with its details about 353px). Until a row is measured, `estimateRowHeight` stands in for its height, and the virtual tree's scrolling was tuned with estimates in a given proportion to the measured heights. When row styles change those heights, scale the estimates by the same ratio and check scrolling against a real database again (`real-database.spec.js`).
- The rows touch: there is no space between them, and together they draw one outline around the list that steps in under a folder's rows and back out after them, so the indentation shows in the outline as well as in the guide lines. Before, each row was a card of its own, 13px from the next.
  - Each line is drawn once, by one row: the wider of the two rows it separates (the less indented), or the lower one when both are as wide (`rowOutline` in `treeLayout.js`). Two rows that each drew their border, overlapping by a pixel, came out thicker than the rows' sides: rows are placed at whole pixels while their content is a fraction taller or shorter, and at zoom levels like 125% a CSS pixel is not a whole number of screen pixels.
  - A row draws its card (background and its part of the outline) on its `::before`, the height of its place in the list (`--tree-row-height`, from the layout) rather than of its content, so it reaches exactly where the next row starts. The card element itself keeps a transparent border, so rows measure as before. A row outside the list is drawn as a card of its own.
  - The outline's outer corners are rounded: the list's four with the theme's card corner (`--radius-md`), and where it steps in or out with up to half an indentation step. Its inside corners stay square.
  - Which lines and corners a row draws depends on the rows above and below it in the whole list, rendered or not, since the rendered rows are not always next to each other.
  - The collapse button and the leaf dot sit 0.4rem below the row's top (`--tree-control-offset`), clear of the step above, and the guide lines join them there.
- The hero folds over 350 ms while a database loads, so a tree can mount while the page above it still moves. `useWindowViewport` watches the page's size and bumps `layoutVersion` on every change, so the tree reads its position again each frame and keeps rendering the rows on screen. Anything else that animates the page above a tree must keep it that way.
- When measured heights apply, the page scrolls so the row at the top of the viewport stays put, but only by what the browser has not already moved (`getRemainingScrollAnchorDelta`): when the new heights make the page shorter than its scroll position allows, as at the bottom of the page, the browser pulls the scroll position back by itself. Scrolling the whole delta on top of that pushed the rows on screen down, out of view (find-in-page opened from the footer missed the last rows).

### 7. Compatibility Over Strict Purism

The parser intentionally tolerates or translates several real-world variations:

- ZIP-wrapped sources
- legacy archive/ZIP summary structures
- `tags_dictionary` fallback
- ignored `[mister]` INI section as a database entry, while still reading its shared `filter`
- per-entry INI filters
- `[mister]` inheritance resolution after the full INI is parsed, so section order does not matter
- URL aliasing for known browser-incompatible sources when needed

This project is meant to inspect real data in the wild, not only idealized schema examples.

### 8. Diagnostics Are First-Class

The app does not only render data. It also computes issues and warnings so malformed or surprising input is visible to the user during inspection.

### 9. Combined Databases

Several databases can be inspected together, as Downloader would install them side by side.

- Opening a database (upload, Fetch, catalog, or a database list) while one is loaded asks whether to load it alone, replacing the loaded ones, or to combine it with them. Shared links and back/forward navigation never ask.
- With databases loaded, uploads and Fetch read the source before asking. A database list with several entries then opens its picker without asking, and the loaded databases stay while its databases are chosen.
- No two loaded databases ever share a `db_id`, and neither do two selected ones. Combining a database whose `db_id` is loaded asks whether it replaces the loaded one, in its place, or stays out; with several such databases each is chosen in one question, whose Cancel changes nothing.
- A database from the URL of a loaded one with its `db_id` is that database again, so the question is whether to reload it (Keep the loaded one, or Reload it, in its place with its filters). Fetching the only loaded database again asks just that, since it cannot be combined with itself; with other databases loaded, the combine question comes first. Fetching a loaded URL asks the website again rather than reusing the browser's cached copy.
- Each database is filtered first, then the views are combined (`src/lib/combine.js`). A collision is a path that more than one database would still install after its filter, compared ignoring letter case; it includes archive summary files, and files where another database needs a folder. Identical copies (same hash and size) are still collisions, marked as identical.
- Collided files leave the Files and folders and Archives sections and are listed, with every version, in Path collisions. Issues and warnings gets one summary warning. Archives keep their card even when all their files collided.
- Up to three combined databases (`COMBINED_DATABASES_IN_FULL_MAX` in `utils.js`) show in full; more show compactly:
  - The overview: cards, or a compact list in a Databases section that collapses, with the Detailed toggle in its summary so it stays at hand. The list is in columns, as many as give each 25rem (three on a wide page, one on phones); each row is its db_id with its counts below (nothing else clickable) and opens in place, on its own, to what the card shows (Install, the repository, the details). In columns a db_id too long for one is cut short, in full in its tooltip; in a single column it wraps, after `_`, `/` or `-` where it can (a container query on the list decides). Rows keep the cards' `combined-database-card` class and db_id heading.
  - The filter applied to each database: every database, or only those with a filter or a default of their own (`listAppliedFilters`), then one line for the rest, which all get the shared filter or none ("The other 140 databases: Everything, no filter").
- Combined filters follow downloader.ini: the shared FILTER is the `[mister]` filter, each database can have its own filter (which can include `[mister]`), and each database's filter is resolved with Downloader's precedence (`resolveDownloaderFilter`).
- A single database keeps today's FILTER box. When a second database joins, the first one keeps its FILTER as its own filter if it differs from what it would otherwise get; a database joining from a database list keeps the filter its list gives it.
- Links (see 12): one database is its `db` and FILTER as `filter`. Combined databases are a `db` each, `filter` for the shared filter, and `filter.<db_id>` for each database's own filter; uploaded databases cannot be shared and stay out of the link.
- Anchors of combined databases put the database before an archive's id (`at=archives:<db_id>:<id>`), and collided paths use `at=collisions:<path>`.
- The catalog and database lists share one picker for choosing several databases at once. A selection holds one database per `db_id`: choosing a database whose `db_id` is selected asks whether to replace the selected one. Select all picks one database per `db_id`: the one already chosen, else an Update All default (`UPDATE_ALL_DEFAULT_DATABASES`), else the first. The catalog opens with nothing selected and can select the four Update All defaults; a list opens with all its databases selected, plus a checkbox (checked) to apply its `[mister]` filter when it has one. Loaded databases are marked.
- In the picker, the list fills the dialog and is the part that scrolls (small screens scroll the whole dialog instead). The summary names the first ten selected databases and counts the rest. Reviewing the selection ("Review selected", or "+N more") lists only the databases selected when the review started, so one unchecked there stays in place until "Show all entries".
- Opening a selection asks whether to combine only when a loaded database is not part of it: the same URL, the same uploaded file, or a file with the same content. Otherwise the selection is opened afresh, replacing the loaded databases.
- A selection of one database follows the single-database flows, including the FILTER replacement question for list entries. Several databases opened alone start a new session: the chosen `[mister]` filter, or else the current FILTER, is the shared filter, and each list section's filter is that database's own, as written. Combining adds only the selected databases that are not loaded yet, each with the filter its list gives it, resolved. A selection that ends up with one database shows it alone.
- Selections are fetched six at a time, with progress. Failed loads are reported by URL, and a database whose `db_id` another selected database has is left out with an error.

### 10. Uploading Several Files Or Folders

- One chosen or dropped file opens as before. Several files, chosen or dropped, or any dropped folder (walked recursively) are read first and their databases offered in the upload picker. Folders can only be dropped: there is no folder chooser.
- Only `.ini`, `.json` and `.json.zip` files are read, and only lists with a database and databases that Downloader would accept are kept; everything else is skipped without a word. When nothing is left, the user is told no databases were found.
- Identical files (same content) are read once. Entries are listed by path, and show where they came from: the file name, or the path inside the dropped folder. The first database of each `db_id` is selected.
- The `[mister]` filters of the lists among the files can be applied: one with a checkbox, several with a choice of one or none.
- With databases loaded, they stay while the uploads are read and chosen, as with database lists.

### 11. The App Model And Its Binding To React

The app's state and flows live in `createAppModel` (`src/model/appModel.js`), outside React, so unit tests can drive them without a browser. The binding reproduces how the same state behaved as React state, render by render, and must be kept that way:

- The page holds the model's state as React state (`useState`), set from the model's listener. Updates therefore get the same priority and batching as the `useState` setters they replaced: synchronous in clicks, batched in fetch continuations, and batched with the page's own state. Do not switch to `useSyncExternalStore`: it renders every change synchronously, and the differential harness caught the result, URL anchors and scroll positions that changed after loads and back/forward navigation.
- Each committed render is reported back: `model.commit(state)` in a layout effect (what user actions start from, as handlers read their render) and `model.runReactions(state)` in a passive effect placed where the effects it replaced ran, right after the URL anchor effect and before `model.connect()`. Reactions run in order, each only when its dependencies changed, cleanups first, and their changes render with the anchor's.
- Actions read the last committed render (`ctx`). What an action reads after waiting (the databases it combines with, FILTER) comes from `refs`, which follow the renders with the effects and which showing databases updates at once, as the refs they replaced did. Back/forward navigation and shared links read the first render (`INITIAL_CTX`).
- One question waits at a time. Answering "load alone or combine" or the FILTER replacement runs its continuation within the same click, so the load it starts renders together with the question closing (the modal's scroll lock restores the scroll position in that render). The loaded `db_id` question resolves a promise, so what follows it runs after.
- Unit tests drive the model as the page does through `tests/unit/support/app.js`, which commits a render and runs the reactions after each change, in a fake browser (`tests/unit/support/browser.js`: address bar and history, timers on a clock the test moves, fetch answered from routes).

### 12. The Page's Link

Everything a link names lives after the `#` of the address (`src/lib/urlState.js`), so it never reaches the server: GitHub Pages refuses addresses whose path and query pass 8,192 characters, which the old query links reached with enough combined databases.

- The link is `&`-separated `key=value` pairs, read as a query string is (`+` is a space, `%XX` an escape), and always written in this order:
  - `db=<url>`: a database, one per database, in session order.
  - `filter=<terms>`: FILTER of a database shown alone, or the shared (`[mister]`) filter of combined ones. Absent, defaults apply; present but empty, nothing is filtered.
  - `filter.<db_id>=<terms>`: a combined database's own filter.
  - `detailed`: details are shown.
  - `at=<anchor>`: a row (`files:<path>`, `folders:<path>`, `archives:<id>`, `archives:<id>:files:<path>`, `archives:<id>:folders:<path>`, `collisions:<path>`), a section (`database`, `filter`, `files`, `archives`, `collisions`, `issues`, `tags`), `install`, the install dialog of a database shown alone, or the explorer (`explorer` at the SD card, `explorer:<path>` at a folder, or at a file's folder with its details shown; see 15). Combined databases put the db_id before an archive's id (`archives:<db_id>:<id>`); reading it matches the loaded db_ids, longest first, since a db_id can hold a colon.
- Only `%`, `&`, `+`, `=`, `#`, whitespace, control and non-ASCII characters are escaped, and `"`, `<`, `>` and `` ` ``, which browsers escape in an address themselves; a space is written as `+`. URLs and filters stay legible: `#db=https://example.com/db.json&filter=arcade+!cheats`.
- A link stays readable while the whole address is at most 2,000 characters (`LINK_READABLE_MAX`, Discord's message limit); past that, every key but `at` is packed into `z=<data>`: the readable text, raw deflate (fflate, no preset dictionary), in base64url without padding. Packed keys read as if they were written in place of `z`; a `z` inside one is ignored, and unpacking stops past 1 MiB.
- Unknown keys are ignored. A `z` that cannot be unpacked shows "This link is damaged, so what it names could not be opened." and opens nothing; the next write replaces the link. Broken escapes never throw.
- Writes change the link only when what it says changes (compared on the readable text, so a packed or reordered link is not rewritten for nothing), in a new history entry only when the flow asks for one. The rest of the address, such as an unknown query, is kept.
- One `db` is shown alone; several, or one with an own filter, are combined (`isCombinedLink`). When only one of combined databases has a URL, the link names it alone, so it keeps the filter it gets among the others as its own filter whenever FILTER would differ without it (`buildCombinedLink`); opening that link shows it alone with that filter.
- The model reads the link's `filter` when a new source arrives (`filterSync`), and writes that keep FILTER keep it in the link, so an emptied FILTER carries over to the next database opened. Keep that coupling when changing writes.
- A link typed in the address bar of the open page (another `#` of the same page) does not load the page again: the browser fires popstate, and the app opens the link as it does on back and forward.
- Old links: on start, `?database-url=<url>` becomes `#db=<url>` (`rewriteOldLink`, in `createAppModel`), as the Inspect links of the MultiDatabases README are written. Nothing else of the old format is read: its `filter`, `detailed`, `database-url[<db_id>]`, `filter[<db_id>]`, and `#` anchors are dropped. The MultiDatabases catalog reads an Inspect link's database from `?database-url=` or from `#db=`.

### 13. Phone Screens

Nothing on the page, or in its dialogs, should be wider than a phone screen, down to 320px. Long db_ids, paths, messages and tag names wrap, or are cut short with the full text in a tooltip:

- Rows: on phones (720px and narrower), a combined database's chip is cut short past 40% of the line, in full in its tooltip, so the row's name keeps its room. The row stays one line, so its height does not change.
- Issues: on phones, the message takes a line of its own, and the db_id and context wrap.
- Path collisions: on phones, the pill's databases go under its label, and the pill keeps round corners rather than round ends.
- Combined databases: card headings and compact rows break a db_id after `_` and `/` (`breakableId` in `CombinedOverview.jsx`), and the cards' grid never asks for a column wider than the page.
- FILTER: the section's one column is its width (`minmax(0, 1fr)`), so the own-filter menu, whose options are db_ids, shrinks to it. db_ids and filter terms wider than the line wrap.
- Tags: the tag groups' db_ids, and tag names, wrap when they are wider than the line.
- Pickers: the selection summary and the entries wrap a db_id wider than the dialog, which otherwise scrolled sideways and hid "Review selected".
- The explorer (15) fills the screen; its path folds its first folders into …, and the details come up from the bottom, wrapping a long db_id.

These rules only act on content wider than its line, so wider screens keep their layout: compared element by element at 768, 1024 and 1440px, only what used to overflow changed (issue messages that widened the page at 721–768px, and card headings that ran into the next card). Keep it so. `overflow-wrap: anywhere` lets a flex item shrink below its own words, so on an item that shares a line with others it squeezes that item even where everything would fit (a short path in an issue broke into six lines at 768px). Give it only to the item meant to absorb the shrinking, such as an issue's message, or scope it to phones, where those lines wrap.

The catalog journey checks the page, the catalog and the explorer at 360px with a long db_id in every place above, and names what sticks out when it fails.

### 14. Themes

The page offers two themes: 16-bit, light, after the Super Nintendo (cool greys and purple, with the Super Famicom's four button colors for the row kinds: blue files, yellow folders, green archives and red collisions), and Retrowave, dark, after 80s synthwave (indigo, magenta for actions, cyan for links and focus, sunset orange for labels).

Three more themes are in `app.css` but not offered: Classic (`classic`, the theme before these two, as it was, its contrast failures included), Dot Matrix (`dot-matrix`, after the original Game Boy: grey plastic, magenta buttons, navy lettering and the greens of its screen) and Phosphor (`phosphor`, an amber monitor with faint scanlines). The menu never lists them: only a value written by hand from the browser's developer tools picks one (`localStorage.setItem('inspector-theme', 'phosphor')`, then reload). Each opening of the menu, by a click or the arrow keys, writes how in the browser's console (`console.log`), with that line ready to run. The menu's button then names it (`Theme: Phosphor`, with a sun for Classic and Dot Matrix, a moon for Phosphor), none of the menu's modes is checked, and a choice in the menu replaces it.

- Every color in `app.css` is a variable, defined in `:root` for 16-bit and again in a `:root[data-theme="…"]` block for each other theme (`dark` for Retrowave, then `classic`, `dot-matrix` and `phosphor`); no rule holds a color of its own, so a new color needs a value in all five blocks. The few things a theme shows that are not colors are variables too: corner radii, the panels' bottom-right corner (`--panel-corner`, the Game Boy's round corner in Dot Matrix) and whether the header's mark shows (`--brand-mark-display`, none in Classic). The find-in-page highlights are the exception: highlight pseudo-elements do not read variables in every browser, so each theme has its own `::highlight` rules with literal colors. The CSS optimizer warns about `::highlight`, which it does not know, and keeps the rules.
- The themes change colors and corner shapes, never sizes. An outline that only one theme draws (secondary buttons, Download and Open, database names) is an inset box shadow, so every theme lays the page out identically, as an element-by-element comparison confirmed. The one exception is Classic's header label, narrower without its mark. Keep it so: a size that differs between themes would also change the row heights the virtual tree measures.
- The details near the title take no space: a mark before the header's label (the four Super Famicom dots, or a sunset stripe) and, in Retrowave, a sunset line under the title and a glow on it.
- The theme menu sits in the page's top corner, in a strip the shell's top padding keeps for it (2.75rem). Its button shows the mode (◐ while it matches the system, else a sun or a moon), and its menu offers Match system (the default), Light and Dark, following the menu button pattern: opening it focuses the mode in use, the arrow keys, Home and End move, Enter or a click picks, and Escape, Tab or a click outside close it.
- Match system follows the system's setting as it changes, by hand or on a schedule (macOS, iOS and Android switch by the hour; Windows 11 was testing it in 2026), while the page is open too. A chosen theme stays whatever the system says, and is remembered in this browser (`localStorage`, `inspector-theme`: `light` or `dark`, or a hidden theme's id; Match system removes it, and anything else stored is ignored). `index.html` applies the same rule before the page draws, so the page never flashes the other theme; `src/lib/theme.js` holds the rule for the menu, and a unit test runs the early script against it.
- An Escape inside a menu closes only the menu: the find bar, whose Escape is a capture listener on the window, leaves Escapes from inside a menu (`role="menu"`) alone.
- Contrast was checked for every pair of colors used together, in 16-bit, Retrowave, Dot Matrix and Phosphor: at least 4.5:1 for text, and 3:1 for focus rings and field borders. Classic was left as it was.

### 15. The Explorer

The tree sections show a database as it is written: its files and folders, and its archives as containers. The explorer shows what it would leave on the SD card: one folder at a time, as Windows' File Explorer shows a drive, with the files and folders inside the archives at the paths they install to, next to the database's own (Distribution_MiSTer's `mra_alternatives` puts `_Arcade/_alternatives` next to `_Arcade/cores`). The archives themselves are not shown.

- It is a dialog, opened by the Explorer button in the controls of Files and folders and of Archives, which open the same explorer. It covers the page, so the tree sections, their scrolling and their anchors are as they were, and closing it leaves the page where it was (the modal scroll lock) and gives the focus back to the button.
- What it shows is built from the view the page shows (`buildExplorerTree` in `src/lib/explorer.js`): the filtered database, or the combined databases, each filtered by its own filter. FILTER is not in the dialog; it is changed on the page, and the explorer opens on the result. Paths are compared ignoring letter case, as the SD card and collisions compare them; the first name met stays. A path that combined databases both install (a collision) is one entry listing every version; so is a path a database installs from its files and from an archive. A folder counts the files it holds at any depth and adds up their known sizes (a collision at its largest version, as the size estimate counts it).
- The dialog holds a bar and the folder's contents. The bar has Back, Forward and Up, a button that switches between the list and medium icons (it shows the view it switches to; the choice is remembered in this browser, `localStorage`, `inspector-explorer-view`), a bar, the path from the SD card (each folder above goes there; the first ones fold into … when they do not fit, and the folder shown is cut short instead of folding), and the close button.
- Entries are listed folders first, then files, each by name. A row is an icon, the name and the size; a name cut short keeps its end (its extension and the nine characters before it, a core's `_20240525.rbf`). An icon's name takes two lines, breaking between words, and a second line that does not fit keeps the name's end; the lines are measured with a canvas in the name's font.
- A click selects an entry and shows its details, beside the list or, on phones, from the bottom: a file's path, where it comes from (the database's files, or an archive, after its database when combined), its hash, tags, URL, and OPEN and Download as on tree rows; a folder's files and size, where it is declared, its tags and Open folder; each version of a path several install. The details stay open while folders change, showing the folder gone into, so a double click does not open and close them. A double click goes into a folder; on a touch screen, where there is no double tap, a tap does, and a folder's info button shows its details. The keyboard: the arrows, Home and End select (by rows and columns in the icons), Enter goes into a folder or shows a file's details, Backspace and Alt+↑ go up, Alt+← and Alt+→ go back and forward, and Escape closes the path's menu, then the details, then the explorer.
- Its link: `at=explorer` while it shows the SD card, `at=explorer:<path>` for a folder, or for a file whose details are shown (12). Each move replaces the anchor rather than adding a history entry, as the other anchors do: the model opens what the link names on every back and forward (11), which would load the database again for each folder, so the explorer keeps its own history of folders for Back and Forward, and the browser's back and forward still move between what the page has open. Closing takes the anchor out of the link. A link opens it where it names, or at the deepest folder still there when a filter hides the rest; it opens again where it was left until another database is shown.
- While it is open, find-in-page stands aside (Ctrl+F is the browser's own, and Escape is the explorer's), and a dialog over it (a failed download) keeps the keys.
- Rows, and rows of icons, have one height each, set in `app.css` (`--explorer-row-height` and the tile sizes, taller on phones), so the list renders only those in view and places them by their index (`explorerWindow`). None of the tree's measurement and scroll anchoring (6) is involved.

