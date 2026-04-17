FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV HF_HOME=/app/models_cache
ENV GLINER_PORT=9001

EXPOSE 9001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9001"]
