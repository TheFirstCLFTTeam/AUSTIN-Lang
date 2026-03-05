FROM python:3.13-slim

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

RUN pip3 install --no-cache-dir -r configs/requirements.txt

RUN python - <<'PY'
import pathlib
import subprocess
import yaml

env_file = pathlib.Path("configs/server_dev_env.yml")
data = yaml.safe_load(env_file.read_text(encoding="utf-8"))
deps = data.get("dependencies", [])
pip_deps = []

for dep in deps:
    if isinstance(dep, dict) and "pip" in dep:
        pip_deps.extend(dep["pip"])

if pip_deps:
    subprocess.check_call(["pip", "install", "--no-cache-dir", *pip_deps])
else:
    print("No pip dependencies found in configs/server_dev_env.yml")
PY

ARG SERVER_PORT
ENV SERVER_PORT=${SERVER_PORT}

EXPOSE ${SERVER_PORT}

CMD python run.py --host 0.0.0.0 --port ${SERVER_PORT}