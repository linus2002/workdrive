# syntax=docker/dockerfile:1
#
# WorkDrive: production image (Coolify-ready).
#   Stage 1 builds the app with Node; stage 2 serves the static files with nginx (non-root, port 8080).
#   Build locally:  docker build -t workdrive .
#   Run locally:    docker run --rm -p 8080:8080 workdrive   ->  http://localhost:8080
#   Coolify:        Build Pack "Dockerfile", Ports Exposes 8080, Health check path /healthz (see DEPLOY.md).

# ---------- 1. Build ----------
FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so this layer is cached until package*.json change.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Set to "true" (Coolify: Build Variable RUN_CHECKS=true) to stop the deploy if lint or the unit tests fail.
ARG RUN_CHECKS=false
RUN if [ "$RUN_CHECKS" = "true" ]; then npm run lint && npm test; fi

RUN npm run build

# ---------- 2. Serve ----------
# nginx-unprivileged runs as a non-root user (uid 101) and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY deploy/nginx/embed-headers.conf /etc/nginx/snippets/embed-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1
