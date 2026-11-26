FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    poppler-utils \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Migrations Alembic : exécutées au démarrage (lifespan -> alembic upgrade head)
COPY alembic.ini ./
COPY alembic/ ./alembic/

COPY src/ ./src/
# scripts/ : seed du catalogue de facturation (lancé manuellement au go-live).
COPY scripts/ ./scripts/

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
