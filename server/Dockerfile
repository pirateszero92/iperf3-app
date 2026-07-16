FROM python:3.12-slim

# Install iperf3 binary
RUN apt-get update && \
    apt-get install -y --no-install-recommends iperf3 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /app/data

EXPOSE 8000

# Single worker is required to share global server process state
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
