FROM node:22-alpine AS development

WORKDIR /workspace/frontend

COPY common/device-catalog-domain /workspace/common/device-catalog-domain
COPY frontend/package*.json ./
RUN npm ci

COPY frontend .

EXPOSE 5173

CMD ["npm", "run", "dev"]
