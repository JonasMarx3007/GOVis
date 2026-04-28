FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /app/frontend
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1
ARG GOVIS_BASE_PATH=/
ENV GOVIS_BASE_PATH=${GOVIS_BASE_PATH}

COPY backend ./backend
COPY go-basic.obo ./
COPY annotations ./annotations
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

EXPOSE 8000

CMD ["sh", "-c", "python -m backend --host 0.0.0.0 --port 8000 --base-path \"$GOVIS_BASE_PATH\" --no-browser"]
