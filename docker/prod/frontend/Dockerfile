FROM node:22-alpine AS build

WORKDIR /workspace/frontend

COPY common/device-catalog-domain /workspace/common/device-catalog-domain
COPY frontend/package*.json ./
RUN npm ci

ARG VITE_API_BASE_URL
ARG VITE_SENSOR_POLL_INTERVAL_MS=3000
ARG VITE_MODBUS_TRANSACTION_TIMEOUT_MS=1200
ARG CORS_ORIGIN

# Vite는 공개 설정을 빌드 파일에 포함하므로 이 단계에는 secret을 전달하지 않는다.
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_SENSOR_POLL_INTERVAL_MS=${VITE_SENSOR_POLL_INTERVAL_MS} \
    VITE_MODBUS_TRANSACTION_TIMEOUT_MS=${VITE_MODBUS_TRANSACTION_TIMEOUT_MS} \
    CORS_ORIGIN=${CORS_ORIGIN}

COPY frontend .
RUN npm run build

FROM nginx:alpine

COPY docker/prod/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/frontend/dist /usr/share/nginx/html

EXPOSE 80
