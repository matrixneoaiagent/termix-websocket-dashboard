#!/usr/bin/env python3
"""Smoke-test the dashboard server: HTTP, websocket tick and ping/pong."""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import aiohttp

HERE = Path(__file__).parent
PORT = int(os.environ.get("TEST_PORT", "8877"))


async def main() -> int:
    env = dict(os.environ, PORT=str(PORT))
    proc = subprocess.Popen([sys.executable, str(HERE / "server.py")], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for _ in range(50):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=1) as r:
                    health = json.loads(r.read())
                    assert health["ok"] is True
                    break
            except Exception:
                time.sleep(0.1)
        else:
            raise RuntimeError("server did not become healthy")

        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(f"http://127.0.0.1:{PORT}/ws") as ws:
                tick = json.loads((await ws.receive(timeout=3)).data)
                assert tick["type"] == "tick" and "value" in tick, tick
                await ws.send_json({"type": "ping", "ts": 123})
                while True:
                    msg = json.loads((await ws.receive(timeout=3)).data)
                    if msg.get("type") == "pong":
                        assert msg["ts"] == 123
                        break
        print("OK: health, tick and ping/pong")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
