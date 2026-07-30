FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
COPY config ./config
COPY migrations ./migrations
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache openssl postgresql16-client
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY config ./config
COPY scripts/backup ./scripts/backup
USER node
EXPOSE 8080
CMD ["npm", "start"]
