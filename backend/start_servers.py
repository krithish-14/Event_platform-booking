"""
Launcher: starts backend (FastAPI on 8001) and frontend (static on 5500)
as subprocesses, redirecting their stdout/stderr to files so Windows cp1252
console encoding can't kill them.
"""
import io
import os
import subprocess
import sys
import time
import threading


def launch(cmd, cwd, logfile):
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


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(here)

    backend, backend_log = launch(
        [sys.executable, "-u", "-m", "uvicorn", "FastAPI.main:app", "--host", "127.0.0.1", "--port", "8001", "--log-level", "info"],
        cwd=os.path.join(project_root, "backend"),
        logfile=os.path.join(here, "backend.log"),
    )

    frontend_script = (
        "import sys; sys.stdout.reconfigure(encoding='utf-8', errors='replace');"
        "import socketserver, http.server;"
        "PORT=5500;"
        "H=('127.0.0.1',PORT);"
        "Handler=http.server.SimpleHTTPRequestHandler;"
        "httpd=socketserver.TCPServer(H, Handler, bind_and_activate=False);"
        "httpd.allow_reuse_address=True;"
        "httpd.server_bind(); httpd.server_activate();"
        "sys.stdout.write('Serving on http://127.0.0.1:%d\\n' % PORT); sys.stdout.flush();"
        "httpd.serve_forever()"
    )
    frontend, frontend_log = launch(
        [sys.executable, "-u", "-c", frontend_script],
        cwd=os.path.join(project_root, "frontend"),
        logfile=os.path.join(here, "frontend.log"),
    )

    print("[launcher] backend pid=%s log=%s" % (backend.pid, backend_log.name))
    print("[launcher] frontend pid=%s log=%s" % (frontend.pid, frontend_log.name))
    print("[launcher] Frontend: http://127.0.0.1:5500/index.html")
    print("[launcher] Backend:  http://127.0.0.1:8001 (docs: /docs)")
    print("[launcher] Press Ctrl+C or close this window to stop both servers.")

    def watch(proc, label, log):
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
                log.close()
            except Exception:
                pass
        print("[launcher] %s exited with code %s" % (label, proc.returncode))

    try:
        t1 = threading.Thread(target=watch, args=(backend, "backend", backend_log), daemon=True)
        t2 = threading.Thread(target=watch, args=(frontend, "frontend", frontend_log), daemon=True)
        t1.start(); t2.start()
        while t1.is_alive() and t2.is_alive():
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for p in (backend, frontend):
            try:
                if p.poll() is None:
                    p.terminate()
            except Exception:
                pass


if __name__ == "__main__":
    main()
