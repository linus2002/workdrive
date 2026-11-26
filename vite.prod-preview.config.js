// `npm run preview:prod`: serves the production build (run `npm run build` first) on http://localhost:4180 with the
// same security headers the production server sends (read from deploy/nginx/security-headers.conf), so changes that
// the Content-Security-Policy would block show up locally, without Docker.
import { defineConfig } from 'vite';
import fs from 'node:fs';
import base from './vite.config.js';

const conf = fs.readFileSync('deploy/nginx/security-headers.conf', 'utf8');
const headers = {};
for (const m of conf.matchAll(/^add_header\s+([\w-]+)\s+"([^"]*)"/gm)) headers[m[1]] = m[2];

export default defineConfig({ ...base, preview: { port: 4180, strictPort: true, headers } });
