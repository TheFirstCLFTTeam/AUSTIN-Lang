FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy as a package so `from .crypto import ...` works.
COPY . /app/orchestrator/
COPY schema.sql /app/orchestrator/schema.sql

ENV PYTHONPATH=/app
ENV PSEUDONYM_ORCHESTRATOR_PORT=9002
ENV PSEUDONYM_DB_PATH=/app/data/pseudonymisation.db

RUN mkdir -p /app/data

EXPOSE 9002

CMD ["uvicorn", "orchestrator.api:app", "--host", "0.0.0.0", "--port", "9002"]
