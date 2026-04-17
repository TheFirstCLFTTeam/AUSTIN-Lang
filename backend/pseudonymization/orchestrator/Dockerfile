FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Package layout — keep `from .crypto import ...` working.
COPY . /app/orchestrator/

ENV PYTHONPATH=/app
ENV PSEUDONYM_DB_PATH=/app/data/pseudonymisation.db

RUN mkdir -p /app/data

EXPOSE 5002

CMD ["uvicorn", "orchestrator.api:app", "--host", "0.0.0.0", "--port", "5002"]
