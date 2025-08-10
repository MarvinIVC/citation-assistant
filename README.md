# Citation Assistant

Generate MLA 9, APA 7, and Chicago (Author–Date) citations from:
- URL (serverless metadata fetching)
- DOI (Crossref)
- ISBN (Open Library)
- Manual entry

Features:
- Style switching (live)
- Copy single or export all
- Local storage persistence
- Clean, responsive UI

## Quick start (Netlify)

1. Create a new GitHub repo and add these files.
2. Push to GitHub.
3. In Netlify:
   - New site from Git
   - Pick your repo
   - Build command: (leave empty)
   - Publish directory: `/` (root)
4. Deploy.

Functions:
- The `urlMeta` serverless function is auto-detected via `netlify/functions/urlMeta.js`.
- No environment variables required.

Local dev:
- `npm i -g netlify-cli` (optional)
- `netlify dev` to run the site + functions locally.

## Notes

- DOI fetching uses Crossref public API (no key).
- ISBN fetching uses Open Library public API (no key).
- URL metadata fetching happens through a Netlify Function to avoid CORS and to parse HTML/JSON-LD.
