# Single install, in one stage. The runtime stage never runs npm, so there is no
# second resolution that can disagree with the first — and the native libsql
# binary is the Linux one installed here, not something re-fetched later.
FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drops devDependencies from the tree we are about to copy across.
RUN npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app

# package.json carries "type": "module" — without it Node reads the build as
# CommonJS and every import fails.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# The SQLite file lives on a Fly volume mounted here, so it survives deploys.
RUN mkdir -p /data

EXPOSE 3000

# Migrations run at boot, so a fresh volume works with no extra step.
CMD ["node", "dist/src/index.js"]
