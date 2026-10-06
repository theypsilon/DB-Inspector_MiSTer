# MiSTer Custom Database Inspector

Check it in your browser:

https://theypsilon.github.io/DB-Inspector_MiSTer/

**Note:** Desktop (PC/Mac) is recommended over mobile.

This is a small App for inspecting MiSTer custom downloader databases, including:

- Local `.json` and `.json.zip` uploads
- Remote database loading from URL
- Archive summary inspection
- File, folder, and archive tree rendering
- Filtering with tags
- Combining several databases, with the paths they share listed as collisions
- Choosing several databases at once from the catalog or a `downloader.ini` list
- Uploading several files or whole folders, and choosing among the databases they hold

## Linking to a database

Link to a database by putting its URL after `#db=`:

https://theypsilon.github.io/DB-Inspector_MiSTer/#db=https://raw.githubusercontent.com/MiSTer-devel/Distribution_MiSTer/main/db.json.zip

A database of the catalog can be named by its `db_id` instead, which is shorter to write by hand. When several databases of the catalog share that `db_id`, the first one opens:

https://theypsilon.github.io/DB-Inspector_MiSTer/#db=jtcores

The address follows what you see (the databases, the filter, and the section or row you link to), so you can copy it from the address bar to share the view. Links from older versions, `?database-url=<url>`, still open their database.

## Code Quality

This project was vibe-coded from start to finish. It is finished, self-contained, and does its job. It is not expected to be maintainable. Without that compromise, this tool could not exist.

## Issues

Some bugs related to tree virtualization may occur, such as scroll stuttering in mobile, but as long as the overall UX is preserved, fixing them is not a priority.
