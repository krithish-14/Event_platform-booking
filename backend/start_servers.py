"""
Launcher: starts backend (FastAPI on 8001) and frontend (static on 5500)
as subprocesses, redirecting their stdout/stderr to files so Windows cp1252
console encoding can't kill them.

Robustness:
- Skips spawning a server if its port is already bound (reuses running instance).
- Keeps the launcher alive as long as at least one of the servers is still
  running (uses `or` semantics, never terminates a healthy sibling).
"""
import io
import os
import socket
import subprocess
import sys
import time
import threading
from typing import List, Optional, Tuple


BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = 8001
FRONTEND_HOST = "127.0.0.1"
FRONTEND_PORT = 5500


def port_in_use(host: str, port: int) -> bool:
    """Return True if `host:port` already has a TCP listener bound."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.settimeout(0.3)
        return s.connect_ex((host, port)) == 0
    finally:
        try:
            s.close()
        except OSError:
            pass


def launch(cmd, cwd, logfile) -> Tuple[subprocess.Popen, io.TextIOWrapper]:
    """Run a cmd in background, streaming output to logfile."""
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8:replace"
    f = open(logfile, "w", encoding="utf-8", errors="replace", buffering=1)
    p = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        stdout=f,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return p, f


Service = Tuple[str, Optional[subprocess.Popen], Optional[io.TextIOWrapper]]


def watch(proc: Optional[subprocess.Popen], label: str, log: Optional[io.TextIOWrapper]):
    """Watch `proc` until it exits (or return immediately if proc is None)."""
    if proc is None:
        print("[launcher] %s already running (port bound); skipped spawning." % label)
        return
    try:
        while proc.poll() is None:
            time.sleep(0.5)
    finally:
        try:
            if proc.poll() is None:
                proc.terminate()
        except Exception:
            pass
        try:
            if log is not None:
                log.close()
        except Exception:
            pass
    print("[launcher] %s exited with code %s" % (label, proc.returncode))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(here)

    venv_python = os.path.join(here, ".venv", "Scripts", "python.exe")
    python_exe = venv_python if os.path.exists(venv_python) else sys.executable

    services: List[Service] = []

    if port_in_use(BACKEND_HOST, BACKEND_PORT):
        backend, backend_log = None, None
        print("[launcher] backend port %s:%d already bound — reusing running instance"
              % (BACKEND_HOST, BACKEND_PORT))
    else:
        backend, backend_log = launch(
            [
                python_exe, "-u", "-m", "uvicorn", "FastAPI.main:app",
                "--host", BACKEND_HOST, "--port", str(BACKEND_PORT),
                "--reload", "--log-level", "info",
            ],
            cwd=os.path.join(project_root, "backend"),
            logfile=os.path.join(here, "backend.log"),
        )
    services.append(("backend", backend, backend_log))

    if port_in_use(FRONTEND_HOST, FRONTEND_PORT):
        frontend, frontend_log = None, None
        print("[launcher] frontend port %s:%d already bound — reusing running instance"
              % (FRONTEND_HOST, FRONTEND_PORT))
    else:
        frontend, frontend_log = launch(
            [sys.executable, "-u", os.path.join(here, "serve_frontend.py")],
            cwd=os.path.join(project_root, "frontend"),
            logfile=os.path.join(here, "frontend.log"),
        )
    services.append(("frontend", frontend, frontend_log))

    for label, proc, log in services:
        if proc is not None:
            print("[launcher] %s pid=%s log=%s" % (label, proc.pid, log.name))
    print("[launcher] Frontend: http://%s:%d/index.html" % (FRONTEND_HOST, FRONTEND_PORT))
    print("[launcher] Backend:  http://%s:%d (docs: /docs)" % (BACKEND_HOST, BACKEND_PORT))
    print("[launcher] Press Ctrl+C or close this window to stop both servers.")

    threads: List[threading.Thread] = []
    for label, proc, log in services:
        t = threading.Thread(target=watch, args=(proc, label, log), daemon=True)
        t.start()
        threads.append(t)

    try:
        while any(t.is_alive() for t in threads):
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for label, proc, _log in services:
            if proc is None:
                continue
            try:
                if proc.poll() is None:
                    print("[launcher] terminating %s (pid=%s)" % (label, proc.pid))
                    proc.terminate()
            except Exception:
                pass


if __name__ == "__main__":
    main()
