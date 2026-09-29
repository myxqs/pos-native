FROM node:24.18.1-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm run build

FROM node:24.18.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY apps/web ./apps/web
COPY packages/database/drizzle ./packages/database/drizzle
RUN mkdir -p /var/lib/nativepos/assets && chown -R node:node /var/lib/nativepos
USER node
EXPOSE 3000
CMD ["node", "dist/apps/api/src/server.js"]
