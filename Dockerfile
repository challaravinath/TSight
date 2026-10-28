# Build:  docker build -t tsight .
# Run:    docker run -p 127.0.0.1:3000:3000 -v "/path/to/your/code:/code" tsight
# Then open http://localhost:3000 and enter /code/your-project

FROM node:22-alpine

# git is needed for the history views (churn, ownership, bus factor).
RUN apk add --no-cache git \
 && git config --system --add safe.directory '*'

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/api/package.json ./packages/api/
COPY packages/web/package.json ./packages/web/
RUN npm ci

COPY packages/core ./packages/core
COPY packages/api ./packages/api
COPY packages/web ./packages/web
RUN npm run build

ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV TSIGHT_WORKSPACE_ROOT=/code
EXPOSE 3000

CMD ["node", "packages/api/dist/index.js"]
