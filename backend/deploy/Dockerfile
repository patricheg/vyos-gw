# vyos-gw web console — runs as a container on the VyOS device itself.
# LEGACY PC-side flow (app.services.ondevice): expects a prebuilt dist.
# For a self-contained on-router build from the repo root use deploy/Dockerfile.
# Build context: Dockerfile, requirements.txt, app/ (backend), dist/ (frontend build).
FROM python:3.12-alpine

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY app /srv/app
COPY dist /srv/dist
WORKDIR /srv

ENV VGW_ON_DEVICE=1 \
    VGW_DATA_DIR=/data \
    VGW_DIST_DIR=/srv/dist \
    PYTHONUNBUFFERED=1

EXPOSE 8001
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
