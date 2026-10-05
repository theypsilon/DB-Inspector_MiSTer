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
- Let users choose FILTER terms from the tags of the databases, beside FILTER.

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
- A row's measured height is cached under what the row shows: collapsed or open, its details, all its tags or only the first few, and the screen it is laid out for: wide, narrow (960px and narrower) or a phone (720px and narrower; `TreeScreen`, `getRowMeasurementKey`). Anything new that changes a row's height needs its own part of that key, passed through the layout like `expandedTagIds`; otherwise the layout places the rows after it with a height measured for something else. How many tags fit on a row's line (below) is not part of it: it follows the list's width, as a row's height already did, and a row whose height changes with it is measured again by its resize observer, as for any other change of width.
- Tags are listed rarest first: when a database is read, each entry's tags are sorted by how many of its files, folders and archive entries use them, ties keeping the database's order (`sortTagsByRareness` in `database.js`). The counts cover the whole database, so filters do not change the order, and every view (rows, details, combined databases) shares it.
- Tree rows show as many of their tags as fit on one line, one name each (the others in the chip's tooltip), and "+N" for the rest, or all of them when they fit (`fitTagCount` in `tagFit.js`). All of them show, with their other names, when the user asks ("+N", then "Show fewer", which stays while they are asked for, even once a wider page fits them all), with the row's details, and on the row of the find-in-page match in one of its tags. Rows used to show their first four, which left most of a wide line empty and wrapped onto up to five lines on a phone.
- On screens 960px and narrower, a file leaves its tags to its details: its line shows none until its details show, all its tags are asked for, or the find-in-page match is in one of them (`rowTagsHidden` in `treeLayout.js`). Folders and archives keep theirs, on one line as above.
  - The width is `NARROW_SCREEN_QUERY` (`utils.js`), the one at which `app.css` stacks a row's heading, so the heading stacks and the tags go at the same width; change both together (the large-tree journey checks 960 and 961px). Between 721 and 960px, file rows used to be as tall as a phone's, with their heading stacked and, on a narrower line, tags that often took two lines (30% of distribution_mister's files at 768px, 81% of jtcores'), while from 961px they take one.
  - The page decides it (`useMediaQuery` in the tree section), not CSS, so a hidden line's chips are not rendered and its height has its own part of the measurement key, the screen: a row measured on one is not placed with that height on another.
  - Measured on distribution_mister without details: a file row is 104px at 960px (146px with its tags), and the tree is 24% shorter at 960px (281,907 to 215,610px) and 20% shorter at 360px (352,482 to 283,499px), its rows touching at every stop of a scroll from top to bottom, as before.
- On phones (720px and narrower), a row is its name: no FILE, DIR or ZIP badge, database, "Path" label or path, details button or download links, which took most of a phone's line and squeezed the name out of it. A tap on the row shows or hides its details, as its details button does on wider screens, where a click on a row does nothing; a tap on a control, in its details or issues, or the click that ends selecting its text does not.
  - With its details, it shows its full name and path, wrapped (without a tooltip, which a tap would otherwise bring up over them), then its database, a long db_id wrapping inside the row, and its OPEN and Download links, its tags and its details. Its details button stays for the keyboard and screen readers, out of sight until it has the keyboard focus.
  - The width is `PHONE_SCREEN_QUERY` (`utils.js`), the one `app.css`'s phone rules start at; change both together (the large-tree journey checks 720 and 721px).
  - Until they are measured, phone rows are estimated in the proportions of a wide screen (123 to 101 for a file, 104 to 101 for a folder): 60px for a file and 92px for a folder without their details, which measure 49px and 89px (a name, and a folder's line of tags) on distribution_mister, jtcores and an artwork database.
  - Measured on distribution_mister at 360px: without details the tree is 62% shorter (283,499 to 108,478px), 17 rows to a screen rather than 7; with them it is as long as before (641,913 to 643,229px). Rows touch at every stop of a scroll, and the last row is reached, as before.
  - Tags are written in IBM Plex Mono, whose characters are all as wide, so a tag's width is its padding plus its length times one character's, and every row at the same depth has the same room for them. Each tree list measures those widths once, from a hidden row shaped like a file's at its top (`TagFitProbe`: its tag line, one indentation step, and sample tags), as it mounts, before the page is drawn, and again when the list's width or the font changes; each rendered row counts its own tags from them, without measuring itself. Rendering every tag and measuring each row instead would lay rows out twice as they scroll into view. Measured on jtcores and Distribution_MiSTer, the first load lays the page out as many times as before, and draws it as soon.
  - A row keeps 2px of its line free (`TAG_FIT_MARGIN_PX`), so rounding never pushes its last tag onto a second line, and counts characters beyond ASCII as two, since they may come from another font: either can leave a row one tag short of what would just fit. A row shows at least one tag, so on a phone a long first tag can put "+N" on a second line.
  - Until the widths are known (and in jsdom, which has no layout), rows show their first four tags, or all five (`compactTagList`).
  - The hidden row is not a `.tree-entry`, so nothing that looks for rows finds it, but it has a row's sizes: the rules that set them on `.tree-entry` (its variables and padding, on phones too) name `.tag-fit-probe` as well. A rule that changes a row's width must name it too, or rows fit their tags to a line of another width.
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
- A database gets its own filter from "+ Own filter for a database" under the shared FILTER (`OwnFilterPicker`), which lists the databases without one, each with the filter it gets now and where from (shared filter, database default, no filter), so a database whose default already differs shows before it is picked. From eight databases (`OWN_FILTER_SEARCH_FROM`) the list has a search box, which matches any part of a db_id. The arrow keys only move the highlight, and only Enter or a click picks: the native menu it replaces gave a database its own filter at the first arrow key on it, closed. The picked database's box gets the filter it had and the cursor, after it. Escape, Tab or a click outside close the list; Escape gives the focus back to the button and leaves the find bar open. The list opens over what follows it, the panels below too, scrolling the page if needed to show it whole.
- A single database keeps today's FILTER box. When a second database joins, the first one keeps its FILTER as its own filter if it differs from what it would otherwise get; a database joining from a database list keeps the filter its list gives it.
- Links (see 12): one database is its `db` and FILTER as `filter`. Combined databases are a `db` each, `filter` for the shared filter, and `filter.<db_id>` for each database's own filter; uploaded databases cannot be shared and stay out of the link.
- Anchors of combined databases put the database before an archive's id (`at=archives:<db_id>:<id>`), and collided paths use `at=collisions:<path>`.
- The catalog and database lists share one picker for choosing several databases at once. A selection holds one database per `db_id`: choosing a database whose `db_id` is selected asks whether to replace the selected one. Select all picks one database per `db_id`: the one already chosen, else an Update All default (`UPDATE_ALL_DEFAULT_DATABASES`), else the first. While a search (or a review of the selection) leaves only some databases, it acts on those alone, as "Select shown" and "Unselect shown": it adds them to the selection, or takes them out of it, and leaves the rest of the selection as it is; a `db_id` chosen through a database the search hides takes a shown one instead, so that what is shown ends up checked. It used to select the whole catalog, unseen, whatever the search. The catalog opens with nothing selected and can select the four Update All defaults; a list opens with all its databases selected, plus a checkbox (checked) to apply its `[mister]` filter when it has one. Loaded databases are marked.
- In the picker, the list fills the dialog and is the part that scrolls (small screens scroll the whole dialog instead). The search box draws its focus ring inside its border: the dialog's body scrolls, and clipped the ring drawn outside it. The summary names the first ten selected databases and counts the rest. Reviewing the selection ("Review selected", or "+N more") lists only the databases selected when the review started, so one unchecked there stays in place until "Show all entries".
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
  - `at=<anchor>`: a row (`files:<path>`, `folders:<path>`, `archives:<id>`, `archives:<id>:files:<path>`, `archives:<id>:folders:<path>`, `collisions:<path>`), a section (`database`, `filter`, `files`, `archives`, `collisions`, `issues`), `install`, the install dialog of a database shown alone, `install-all`, the install dialog of every loaded database, the explorer (`explorer` at the SD card, `explorer:<path>` at a folder, or at a file's folder with its details shown; see 15), or the filter terms (see 16): `terms`, those of FILTER (or of the shared filter), or `terms:<db_id>`, those of a combined database's own filter, either followed by `?<search>` while the dialog's search holds something (`terms:jtcores?arcade+games`). Everything after the first `?` is the search, so a db_id there cannot hold one. `tags`, which named the section that listed the terms before, opens them as `terms` does. Combined databases put the db_id before an archive's id (`archives:<db_id>:<id>`); reading it matches the loaded db_ids, longest first, since a db_id can hold a colon.
- Only `%`, `&`, `+`, `=`, `#`, whitespace, control and non-ASCII characters are escaped, and `"`, `<`, `>` and `` ` ``, which browsers escape in an address themselves; a space is written as `+`. URLs and filters stay legible: `#db=https://example.com/db.json&filter=arcade+!cheats`.
- A link stays readable while the whole address is at most 2,000 characters (`LINK_READABLE_MAX`, Discord's message limit); past that, every key but `at` is packed into `z=<data>`: the readable text, raw deflate (fflate, no preset dictionary), in base64url without padding. Packed keys read as if they were written in place of `z`; a `z` inside one is ignored, and unpacking stops past 1 MiB.
- Unknown keys are ignored. A `z` that cannot be unpacked shows "This link is damaged, so what it names could not be opened." and opens nothing; the next write replaces the link. Broken escapes never throw.
- Writes change the link only when what it says changes (compared on the readable text, so a packed or reordered link is not rewritten for nothing), in a new history entry only when the flow asks for one. The rest of the address, such as an unknown query, is kept.
- One `db` is shown alone; several, or one with an own filter, are combined (`isCombinedLink`). When only one of combined databases has a URL, the link names it alone, so it keeps the filter it gets among the others as its own filter whenever FILTER would differ without it (`buildCombinedLink`); opening that link shows it alone with that filter.
- The model reads the link's `filter` when a new source arrives (`filterSync`), and writes that keep FILTER keep it in the link, so an emptied FILTER carries over to the next database opened. Keep that coupling when changing writes.
- A link typed in the address bar of the open page (another `#` of the same page) does not load the page again: the browser fires popstate, and the app opens the link as it does on back and forward.
- Clear (Clear database, or Clear databases, in the Databases header) asks first, then loads the page again at its address without the link (`openStartPage`), rather than resetting the model's state: nothing of the session can linger (FILTER, own filters, uploads, the databases the catalog gained during the session, open dialogs). Leaving a link, it is a new history entry, so Back opens the databases again.
- `install_all()`, in the browser's console, opens an install dialog no button opens (`InstallAllModal`), for every loaded database at once: a ZIP with a `downloader.ini` that lists each database loaded from a URL, in the page's order, shown as it is written. Uploaded databases have no URL to install from; they are left out, and named. With the current filters, the file holds them as downloader.ini does (`src/lib/downloaderIni.js`): the shared filter in `[mister]` and each database's own filter in its section, a set filter even when empty; a database alone has FILTER as its own filter when it differs from its default, as it keeps it when a second database joins. So, opened as any downloader.ini is, it gives each database the filter it had. The explorer and the terms make way for it, and its link is `at=install-all`, which a packed link keeps outside what it packs.
- Old links: on start, `?database-url=<url>` becomes `#db=<url>` (`rewriteOldLink`, in `createAppModel`), as the Inspect links of the MultiDatabases README are written. Nothing else of the old format is read: its `filter`, `detailed`, `database-url[<db_id>]`, `filter[<db_id>]`, and `#` anchors are dropped. The MultiDatabases catalog reads an Inspect link's database from `?database-url=` or from `#db=`.

### 13. Phone Screens

Nothing on the page, or in its dialogs, should be wider than a phone screen, down to 320px. Long db_ids, paths, messages and tag names wrap, or are cut short with the full text in a tooltip:

- Rows: on phones (720px and narrower), a row is its name until a tap shows its details, with its database under its name (6). A folder's tags take one line, as many as fit (6); four used to wrap onto up to five lines, and jtcores' tree at 360px became 36% shorter. A file leaves its tags to its details, as on every screen 960px and narrower (6).
- Issues: on phones, the message takes a line of its own, and the db_id and context wrap.
- Path collisions: on phones, the pill's databases go under its label, and the pill keeps round corners rather than round ends.
- Combined databases: card headings and compact rows break a db_id after `_` and `/` (`breakableId` in `CombinedOverview.jsx`), and the cards' grid never asks for a column wider than the page.
- The Databases header: 960px and narrower, where it stacks, the Detailed toggle, Install and Clear wrap. With one database, Detailed and Install alone ran 10px into the panel's padding at 360px; with Clear too, they reached 110px past the screen.
- FILTER: the section's one column is its width (`minmax(0, 1fr)`). db_ids and filter terms wider than the line wrap. The own-filter picker's list is as wide as the panel allows (up to 36rem); its db_ids wrap, and a database's filter goes under its db_id when they do not fit side by side. Under a FILTER box (960px and narrower), Terms and Clear share its width; on phones a database's own filter puts Terms and Remove under its box, which keeps the line's width.
- Filter terms (16): a term's names, its db_ids and FILTER wrap, and on phones Keep and Exclude go under the term's names.
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
- The dialog holds a bar and the folder's contents. The bar has Back, Forward and Up, a button that switches between medium icons, the view it opens in, and the list (it shows the view it switches to; choosing the list is remembered in this browser, `localStorage`, `inspector-explorer-view`: `list`, and choosing the icons forgets it), a bar, the path from the SD card (each folder above goes there; the first ones fold into … when they do not fit, and the folder shown is cut short instead of folding), and the close button.
- Entries are listed folders first, then files, each by name. A row is an icon, the name and the size; a name cut short keeps its end (its extension and the nine characters before it, a core's `_20240525.rbf`). An icon's name takes two lines, breaking between words, and a second line that does not fit keeps the name's end; the lines are measured with a canvas in the name's font.
- A click selects an entry and shows its details, beside the list or, on phones, from the bottom: a file's path, where it comes from (the database's files, or an archive, after its database when combined), its hash, tags, URL, and OPEN and Download as on tree rows; a folder's files and size, where it is declared, its tags and Open folder; each version of a path several install. A double click goes into a folder; on a touch screen, where there is no double tap, a tap does, and a folder's info button shows its details. The keyboard: the arrows, Home and End select (by rows and columns in the icons), Enter goes into a folder or shows a file's details, Backspace and Alt+↑ go up, Alt+← and Alt+→ go back and forward, and Escape closes the path's menu, then the details, then the explorer.
- Its link: `at=explorer` while it shows the SD card, `at=explorer:<path>` for a folder, or for a file whose details are shown (12). Each move replaces the anchor rather than adding a history entry, as the other anchors do: the model opens what the link names on every back and forward (11), which would load the database again for each folder, so the explorer keeps its own history of folders for Back and Forward, and the browser's back and forward still move between what the page has open. Closing takes the anchor out of the link. A link opens it where it names, or at the deepest folder still there when a filter hides the rest; it opens again where it was left until another database is shown.
- An image's details show it under OPEN and Download (`getImagePreviewUrl` in `src/lib/downloads.js`): a file with a URL whose extension OPEN shows as an image (png, jpg, gif, webp, bmp, svg, avif, ico, apng, in any letter case), each version of a path several install with its own. It loads from the file's URL as OPEN does, without a referrer, only once the details show it; an `<img>` needs no CORS, and raw.githubusercontent.com allows other sites to show its images. It is as wide as the details at most and at most 22rem tall, never larger than itself, on the theme's quiet background for transparent images; "Loading preview…" stands in until it has loaded, and "The preview could not be loaded." when it cannot. The tree rows' details show no preview: it would change their heights, which the virtual tree measures (6).
- While it is open, find-in-page stands aside (Ctrl+F is the browser's own, and Escape is the explorer's), and a dialog over it (a failed download) keeps the keys.
- The details and the double click (`EXPLORER_DETAILS_DELAY_MS`):
  - A click selects at once, but while the details are closed they wait 300 ms, the time of a double click, before coming up. They take the list's width, which changes the icons' columns, so coming up at once moved the icons under the second click of a double click. A double click that goes into a folder in that time never brings them up. A double click slower than the wait lets the first click's details come up, and going in takes them away again; details already up before the double click stay, showing the folder gone into.
  - Once up, they show whatever is clicked at once (nothing moves then), and they stay while folders change. Enter, the info button, a double click on a file, a tap and a link show them without waiting.
  - They slide in from the right in 200 ms (`--explorer-motion`): their place widens from nothing while they keep their own width (`--explorer-details-width`, 352px), so they do not reflow on the way; on phones they come up from the bottom over the list, which keeps its width. Closed, they stay in the page, hidden (`aria-hidden`, `inert`), so they can slide out too.
  - Each icon is placed on its own (`transform`), so when the columns change the icons glide to their new places in the same 200 ms. They are laid out at once for the width the list will have when the details are in or out, so they glide while the details slide, rather than follow the list's width frame by frame. They glide only once the list has its width, never from where they are first drawn, and nothing moves for visitors who ask for less motion (`prefers-reduced-motion`).
- Rows, and rows of icons, have one height each, set in `app.css` (`--explorer-row-height` and the tile sizes, taller on phones), so the list renders only those in view and places them by their index (`explorerWindow`). None of the tree's measurement and scroll anchoring (6) is involved.

### 16. Filter Terms

The terms a FILTER can use are the tags of the databases it applies to. They used to be listed in a Filter terms section at the bottom of the page, each tag dictionary in a group of its own: far from FILTER, below every tree; repeated for each combined database; with each tag dictionary's numbers, which read as counts (bios_db's `famicom 0 · nes 0 · nintendo 0` is one tag with three names); and saying "No tag dictionary was provided" for databases whose entries carry tags by name, which FILTER can use too. They are now a dialog opened beside each FILTER box (`FilterTermsModal`, built by `buildFilterTerms` in `src/lib/filterTerms.js`).

- The Terms button beside a FILTER box opens its terms: FILTER's for a database alone; with combined databases, every database's for the shared filter, and one database's for its own filter.
- A term is a tag with all its names (the dictionary's aliases, compared as FILTER compares them: lowercase, without `_` and `-`), merged across databases where tags share a name, since a FILTER term matches every tag with that name. The name written is the one most of its databases know it by, else the shortest (nes rather than famicom or nintendo). Each term counts the files, folders and archive entries tagged with it, before any filter, and the most used are listed first (terms used as much, by name); when combined, each names its databases (more than three as a count, with them all in its tooltip). A tag's number in the dictionary is in its name's tooltip, for database authors. Tags nothing uses are terms too, since FILTER accepts them; tags whose names FILTER cannot hold (spaces, `none`, a number the dictionary does not have) are not. Combined databases without terms are named in one line.
- Keep writes the term in its FILTER box, Exclude writes it with `!`, and choosing what is already there takes it out; the button shows when the term is there, by any of its names. The box's other terms stay as written, in their order. The change goes through the box as typing does: FILTER's debounce and its link.
- A database's own filter can include the shared filter, as the `[mister]` term in it does: a checkbox names the shared filter's terms, and writes `[mister]` first in the box, or takes every `[mister]` out, the other terms staying as written. It is checked while the box has `[mister]`, however it got there. It is a line at the bottom, above FILTER, since the bottom stays on screen while the terms scroll, and sits by the FILTER it changes. While the shared filter has no terms there is nothing to include, and the line is not there.
- At the bottom, the box's FILTER and how many files it matches of all the files the loaded databases list, before any filter (archive entries included, a path several combined databases install once, as the page counts them; `countLoadedFiles` in `views.js`): "Matches 4 of 21,514 files", with every database's filter applied. That total is counted after the dialog is on screen, which says "Counting matches…" until then, and kept while the same databases are loaded. Combined databases' total does not combine their views: `countCombinedFiles` (`combine.js`) applies the collision rule of `combineDatabaseViews`, which the tests compare it with, but looks up which databases need a folder at a path once rather than in every database for every file. Combining 148 databases took about 430 ms of the 830 ms the dialog took to open; with this, it opens in about 120 ms. While FILTER settles (its debounce), it says "Counting matches…"; a FILTER that is not valid matches everything, and says so.
- A search box finds terms by any of their names, as typed or as FILTER compares them. It draws its focus ring inside its border: the dialog's body scrolls, and would clip a ring drawn outside it. Done, Escape or a click outside close the dialog; while it is open, find-in-page stands aside, as for the explorer.
- It is compact: a term's names, entries and databases share a line when they fit, beside small Keep and Exclude buttons.
- Of a long list (1,376 terms with the whole catalog loaded), the browser lays out only the terms on screen (`content-visibility: auto` on each term, holding a row's height when skipped): laying them all out took about 175 ms.
- Find-in-page no longer finds terms, since they are not on the page.
- The open dialog is in the page's link (12), so a link can open it: `at=terms`, or `at=terms:<db_id>` for a database's own filter, with `?<search>` while its search holds something. Opening it writes the anchor, closing it takes it out, and its search reaches the link once typing pauses (FILTER's debounce, without the search's leading and trailing spaces, which find the same terms), so a pasted link opens the same terms, searched the same way. A link to the terms of an own filter the database does not have opens the shared filter's, and the link says so. When a link opens the terms again (Back to another database's), the dialog opens afresh with that link's search; the dialog tells only searches that change, so one it opens with never overwrites a link that has moved on. The `tags` anchor of old links opens the terms of FILTER (or of the shared filter).

