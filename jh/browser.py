"""The shared "JobHunter Chrome": one normal Chrome window (own profile, stays open) that the apply assistant
attaches to over a local debugging port, so every application opens as a NEW TAB in the same window and
re-uses whatever you're logged into there (LinkedIn, Google, Indeed, Workday...).

Why not your everyday Chrome profile? Since Chrome 136 Google blocks remote control of the default profile
(anti-cookie-theft protection), so a dedicated profile is the only way. Sign into Chrome/Google inside it once
and your saved passwords sync over; site logins then persist across restarts."""
import json, os, subprocess, time, urllib.request
from . import db

PORT = 9333
PROFILE = os.path.join(db.DATA, "browser-apply")


def endpoint():
    return f"http://127.0.0.1:{PORT}"


def alive():
    try:
        with urllib.request.urlopen(endpoint() + "/json/version", timeout=1.5) as r:
            return json.load(r).get("Browser", "?")
    except Exception:
        return None


def _open_tab(url):
    """Open *url* as a tab in the running JobHunter browser."""
    target = urllib.request.quote(url, safe=":/?&=%#")
    req = urllib.request.Request(endpoint() + "/json/new?" + target, method="PUT")
    urllib.request.urlopen(req, timeout=3).read()


def _exe(channel="chrome"):
    pf = [os.environ.get(k) for k in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA")]
    chrome = [os.path.join(p, "Google", "Chrome", "Application", "chrome.exe") for p in pf if p]
    edge = [os.path.join(p, "Microsoft", "Edge", "Application", "msedge.exe") for p in pf if p]
    unix = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
    for c in (edge + chrome if channel == "msedge" else chrome + edge) + unix:
        if os.path.exists(c):
            return c
    return None


def ensure(url=None, wait=20):
    """Start the JobHunter Chrome if it isn't running. Returns (ok, message)."""
    if alive():
        if url:
            try:
                _open_tab(url)
            except Exception:
                pass
        return True, "running"
    exe = _exe(db.settings().get("browser_channel", "chrome"))
    if not exe:
        return False, "Chrome/Edge not found"
    os.makedirs(PROFILE, exist_ok=True)
    args = [exe, f"--remote-debugging-port={PORT}", "--remote-debugging-address=127.0.0.1", f"--user-data-dir={PROFILE}",
            "--no-first-run", "--no-default-browser-check", "--start-maximized", "--disable-blink-features=AutomationControlled"]
    if os.name != "nt" and hasattr(os, "geteuid") and os.geteuid() == 0:
        args.append("--no-sandbox")          # Linux root only (test machines); never used on Windows
    flags = 0
    if os.name == "nt":   # detached: the window survives JobHunter restarts
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    subprocess.Popen(args, creationflags=flags, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
    for _ in range(wait * 4):
        if alive():
            if url:
                try:
                    _open_tab(url)
                except Exception:
                    pass
            return True, "started"
        time.sleep(0.25)
    return False, "Chrome did not open its control port — close any other window using the JobHunter profile and retry"
