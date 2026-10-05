# References

These are the main references that shaped the implementation.

## Repo References

- `README.md`
  - High-level app scope and deployment model.
- `src/lib/database.js`
  - Canonical parsing and inspection behavior.
  - Supported source types: `.json`, `.json.zip`, `.ini`, `.ini.zip`, and ZIP containers.
  - Archive summary handling, legacy compatibility, and URL resolution rules.
- `src/model/appModel.js`
  - The app's state and every flow that changes it: loading sources, combining databases, FILTER and the page's link, the catalog, and the questions asked along the way.
- `src/App.jsx`
  - The page: renders the model's state, forwards user actions to it, and keeps what only the page needs.
- `src/lib/filterDefaults.js`
  - Default `FILTER` precedence, following Downloader's `build_db_config`: INI entry filter, then database default (only when `[mister]` sets no filter or the default inherits `[mister]`), then `[mister]`.
- `src/lib/combine.js` and `src/lib/combinedFilters.js`
  - Combining several databases' filtered views and finding their path collisions; the filters of combined databases.
- `src/lib/catalog.js`
  - Session catalog entries and their merge over the runtime catalog.
- `src/lib/selection.js` and `src/components/modals/DatabasePickerModal.jsx`
  - Choosing several databases at once: one per `db_id`, the Update All defaults, and the picker shared by the catalog, database lists, and uploads.
- `src/lib/uploads.js`
  - Uploads of several files or folders: which files count, walking dropped folders, identical files, and where each database came from.
- `src/components/tree/` with `src/lib/treeIndex.js`, `src/lib/treeLayout.js` and `src/lib/tagFit.js`
  - Tree rendering, flat row indexes, the virtualization layout math, and how many tags fit on a row's line.
- `tests/unit/flows/`
  - Every user flow at the model level: one file per legacy end-to-end spec, with one unit test per legacy end-to-end test under the same title, run against the app model and the plain modules.
- `tests/unit/filtering.test.js`
  - Port of the core Downloader filter expectations into fast JS unit tests against the inspector's filter engine.
- `tests/unit/filter-defaults.test.js` and `tests/unit/tree-index.test.js`
  - Default filter precedence rules and tree row index structure.
- `tests/component/`
  - Component tests (Vitest, jsdom, Testing Library): what each component shows and which handler each control calls, and the whole page wired to the model (`page.test.jsx`).
- `tests/journeys/`
  - The end-to-end journeys (Playwright): five long user flows through a real browser, and an opt-in one over the live Distribution_MiSTer database.
- `tests/*.spec.js`
  - The legacy end-to-end suite, skipped unless `LEGACY_E2E=1`. Its coverage moved to the layers above; it is kept for reference.
- `playwright.config.js` and `vitest.config.js`
  - Browser test and component test configuration.

## Upstream / Domain References Encoded In The App

These are not vendored as docs in the repo, but the app explicitly depends on them as live formats or sources.

- `Update_All_MiSTer` catalog source
  - Encoded in `src/lib/database.js` as `UPDATE_ALL_DATABASES_SOURCE_URL`.
  - Used at runtime to build the known-database catalog by parsing `databases.py`.
- Real MiSTer Downloader database conventions
  - Reflected in `src/lib/database.js` support for:
    - `db_id`, `timestamp`, `files`, `folders`, `archives`
    - `tag_dictionary` and legacy `tags_dictionary`
    - `summary_inline` and `summary_file`
    - legacy ZIP/archive variants and path validation rules
- Custom database format spec
  - `https://github.com/MiSTer-devel/Downloader_MiSTer/blob/main/docs/custom-databases.md`
  - Defines the `downloader.ini` `db_url` wiring plus the expected JSON database structure that this inspector parses and displays.
- Downloader's database checks
  - `https://github.com/MiSTer-devel/Downloader_MiSTer/blob/main/src/downloader/db_entity.py`
  - What Downloader accepts as a database (`isDownloaderDatabase`), used to pick the databases out of uploaded folders. Downloader also lowercases `db_id`; the inspector compares `db_id`s exactly.
- `Distribution_MiSTer`-style data
  - The parser and path validation rules are clearly designed around real MiSTer distribution databases.
- gh-proxy.com
  - Encoded in `src/lib/database.js` as `GITHUB_RELEASE_PROXY_URL`: the public mirror that GitHub release downloads are read through when reading them directly fails (see [design.md](design.md), Important Technical Decisions, 1).
- Downloader filter behavior
  - `https://github.com/MiSTer-devel/Downloader_MiSTer/blob/main/docs/download-filters.md`
  - `https://github.com/MiSTer-devel/Downloader_MiSTer/blob/main/src/test/unit/online_importer/test_online_importer_with_filters.py`
  - These define the expected positive/negative filter semantics, `all` / `!all` handling, tag normalization, database-scoped filter inheritance syntax, and the special `essential` behavior that the inspector mirrors.
