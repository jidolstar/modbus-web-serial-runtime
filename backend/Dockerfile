FROM node:22-alpine AS development

WORKDIR /workspace/backend

COPY common/device-catalog-domain /workspace/common/device-catalog-domain
COPY backend/package*.json ./
RUN npm ci

COPY backend .

EXPOSE 3000

CMD ["npm", "run", "start:dev"]
