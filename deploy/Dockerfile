# vyos-gw web console — self-contained image, built on the VyOS device itself.
# Build context: the REPO ROOT (podman build -f deploy/Dockerfile .)
# Stage 1 builds the frontend, stage 2 is the runtime image. The legacy
# backend/deploy/Dockerfile (PC-side build with a prebuilt dist) still works.

# ─── Stage 1: frontend build ──────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ─── Stage 2: runtime ─────────────────────────────────────────────
FROM python:3.12-alpine

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY backend/app /srv/app
COPY backend/run_server.py /srv/run_server.py
COPY --from=frontend /build/dist /srv/dist
WORKDIR /srv

ENV VGW_ON_DEVICE=1 \
    VGW_DATA_DIR=/data \
    VGW_DIST_DIR=/srv/dist \
    PYTHONUNBUFFERED=1

EXPOSE 8001
CMD ["python", "run_server.py"]
