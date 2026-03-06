FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3-full \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# configs/docker-requirements.txt contains only clean, cross-platform package
# names (no conda local file:// paths, no Windows-only packages).
# openai-whisper's setup.py uses pkg_resources which was removed from setuptools
# 80+. Pin to a compatible setuptools, install whisper, then upgrade if needed.
RUN pip install --upgrade pip && \
    pip install "setuptools==78.1.1" && \
    pip install --no-cache-dir --no-build-isolation openai-whisper==20240930 && \
    pip install --no-cache-dir -r configs/docker-requirements.txt

ARG SERVER_PORT
ENV SERVER_PORT=${SERVER_PORT}

EXPOSE ${SERVER_PORT}

CMD python run.py --host 0.0.0.0 --port ${SERVER_PORT}