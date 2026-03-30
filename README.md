# MiSTer Custom Database Inspector

Open the app on GitHub Pages:

https://theypsilon.github.io/DB-Inspector_MiSTer/

This is a small static React app for inspecting MiSTer custom downloader databases, including:

- Local `.json` and `.json.zip` uploads
- Remote database loading from URL
- Archive summary inspection
- File, folder, and archive tree rendering
- Tag index resolution through `tag_dictionary`

## Local Development

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Build the static site:

```bash
npm run build
```

## Deployment

GitHub Actions deploys the app to GitHub Pages on every push to the `main` branch.
