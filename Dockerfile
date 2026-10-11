FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    DEBRIEF_CACHE=/data/cache DEBRIEF_OUT=/data/out DEBRIEF_TAILS_FILE=/app/tails.txt

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && useradd --create-home --uid 1000 debrief \
 && mkdir -p /data && chown debrief /data

COPY debrief debrief
COPY server server
COPY site site
COPY tails.txt .
RUN rm -rf site/data

USER debrief
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=4).status==200 else 1)"
CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
