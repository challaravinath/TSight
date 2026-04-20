# TSight Dockerfile
# Build and run with:
#   docker build -t tsight .
#   docker run -p 3000:3000 -v "C:\YourCode:/code" tsight

FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/api/package.json ./packages/api/
COPY packages/web/package.json ./packages/web/

# Install dependencies
RUN npm install

# Copy source code
COPY packages/core ./packages/core
COPY packages/api ./packages/api
COPY packages/web ./packages/web

# Build everything
RUN npm run build --workspace=@tsight/core
RUN npm run build --workspace=@tsight/api
RUN npm run build --workspace=@tsight/web

# Expose port
EXPOSE 3000

# Start command (serves both API and built web UI)
ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV TSIGHT_WORKSPACE_ROOT=/code

CMD ["node", "packages/api/dist/index.js"]
