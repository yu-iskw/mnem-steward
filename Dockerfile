FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @enterprise-memory/core --filter @enterprise-memory/auth --filter @enterprise-memory/google-memory --filter @enterprise-memory/gateway build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN useradd --system --uid 10001 --create-home memgw
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
USER memgw
EXPOSE 8080
CMD ["node", "packages/gateway/dist/main.js"]
