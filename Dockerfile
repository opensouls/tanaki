FROM oven/bun:1.2.23 AS base
WORKDIR /app

ENV NODE_ENV=production
ENV CI=true
ENV HF_HOME=/app/.cache/huggingface
ENV TRANSFORMERS_CACHE=/app/.cache/huggingface

# Install deps for all packages (workspace install)
FROM base AS deps
COPY package.json bun.lock ./
COPY opensouls/package.json opensouls/
COPY opensouls/packages/core/package.json opensouls/packages/core/
COPY opensouls/packages/engine/package.json opensouls/packages/engine/
COPY opensouls/packages/soul/package.json opensouls/packages/soul/
COPY opensouls/packages/react/package.json opensouls/packages/react/
COPY opensouls/packages/pipeline/package.json opensouls/packages/pipeline/
COPY opensouls/packages/cli/package.json opensouls/packages/cli/
COPY opensouls/packages/soul-engine-cloud/package.json opensouls/packages/soul-engine-cloud/
# `soul-engine-cloud` depends on `soul-engine` via `file:./frozen-npm/soul-engine`,
# so we must include that directory in the build context before `bun install`.
COPY opensouls/packages/soul-engine-cloud/frozen-npm/soul-engine/ opensouls/packages/soul-engine-cloud/frozen-npm/soul-engine/
COPY packages/tanaki-speaks/package.json packages/tanaki-speaks/
COPY packages/tanaki-speaks-web/package.json packages/tanaki-speaks-web/
RUN bun install

# Build, warm caches, and prepare soul + frontend
FROM deps AS builder
COPY . .

WORKDIR /app/opensouls/packages/soul-engine-cloud
RUN bunx --bun prisma generate

# Warm up the embedding model cache (downloads HuggingFace model into HF_HOME)
RUN bun -e "import { pipeline } from '@huggingface/transformers'; await pipeline('feature-extraction', 'mixedbread-ai/mxbai-embed-xsmall-v1');"

# Build web frontend (TanStack Start/Nitro output)
WORKDIR /app/packages/tanaki-speaks-web
RUN bun run build

# Runtime image
FROM base AS runner
WORKDIR /app

COPY --from=builder /app /app

# Ensure runtime data dir exists (pglite + code storage)
RUN mkdir -p /app/data /app/data/pglite

WORKDIR /app/packages/tanaki-speaks-web
EXPOSE 3002
EXPOSE 9091

CMD ["bash", "/app/packages/tanaki-speaks-web/start.sh"]


