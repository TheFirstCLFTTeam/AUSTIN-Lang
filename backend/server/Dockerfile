FROM python:3.10-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir --upgrade pip pyyaml

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

EXPOSE 8010

CMD ["python", "run.py", "--host", "0.0.0.0", "--port", "8010"]