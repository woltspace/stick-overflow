# A connected Stick Overflow board. Standard library only: nothing to install.
FROM python:3.13-slim
WORKDIR /app
COPY board.py server.py ./
COPY web ./web
# Connected: every door needs a key. Set BOARD_KEEPER_KEY on the host, never here.
# Mount a persistent volume at /data, or the posts are lost on every redeploy.
ENV BOARD_MODE=connected BOARD_DATA=/data PYTHONUNBUFFERED=1
CMD ["python", "server.py"]
