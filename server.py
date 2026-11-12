#!/usr/bin/env python3
"""Reconnect-focused websocket dashboard reference implementation.

A tiny aiohttp app: a websocket endpoint that broadcasts ticks, a browser
dashboard with exponential-backoff reconnect + heartbeat/latency, and a health
endpoint. No external services or keys.

Run:  python server.py  (PORT env optional, default 8765)
Test: python test_smoke.py
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import random
import time
from pathlib import Path

from aiohttp import WSMsgType, web

STATIC = Path(__file__).parent / "public"


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)
    request.app["clients"].add(ws)
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except Exception:
                continue
            if data.get("type") == "ping":
                await ws.send_json(
                    {"type": "pong", "ts": data.get("ts"), "server_ts": int(time.time() * 1000)}
                )
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    finally:
        request.app["clients"].discard(ws)
    return ws


async def ticker(app: web.Application) -> None:
    seq = 0
    while True:
        await asyncio.sleep(1)
        seq += 1
        payload = {
            "type": "tick",
            "seq": seq,
            "ts": int(time.time() * 1000),
            "value": round(50 + 20 * math.sin(seq / 4) + random.uniform(-2, 2), 2),
        }
        for ws in list(app["clients"]):
            try:
                await ws.send_json(payload)
            except Exception:
                app["clients"].discard(ws)


async def index(request: web.Request) -> web.Response:
    return web.FileResponse(STATIC / "index.html")


async def health(request: web.Request) -> web.Response:
    return web.json_response(
        {
            "ok": True,
            "clients": len(request.app["clients"]),
            "uptime_s": round(time.time() - request.app["started"], 1),
        }
    )


async def start_ticker(app: web.Application) -> None:
    app["started"] = time.time()
    app["ticker_task"] = asyncio.create_task(ticker(app))


async def stop_ticker(app: web.Application) -> None:
    task = app.get("ticker_task")
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


def make_app() -> web.Application:
    app = web.Application()
    app["clients"] = set()
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/health", health)
    app.router.add_get("/", index)
    app.router.add_static("/", STATIC, show_index=False, follow_symlinks=False)
    app.on_startup.append(start_ticker)
    app.on_cleanup.append(stop_ticker)
    return app


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8765"))
    web.run_app(make_app(), host="127.0.0.1", port=port)
