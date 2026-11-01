"""Relay between the apply engine (scraper/apply.mjs) and the "JobHunter Apply Helper" browser extension that
lives in YOUR normal Chrome/Edge. The engine posts an operation, the extension long-polls for it, runs it in your
own logged-in tab, and posts the result back. Everything stays on localhost."""
import itertools, os, queue, threading, time

_ops = queue.Queue()
_waiting = {}                # op id -> [Event, result]
_ids = itertools.count(1)
_lock = threading.Lock()
STATE = {"last_poll": 0.0, "version": None, "browser": None}


def connected(max_age=40):
    return time.time() - STATE["last_poll"] < max_age


def poll(version=None, browser=None, timeout=20):
    STATE.update(last_poll=time.time(), version=version, browser=browser)
    try:
        op = _ops.get(timeout=timeout)
    except queue.Empty:
        STATE["last_poll"] = time.time()
        return None
    STATE["last_poll"] = time.time()
    return op


def result(op_id, payload):
    with _lock:
        w = _waiting.get(op_id)
    if w:
        w[1] = payload
        w[0].set()


def call(op, timeout=90):
    """Called (via HTTP) by apply.mjs. Blocks until the extension answers."""
    if not connected():
        return {"ok": False, "error": "JobHunter Apply Helper extension is not connected"}
    oid = next(_ids)
    ev = threading.Event()
    with _lock:
        _waiting[oid] = [ev, None]
    _ops.put({**op, "id": oid})
    ok = ev.wait(timeout)
    with _lock:
        res = _waiting.pop(oid, [None, None])[1]
    if not ok:
        return {"ok": False, "error": f"extension did not answer '{op.get('op')}' in {timeout}s"}
    return res or {"ok": False, "error": "empty result"}


def flush():
    while True:
        try:
            _ops.get_nowait()
        except queue.Empty:
            return
