# Multi-stage build for the Next.js static-export SPA.
#
# Stage 1 (node): npm ci + next build (output: 'export') → /app/out.
# Stage 2 (nginx-alpine): serves /out on port 80 with the SPA fallback
# rules from frontend/nginx.conf (any unknown URL → /__shell__.html).

# --- build ---------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
# NODE_ENV=production triggers `output: 'export'` (see next.config.ts).
ENV NODE_ENV=production
# Bake the backend URL into the static JS bundle. NEXT_PUBLIC_* env vars
# are inlined at build time, so the SPA can find the backend regardless
# of where it's hosted. Override with `--build-arg API_BASE_URL=...`.
ARG API_BASE_URL=http://localhost:5001
ENV NEXT_PUBLIC_API_BASE_URL=$API_BASE_URL
RUN npm run build

# --- runtime -------------------------------------------------------------
FROM nginx:alpine AS runtime
WORKDIR /usr/share/nginx/html

# Drop the default site so our SPA-fallback config is the only one loaded.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/out /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
