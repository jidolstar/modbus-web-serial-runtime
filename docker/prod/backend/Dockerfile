FROM node:22-alpine AS build

WORKDIR /workspace/backend

COPY common/device-catalog-domain /workspace/common/device-catalog-domain
COPY backend/package*.json ./
RUN npm ci

COPY backend .
RUN npm run build

FROM node:22-alpine

WORKDIR /workspace/backend

COPY common/device-catalog-domain /workspace/common/device-catalog-domain
COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /workspace/backend/dist ./dist

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/main.js"]
