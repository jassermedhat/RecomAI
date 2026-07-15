"""Launch the local AI Shopping Assistant stack from the project root."""

from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
OLLAMA_PORT = 11434
BACKEND_PORT = 8000
FRONTEND_PORT = 5173
MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
NPM_COMMAND = "npm.cmd" if os.name == "nt" else "npm"


def port_is_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
        connection.settimeout(0.5)
        return connection.connect_ex(("127.0.0.1", port)) == 0


def command_exists(command: str) -> bool:
    return shutil.which(command) is not None


def ensure_prerequisites() -> list[str]:
    problems: list[str] = []
    for package in ("fastapi", "uvicorn", "multipart"):
        if importlib.util.find_spec(package) is None:
            problems.append("Backend packages are missing. Run: python -m pip install -r backend/requirements.txt")
            break
    if not command_exists("npm"):
        problems.append("npm was not found. Install Node.js, then retry.")
    elif not (FRONTEND / "node_modules").exists():
        problems.append("Frontend packages are missing. Run: cd frontend; npm install")
    if not command_exists("ollama"):
        problems.append("Ollama was not found. Install Ollama, then retry.")
    return problems


def model_is_available() -> bool:
    result = subprocess.run(
        ["ollama", "list"], capture_output=True, text=True, check=False, cwd=ROOT
    )
    return result.returncode == 0 and MODEL in result.stdout


def start_ollama_if_needed() -> subprocess.Popen[bytes] | None:
    if port_is_open(OLLAMA_PORT):
        return None
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    process = subprocess.Popen(
        ["ollama", "serve"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creation_flags,
    )
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if port_is_open(OLLAMA_PORT):
            return process
        time.sleep(0.5)
    process.terminate()
    raise RuntimeError("Ollama did not become ready on http://127.0.0.1:11434.")


def start_stack() -> list[subprocess.Popen[bytes]]:
    if port_is_open(BACKEND_PORT):
        raise RuntimeError(f"Port {BACKEND_PORT} is already in use. Stop the existing backend first.")
    if port_is_open(FRONTEND_PORT):
        raise RuntimeError(f"Port {FRONTEND_PORT} is already in use. Stop the existing frontend first.")
    backend = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(BACKEND_PORT)],
        cwd=BACKEND,
    )
    try:
        frontend = subprocess.Popen(
            [NPM_COMMAND, "run", "dev", "--", "--host", "127.0.0.1", "--port", str(FRONTEND_PORT)],
            cwd=FRONTEND,
        )
    except OSError:
        stop(backend)
        raise
    return [backend, frontend]


def stop(process: subprocess.Popen[bytes] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def main() -> int:
    parser = argparse.ArgumentParser(description="Start the AI Shopping Assistant locally.")
    parser.add_argument("--check", action="store_true", help="Validate prerequisites without starting services.")
    arguments = parser.parse_args()

    problems = ensure_prerequisites()
    if not problems and not model_is_available():
        problems.append(f"Ollama model '{MODEL}' is missing. Run: ollama pull {MODEL}")
    if problems:
        print("Cannot start the AI Shopping Assistant:\n- " + "\n- ".join(problems), file=sys.stderr)
        return 1
    if arguments.check:
        print("All prerequisites are ready.")
        return 0

    ollama_process: subprocess.Popen[bytes] | None = None
    app_processes: list[subprocess.Popen[bytes]] = []
    try:
        ollama_process = start_ollama_if_needed()
        app_processes = start_stack()
        print("\nAI Shopping Assistant is running:")
        print("  Frontend: http://127.0.0.1:5173")
        print("  Backend:  http://127.0.0.1:8000")
        print("\nPress Ctrl+C to stop the frontend and backend.")
        while all(process.poll() is None for process in app_processes):
            time.sleep(0.5)
        return 1
    except KeyboardInterrupt:
        print("\nStopping services…")
        return 0
    except RuntimeError as error:
        print(f"Cannot start the AI Shopping Assistant: {error}", file=sys.stderr)
        return 1
    finally:
        for process in app_processes:
            stop(process)
        # Only stop Ollama when this launcher created its service process.
        stop(ollama_process)


if __name__ == "__main__":
    raise SystemExit(main())
