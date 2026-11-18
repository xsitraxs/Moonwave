# No packages to install: Node 24 runs the TypeScript itself and has SQLite built in.
# Pinned by tag and digest, so a rebuild gets exactly this image; Dependabot (.github/dependabot.yml) proposes updates.
FROM node:24.22.2-alpine3.24@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
WORKDIR /app
# copy as the runtime user so the files aren't owned by root inside the image
COPY --chown=node:node src ./src
ENV NODE_ENV=production DATA_DIR=/data PORT=8080 NODE_NO_WARNINGS=1
# the data volume starts out as this folder: owned by the user the API runs as
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 --start-period=15s \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/ || exit 1
CMD ["node", "src/main.ts"]
