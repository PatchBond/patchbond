# One service for the whole app: the API, the GitHub webhook, sign-in and the built web app.
#   docker build -t patchbond .
#   docker run -p 8787:8787 --env-file .env -v patchbond-data:/data patchbond
# Configure it with environment variables (docs/DEPLOY.md); never bake secrets into the image.

FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
COPY mcp/package.json mcp/
RUN bun install --frozen-lockfile
COPY shared shared
COPY server server
COPY web web
COPY deploy deploy
RUN cd web && bun run build

FROM oven/bun:1
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
# Verdict records, submissions and sessions (SQLite). Mount a volume so they survive deploys.
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data
EXPOSE 8787
USER bun
CMD ["bun", "server/src/index.ts"]
