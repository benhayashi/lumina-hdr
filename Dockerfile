# LuminaHDR Standalone Docker Container
FROM node:22-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source code and scripts
COPY . .

# Run initial LuminaSync to ensure theme is current
RUN node scripts/sync-lumina.js || true

# Default mount points
RUN mkdir -p /photos /app/data
ENV PHOTOS_DIR=/photos
ENV PORT=8080
ENV HOST=0.0.0.0
ENV DOCKER=true

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/api/stats || exit 1

ENTRYPOINT ["node", "src/server/app.js", "/photos", "--host", "0.0.0.0", "--port", "8080", "--no-open"]
