# Deploying WorkDrive with Coolify

WorkDrive ships as one Docker image. Node builds the app, then **nginx** (non-root, port **8080**) serves the static
files. The image has no database and no backend. Coolify's proxy (Traefik or Caddy) sits in front and handles the
domain and HTTPS.

> **Read this first: data lives in each browser.** This build has no server-side storage yet. Every person's files,
> shares and settings are saved in their own browser (localStorage and IndexedDB), so two employees don't see the same
> drive. Clearing browser data loses that person's files. Deploying the image makes the app reachable at your domain;
> a shared, backed-up drive needs the backend described in the audit.

## Files

| File | What it does |
|---|---|
| `Dockerfile` | Two stages: `node:22-alpine` runs `npm ci` and `npm run build`, then `nginx-unprivileged:1.27-alpine` serves `dist/` |
| `deploy/nginx/default.conf` | Site config: single-page-app routing, caching, `/healthz`, gzip |
| `deploy/nginx/security-headers.conf` | Content-Security-Policy and other security headers for every page and file |
| `deploy/nginx/embed-headers.conf` | The same for `/embed/…`, which other sites may show in an iframe |
| `.dockerignore` | Keeps `node_modules`, `.git`, `.env*` and local files out of the build |
| `vite.prod-preview.config.js` | `npm run preview:prod` serves the production build locally with the same security headers |

## Set up in Coolify

1. **New Resource → Application**, then pick the Git repository (GitHub App, deploy key or public URL) and the branch to deploy.
2. **Build Pack:** `Dockerfile`. Base directory `/`, Dockerfile location `/Dockerfile`.
3. **Network → Ports Exposes:** `8080`. Leave "Ports Mappings" empty; the proxy routes to the container.
4. **Domains:** your domain with `https://`, e.g. `https://drive.example.com`. Coolify gets the Let's Encrypt
   certificate. Point the domain's DNS **A record** at your server first.
5. **Health check:** enable it, path `/healthz`, port `8080`. The image also has its own Docker `HEALTHCHECK`.
6. *(Optional)* **Build Variable** `RUN_CHECKS=true` stops a deploy when lint or the unit tests fail. It adds about a
   minute to each build.
7. **Deploy.** For automatic deploys on every push, turn on the webhook / auto-deploy for the branch.

No environment variables are needed at runtime.

## Test the image before deploying

```bash
docker build -t workdrive .
docker run --rm -p 8080:8080 workdrive
# open http://localhost:8080, and check http://localhost:8080/healthz returns "ok"
curl -sI http://localhost:8080/ | grep -i content-security-policy
```

Without Docker, `npm run build && npm run preview:prod` serves the same build with the same security headers at
http://localhost:4180. Use it after changing the headers or adding anything that loads from another site.

## What the server does

- **Routing:** every app path (`/folders/123`, `/link/abc`, `/sign/…`) returns `index.html`, so links work when
  opened directly or reloaded. Missing files under `/assets/` return a real 404, never the app page; otherwise the
  offline service worker could cache the page as a script.
- **Caching:** `/assets/*` files have content hashes in their names and are cached for a year. `index.html`,
  `sw.js`, `manifest.webmanifest` and `/.vite/manifest.json` are always re-checked, so a new deploy reaches people on
  their next visit, and the installed app shows "Update available".
- **Security headers:** Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy and HSTS (honoured over HTTPS). `/embed/…` may be framed by any site. Other pages may only be
  framed by WorkDrive itself.
- **Hardening:** runs as a non-root user, hides the nginx version, refuses dotfiles (`.git`, `.env`), and limits
  request bodies to 1 MB (nothing is uploaded to this server).

### Outside services the app uses

The security policy allows only these. Anything new that loads from another site has to be added to **both** header
files.

| Host | Used for |
|---|---|
| `fonts.googleapis.com`, `fonts.gstatic.com` | Poppins and the handwriting fonts for signatures |
| `cdn.jsdelivr.net` | The text-recognition (OCR) engine and its English language data, downloaded the first time an image or scanned PDF is indexed |

Files never go to these services. Only the fonts and the OCR engine are downloaded from them. To host them yourself
(for example on a network without internet access), copy them into `public/` and point the app at them. After that,
the two hosts can be removed from the policy.

## Updating

Push to the deployed branch (or click **Redeploy**). Coolify builds the new image and swaps it in once the health
check passes. People get the new version on their next visit; an open, installed app shows "Update available —
Reload".

## Verified so far

- The production build ran with these exact security headers (via `npm run preview:prod`). With them in place, the
  following all worked with no policy violations and no failed requests: sign-in, fonts, PDF thumbnails and previews,
  video frames, Word and Markdown previews, OCR search on an uploaded image, the two-factor QR code, and printing a
  link's QR code.
- `/embed/` pages and the nginx config itself were **not** run here, because Docker isn't installed on the machine
  this was prepared on. Run the `docker build` / `docker run` test above once before the first deploy.
