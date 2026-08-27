# The one dev image behind `packages-watch`, `api` and `web`. Source arrives at
# runtime through `docker compose watch`, so this image only has to be the
# workspace with its dependencies installed for Linux.
#
# Debian, not alpine: the platform-native binaries this workspace pulls in
# (rolldown, esbuild, @tailwindcss/oxide) resolve cleanly on glibc.
FROM node:24-slim

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

# Pin pnpm's content-addressable store to an absolute path, so the layer that
# warms it and every install that spends it are provably the same store. Left
# unpinned, pnpm derives the location from the project's filesystem, and the day
# anything is mounted over /app the store moves out from under an offline
# install — which fails as ERR_PNPM_NO_OFFLINE_TARBALL rather than as anything
# that names a mount.
ENV npm_config_store_dir=/pnpm/store/v10

# Warm the store from the lockfile alone: `pnpm fetch` reads only this file, so
# there is no hand-kept list of per-package manifests to fall out of date and
# silently drop a newly added package. The layer stays cached until a dependency
# changes, which is what makes a source edit free.
COPY pnpm-lock.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline

# The shared @sloppy/* packages are deliberately NOT built here. `packages-watch`
# builds them into the volumes all three services share, so there is one copy,
# always fresh, and a new package under packages/ts needs no wiring in this file.

EXPOSE 8030
