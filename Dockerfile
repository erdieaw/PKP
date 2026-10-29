FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY index.html tsconfig.json vite.config.ts postcss.config.js tailwind.config.js bg.png ./
COPY src ./src
ENV VITE_API_BASE_URL=/api/v1
RUN bun run build

FROM nginxinc/nginx-unprivileged:stable-alpine AS frontend-base
COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080

FROM frontend-base AS dokploy
COPY --chown=nginx:nginx deploy/nginx.dokploy.conf.template /etc/nginx/templates/default.conf.template

FROM frontend-base AS runtime
