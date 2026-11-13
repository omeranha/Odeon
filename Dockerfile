FROM node:24-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app/server
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/dist
# ffmpeg and chromaprint (fpcalc) convert and verify the lossless copies used by the quality upgrade tool.
RUN apk add --no-cache ffmpeg chromaprint
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=web /app/dist /app/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "src/index.ts"]
