"""
SAQR Command Center v2 - FastAPI backend for the Hermes agent.

Controls Kanban work, LLM config, cron state, container operations, logs,
environment-key visibility, and local agent scripts.
"""

import json
import hashlib
import hmac
import os
import re
import shlex
import sqlite3
import subprocess
import time
import uuid
from collections import Counter
from datetime import datetime, timezone
from json import JSONDecodeError
from pathlib import Path
from typing import Any, Optional

import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

DATA_DIR = Path(os.environ.get("SAQR_DATA_DIR", "/docker/hermes-agent-0hzy/data"))
KANBAN_DB = DATA_DIR / "kanban.db"
CRON_JOBS = DATA_DIR / "cron" / "jobs.json"
JOBS_FILE = DATA_DIR / "jobs.json"
SOUL_FILE = DATA_DIR / "saqr" / "SOUL.md"
ENV_FILE = DATA_DIR / ".env"
CONFIG_FILE = DATA_DIR / "config.yaml"
CONTAINER_NAME = os.environ.get("SAQR_CONTAINER_NAME", "hermes-agent-0hzy-hermes-agent-1")
FRONTEND_DIR = Path(__file__).parent / "frontend" / "dist"

VALID_STATUSES = {"backlog", "ready", "in_progress", "blocked", "done"}
VALID_PRIORITIES = {0, 1, 2}
MAX_LOG_LINES = 500
SCRIPT_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
AUTH_TOKEN = os.environ.get("SAQR_AUTH_TOKEN", "")
ALLOW_UNAUTHENTICATED = os.environ.get("SAQR_ALLOW_UNAUTHENTICATED", "").lower() in {"1", "true", "yes"}
PUBLIC_API_PATHS = {"/api/health"}
ALLOWED_SCRIPTS = {
    item.strip()
    for item in os.environ.get("SAQR_ALLOWED_SCRIPTS", "").split(",")
    if item.strip()
}
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "SAQR_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app = FastAPI(title="SAQR Command Center", version="2.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.middleware("http")
async def require_api_auth(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api") or path in PUBLIC_API_PATHS or ALLOW_UNAUTHENTICATED:
        return await call_next(request)
    if not AUTH_TOKEN:
        return JSONResponse(
            status_code=503,
            content={"detail": "SAQR_AUTH_TOKEN is not configured; protected API is locked"},
        )
    auth_header = request.headers.get("Authorization", "")
    bearer = auth_header[7:].strip() if auth_header.lower().startswith("bearer ") else ""
    header_token = request.headers.get("X-Saqr-Token", "")
    token = bearer or header_token
    if not token or not hmac.compare_digest(token, AUTH_TOKEN):
        return JSONResponse(status_code=401, content={"detail": "valid SAQR API token required"})
    return await call_next(request)


# Models

class TaskCreate(BaseModel):
    title: str
    body: str = ""
    status: str = "backlog"
    priority: int = 0
    assignee: str = "default"


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[int] = None
    assignee: Optional[str] = None


class ConfigUpdate(BaseModel):
    model: Optional[str] = None
    provider: Optional[str] = None
    base_url: Optional[str] = None
    max_turns: Optional[int] = None
    temperature: Optional[float] = None


class RawConfigUpdate(BaseModel):
    text: str


# Helpers

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except JSONDecodeError as exc:
        raise HTTPException(500, f"Invalid JSON in {path.name}: {exc.msg}") from exc
    except OSError as exc:
        raise HTTPException(500, f"Cannot read {path.name}: {exc}") from exc


def write_json(path: Path, data: Any) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except OSError as exc:
        raise HTTPException(500, f"Cannot write {path.name}: {exc}") from exc


def run(cmd: list[str], timeout: int = 10) -> dict[str, Any]:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return {
            "ok": result.returncode == 0,
            "returncode": result.returncode,
            "stdout": result.stdout[:10000],
            "stderr": result.stderr[:5000],
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "returncode": None, "stdout": "", "stderr": "timeout"}
    except OSError as exc:
        return {"ok": False, "returncode": None, "stdout": "", "stderr": str(exc)}


def ensure_kanban_schema() -> None:
    KANBAN_DB.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(KANBAN_DB)) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                body TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'backlog',
                priority INTEGER NOT NULL DEFAULT 0,
                assignee TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                started_at INTEGER,
                completed_at INTEGER,
                created_by TEXT
            )
            """
        )
        existing_columns = {
            row[1]
            for row in conn.execute("PRAGMA table_info(tasks)").fetchall()
        }
        additive_columns = {
            "result": "TEXT",
            "max_retries": "INTEGER NOT NULL DEFAULT 3",
            "consecutive_failures": "INTEGER NOT NULL DEFAULT 0",
            "last_failure_error": "TEXT",
        }
        for column, definition in additive_columns.items():
            if column not in existing_columns:
                conn.execute(f"ALTER TABLE tasks ADD COLUMN {column} {definition}")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS task_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                profile TEXT,
                step_key TEXT,
                status TEXT,
                outcome TEXT,
                summary TEXT,
                started_at INTEGER,
                ended_at INTEGER,
                error TEXT
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs (task_id, id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS task_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                run_id INTEGER,
                kind TEXT,
                payload TEXT,
                created_at INTEGER
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events (task_id, id)")
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_tasks_status_priority_created
            ON tasks (status, priority, created_at)
            """
        )


def validate_task_status(status: Optional[str]) -> None:
    if status is not None and status not in VALID_STATUSES:
        raise HTTPException(400, f"status must be one of {sorted(VALID_STATUSES)}")


def validate_priority(priority: Optional[int]) -> None:
    if priority is not None and priority not in VALID_PRIORITIES:
        raise HTTPException(400, "priority must be 0, 1, or 2")


def validate_task_create(task: TaskCreate) -> None:
    if not task.title.strip():
        raise HTTPException(400, "title is required")
    validate_task_status(task.status)
    validate_priority(task.priority)


def validate_task_update(update: TaskUpdate) -> None:
    if update.title is not None and not update.title.strip():
        raise HTTPException(400, "title cannot be empty")
    validate_task_status(update.status)
    validate_priority(update.priority)


def timestamp_to_iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def scripts_dir() -> Path:
    return DATA_DIR / "saqr" / "scripts"


def safe_script_path(name: str) -> Path:
    if not SCRIPT_NAME_RE.fullmatch(name):
        raise HTTPException(400, "script name may only contain letters, numbers, dots, dashes, and underscores")
    root = scripts_dir().resolve()
    script_path = (root / name).resolve()
    try:
        script_path.relative_to(root)
    except ValueError as exc:
        raise HTTPException(400, "script path escapes scripts directory") from exc
    if script_path.suffix not in {".py", ".sh"}:
        raise HTTPException(400, "script must be a .py or .sh file")
    return script_path


# Kanban

def get_kanban() -> list[dict[str, Any]]:
    ensure_kanban_schema()
    with sqlite3.connect(str(KANBAN_DB)) as conn:
        conn.row_factory = sqlite3.Row
        tasks = [
            dict(row)
            for row in conn.execute(
                """
                SELECT id, title, body, status, priority, assignee,
                       created_at, started_at, completed_at, created_by
                FROM tasks
                ORDER BY priority DESC, created_at DESC
                """
            ).fetchall()
        ]
    for task in tasks:
        for key in ("created_at", "started_at", "completed_at"):
            task[key] = timestamp_to_iso(task.get(key))
    return tasks


def add_kanban_task(task: TaskCreate) -> str:
    validate_task_create(task)
    task_id = uuid.uuid4().hex[:12]
    now = int(time.time())
    assignee = task.assignee.strip() if task.assignee else "default"
    ensure_kanban_schema()
    with sqlite3.connect(str(KANBAN_DB)) as conn:
        conn.execute(
            """
            INSERT INTO tasks (id, title, body, status, priority, assignee, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id,
                task.title.strip(),
                task.body,
                task.status,
                task.priority,
                assignee,
                now,
            ),
        )
    return task_id


def update_kanban_task(task_id: str, update: TaskUpdate) -> None:
    validate_task_update(update)
    fields: dict[str, Any] = {}
    for key in ("title", "body", "status", "priority", "assignee"):
        value = getattr(update, key, None)
        if value is not None:
            fields[key] = value.strip() if isinstance(value, str) else value
    if not fields:
        return

    now = int(time.time())
    if fields.get("status") == "in_progress":
        fields["started_at"] = now
    elif fields.get("status") == "done":
        fields["completed_at"] = now
    if "assignee" in fields and not fields["assignee"]:
        fields["assignee"] = "default"

    columns = ", ".join(f"{key}=?" for key in fields)
    ensure_kanban_schema()
    with sqlite3.connect(str(KANBAN_DB)) as conn:
        cursor = conn.execute(
            f"UPDATE tasks SET {columns} WHERE id=?",
            list(fields.values()) + [task_id],
        )
        if cursor.rowcount == 0:
            raise HTTPException(404, "task not found")


def delete_kanban_task(task_id: str) -> None:
    ensure_kanban_schema()
    with sqlite3.connect(str(KANBAN_DB)) as conn:
        cursor = conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
        if cursor.rowcount == 0:
            raise HTTPException(404, "task not found")


def get_kanban_task_detail(task_id: str) -> dict[str, Any]:
    ensure_kanban_schema()
    with sqlite3.connect(str(KANBAN_DB)) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            """
            SELECT id, title, body, status, priority, assignee,
                   created_at, started_at, completed_at, created_by,
                   result, max_retries, consecutive_failures, last_failure_error
            FROM tasks WHERE id=?
            """,
            (task_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "task not found")
        task = dict(row)
        runs = [
            dict(r)
            for r in conn.execute(
                """
                SELECT id, profile, step_key, status, outcome, summary,
                       started_at, ended_at, error
                FROM task_runs WHERE task_id=?
                ORDER BY id
                """,
                (task_id,),
            ).fetchall()
        ]
        events = [
            dict(r)
            for r in conn.execute(
                """
                SELECT id, run_id, kind, payload, created_at
                FROM task_events WHERE task_id=?
                ORDER BY id
                """,
                (task_id,),
            ).fetchall()
        ]
    for key in ("created_at", "started_at", "completed_at"):
        task[key] = timestamp_to_iso(task.get(key))
    for run in runs:
        for key in ("started_at", "ended_at"):
            run[key] = timestamp_to_iso(run.get(key))
    for ev in events:
        ev["created_at"] = timestamp_to_iso(ev.get("created_at"))
    task["runs"] = runs
    task["events"] = events
    return task


# Config

def read_config() -> dict[str, Any]:
    if not CONFIG_FILE.exists():
        return {}
    text = CONFIG_FILE.read_text(encoding="utf-8")
    raw = yaml.safe_load(text) or {}
    return {
        "raw": text,
        "model": raw.get("model", {}),
        "fallback_providers": raw.get("fallback_providers", []),
        "agent": raw.get("agent", {}),
        "delegation": raw.get("delegation", {}),
    }


def read_config_summary() -> dict[str, Any]:
    config = read_config()
    return {
        "model": config.get("model", {}),
        "agent": config.get("agent", {}),
        "fallback_count": len(config.get("fallback_providers", [])),
        "has_raw": bool(config.get("raw")),
    }


def update_config_file(update: ConfigUpdate) -> None:
    if not CONFIG_FILE.exists():
        raise HTTPException(404, "config.yaml not found")
    cfg = yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8")) or {}
    model_cfg = cfg.setdefault("model", {})
    if update.model is not None:
        model_cfg["default"] = update.model
    if update.provider is not None:
        model_cfg["provider"] = update.provider
    if update.base_url is not None:
        model_cfg["base_url"] = update.base_url
    if update.temperature is not None:
        model_cfg["temperature"] = update.temperature
    if update.max_turns is not None:
        cfg.setdefault("agent", {})["max_turns"] = update.max_turns
    CONFIG_FILE.write_text(
        yaml.dump(cfg, default_flow_style=False, sort_keys=False),
        encoding="utf-8",
    )


def write_raw_config(text: str) -> None:
    if not text.strip():
        raise HTTPException(400, "text required")
    try:
        yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise HTTPException(400, f"invalid YAML: {exc}") from exc
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(text, encoding="utf-8")


# Aggregations

def cron_jobs_with_health() -> list[dict[str, Any]]:
    data = read_json(CRON_JOBS, {"jobs": []})
    jobs = data.get("jobs", [])
    for job in jobs:
        if job.get("enabled") is False or job.get("state") == "paused":
            job["health"] = "paused"
        elif job.get("last_status") == "error":
            job["health"] = "error"
        elif job.get("last_run_at"):
            try:
                last = datetime.fromisoformat(job["last_run_at"].replace("Z", "+00:00"))
                age_hours = (datetime.now(timezone.utc) - last).total_seconds() / 3600
                job["health"] = "ok" if age_hours < 48 else "stale"
            except ValueError:
                job["health"] = "unknown"
        else:
            job["health"] = "never_run"
    return jobs


def pipeline_stats_data() -> dict[str, Any]:
    data = read_json(JOBS_FILE, {"jobs": []})
    jobs = data.get("jobs", [])
    kourchal = [job for job in jobs if job.get("profile") == "kourchal"]
    mehdi = [job for job in jobs if job.get("profile") != "kourchal"]
    return {
        "total": len(jobs),
        "mehdi": {
            "total": len(mehdi),
            "applied": sum(1 for job in mehdi if job.get("status") == "applied"),
        },
        "kourchal": {
            "total": len(kourchal),
            "applied": sum(1 for job in kourchal if job.get("status") == "applied"),
        },
        "recent": jobs[-5:],
    }


def credit_status_data() -> dict[str, bool]:
    env: dict[str, str] = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip().strip('"').strip("'")
    return {
        "apify": bool(env.get("APIFY_API_KEY")),
        "tavily": bool(env.get("TAVILY_API_KEY")),
        "brave": bool(env.get("BRAVE_SEARCH_API_KEY")),
        "openrouter": bool(env.get("OPENROUTER_API_KEY")),
        "ninja": bool(env.get("NINJA_API_KEY")),
        "opencode_zen": bool(env.get("OPCODE_ZEN_API_KEY")),
    }


def container_state() -> dict[str, Any]:
    result = run(["docker", "inspect", CONTAINER_NAME, "--format", "{{.State.Status}}"])
    status = result["stdout"].strip() if result["ok"] else "unknown"
    return {"status": status, "ok": status == "running", "detail": result}


def count_by_key(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        value = str(row.get(key) or "unknown")
        counts[value] = counts.get(value, 0) + 1
    return counts


# SAQR command center deep audit

UPPER_SAQR = DATA_DIR / "SAQR"
LOWER_SAQR = DATA_DIR / "saqr"
UPPER_SCRIPTS = UPPER_SAQR / "scripts"
LOWER_SCRIPTS = LOWER_SAQR / "scripts"
LIVE_SCRIPTS = DATA_DIR / "scripts"
POD_DIR = DATA_DIR / "pod"
POD_QUEUE = POD_DIR / "pending_review.json"
POD_DAILY_RESULTS = POD_DIR / "daily_publish_results.json"
CRON_OUTPUT_DIR = DATA_DIR / "cron" / "output"

SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|token|secret|password)\s*=\s*['\"][A-Za-z0-9_./+=:-]{16,}['\"]"),
    re.compile(r"(?i)(BRAVE|APIFY|HUNTER|NINJA|OPENAI)[A-Z0-9_]*\s*=\s*['\"][A-Za-z0-9_./+=:-]{16,}['\"]"),
]


def file_mtime(path: Path) -> Optional[str]:
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    except OSError:
        return None


def file_sha256(path: Path) -> Optional[str]:
    try:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(65536), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


def epoch_to_iso(value: str) -> Optional[str]:
    try:
        return datetime.fromtimestamp(int(float(value)), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def live_script_meta(script: str) -> dict[str, Any]:
    local_path = LIVE_SCRIPTS / script
    if local_path.exists():
        return {
            "exists": True,
            "sha": file_sha256(local_path),
            "modified": file_mtime(local_path),
            "source": "mounted",
        }
    if not SCRIPT_NAME_RE.fullmatch(script):
        return {"exists": False, "sha": None, "modified": None, "source": "invalid_name"}
    path = f"/root/.hermes/scripts/{script}"
    quoted = shlex.quote(path)
    cmd = (
        f"p={quoted}; "
        'if [ -f "$p" ]; then '
        'sha=$(sha256sum "$p" | cut -d" " -f1); '
        'mt=$(stat -c "%Y" "$p"); '
        'printf "exists\\t%s\\t%s\\n" "$sha" "$mt"; '
        'else printf "missing\\n"; fi'
    )
    result = run(["docker", "exec", CONTAINER_NAME, "sh", "-lc", cmd], timeout=5)
    if not result.get("ok"):
        return {"exists": False, "sha": None, "modified": None, "source": "docker_exec_failed"}
    parts = result.get("stdout", "").strip().split("\t")
    if len(parts) >= 3 and parts[0] == "exists":
        return {"exists": True, "sha": parts[1], "modified": epoch_to_iso(parts[2]), "source": "docker_exec"}
    return {"exists": False, "sha": None, "modified": None, "source": "docker_exec"}


def latest_cron_artifact(job_id: str) -> Optional[dict[str, Any]]:
    base = CRON_OUTPUT_DIR / job_id
    if not base.is_dir():
        return None
    files = [path for path in base.iterdir() if path.is_file()]
    if not files:
        return None
    latest = max(files, key=lambda path: path.stat().st_mtime)
    return {
        "name": latest.name,
        "path": str(latest),
        "modified": file_mtime(latest),
        "size": latest.stat().st_size,
    }


def classify_saqr_domain(name: str, prompt: str, script: str) -> str:
    text = f"{name} {prompt} {script}".lower()
    if "pod" in text:
        return "POD"
    if "mohammed" in text:
        return "Mohammed Jobs"
    if "ceo" in text or "cold" in text or "apify" in text:
        return "CEO Outreach"
    if "linkedin" in text:
        return "LinkedIn"
    if "krebs" in text or "watch" in text:
        return "Watch"
    if "sync" in text:
        return "Sync"
    if "job" in text or "hunter" in text:
        return "Mehdi Jobs"
    return "Ops"


def classify_saqr_mode(name: str, prompt: str, script: str, no_agent: bool) -> str:
    text = f"{name} {prompt} {script}".lower()
    if "outbox" in text:
        return "deliver"
    if "publish" in text:
        return "queue/publish"
    if "approval" in text or "review" in text:
        return "review"
    if "ceo" in text and ("send" in text or "cold" in text or "outbound" in text):
        return "send"
    if "auto-send" in text or "send immediately" in text:
        return "send"
    if "daily_hunter" in text or "daily-hunter" in text:
        return "draft"
    if "hunter" in text:
        return "discover"
    if "analytics" in text:
        return "analytics"
    return "script" if no_agent else "agent"


def script_audit(script: Optional[str]) -> dict[str, Any]:
    if not script:
        return {"script": None, "drift": "agent_prompt", "live_exists": None}
    live = live_script_meta(script)
    paths = {
        "lower": LOWER_SCRIPTS / script,
        "upper": UPPER_SCRIPTS / script,
    }
    exists = {"live": bool(live.get("exists")), **{key: path.exists() for key, path in paths.items()}}
    hashes = {"live": live.get("sha"), **{key: file_sha256(path) for key, path in paths.items()}}
    mtimes = {"live": live.get("modified"), **{key: file_mtime(path) for key, path in paths.items()}}
    drift = "ok"
    if not exists["live"]:
        drift = "missing_live"
    elif exists["lower"] and exists["upper"] and hashes["lower"] != hashes["upper"]:
        drift = "split_brain"
    elif exists["upper"] and hashes["live"] != hashes["upper"]:
        drift = "stale_live"
    elif exists["lower"] and hashes["live"] != hashes["lower"] and not exists["upper"]:
        drift = "stale_live"
    return {
        "script": script,
        "drift": drift,
        "live_exists": exists["live"],
        "live_source": live.get("source"),
        "exists": exists,
        "modified": mtimes,
    }


def saqr_jobs_deep() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    cron_jobs = cron_jobs_with_health()
    jobs: list[dict[str, Any]] = []
    domains: Counter[str] = Counter()
    modes: Counter[str] = Counter()
    failures = 0
    paused = 0
    enabled = 0
    for job in cron_jobs:
        name = str(job.get("name") or job.get("id") or "")
        prompt = str(job.get("prompt") or "")
        script = str(job.get("script")) if job.get("script") else None
        state = str(job.get("state") or "unknown")
        domain = classify_saqr_domain(name, prompt, script or "")
        mode = classify_saqr_mode(name, prompt, script or "", bool(job.get("no_agent")))
        audit = script_audit(script)
        reasons: list[str] = []
        if job.get("last_error") or job.get("last_status") == "error":
            reasons.append("last run failed")
            failures += 1
        if job.get("enabled") and state != "paused":
            enabled += 1
        if state == "paused" or job.get("enabled") is False:
            paused += 1
        prompt_text = f"{name} {prompt}".lower()
        if "unlimited" in prompt_text:
            reasons.append("prompt says unlimited")
        if "auto-send" in prompt_text or "send immediately" in prompt_text:
            reasons.append("auto-send prompt")
        if script and not audit.get("live_exists"):
            reasons.append("live script missing")
        if audit.get("drift") in {"stale_live", "split_brain"}:
            reasons.append(str(audit["drift"]))
        if mode == "send":
            reasons.append("outbound side effect")
        risk = "low"
        if "last run failed" in reasons or "live script missing" in reasons:
            risk = "high"
        elif reasons:
            risk = "medium"
        domains[domain] += 1
        modes[mode] += 1
        jobs.append({
            "id": job.get("id"),
            "name": name,
            "domain": domain,
            "mode": mode,
            "risk": risk,
            "risk_reasons": reasons,
            "enabled": job.get("enabled", True),
            "state": state,
            "health": job.get("health"),
            "schedule": job.get("schedule_display") or job.get("schedule"),
            "last_run_at": job.get("last_run_at"),
            "next_run_at": job.get("next_run_at"),
            "last_status": job.get("last_status"),
            "last_error": job.get("last_error"),
            "deliver": job.get("deliver"),
            "script": script,
            "script_audit": audit,
            "artifact": latest_cron_artifact(str(job.get("id") or "")),
        })
    risk_order = {"high": 0, "medium": 1, "low": 2}
    jobs.sort(key=lambda row: (risk_order.get(row["risk"], 9), row["domain"], row["name"]))
    return jobs, {
        "total": len(jobs),
        "enabled": enabled,
        "paused": paused,
        "failures": failures,
        "domains": dict(domains),
        "modes": dict(modes),
    }


def saqr_pod_deep() -> dict[str, Any]:
    queue = read_json(POD_QUEUE, {"designs": []}) if POD_QUEUE.exists() else {"designs": []}
    designs = queue.get("designs", []) if isinstance(queue, dict) else []
    statuses = Counter(str(item.get("status", "queued")).strip().lower() for item in designs if isinstance(item, dict))
    daily = read_json(POD_DAILY_RESULTS, {}) if POD_DAILY_RESULTS.exists() else {}
    cron_result = daily.get("cron_result", {}) if isinstance(daily, dict) else {}
    return {
        "queue_file": str(POD_QUEUE),
        "queue_total": len(designs),
        "statuses": dict(statuses),
        "daily_results_file": str(POD_DAILY_RESULTS),
        "daily_results_modified": file_mtime(POD_DAILY_RESULTS),
        "daily": {
            "status": cron_result.get("status"),
            "picks": len(daily.get("picks", [])) if isinstance(daily, dict) else 0,
            "queued": cron_result.get("queued", 0),
            "published": cron_result.get("published", 0),
            "publish_failed": cron_result.get("publish_failed", 0),
            "sources": daily.get("sources", []) if isinstance(daily, dict) else [],
        },
    }


def secret_risk_files() -> list[dict[str, Any]]:
    risks: list[dict[str, Any]] = []
    seen: set[str] = set()
    for root in (LOWER_SCRIPTS, UPPER_SCRIPTS, LIVE_SCRIPTS):
        if not root.is_dir():
            continue
        for path in sorted(root.glob("saqr*.py"))[:80]:
            if str(path) in seen:
                continue
            seen.add(str(path))
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            matches = sum(1 for pattern in SECRET_PATTERNS if pattern.search(text))
            if matches:
                risks.append({"file": path.name, "path": str(path), "matches": matches})
    return risks[:30]


def script_drift_rows(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    names = {job.get("script") for job in jobs if job.get("script")}
    names.update({
        "run_pod_daily.sh",
        "run_pod_weekly.sh",
        "run_ceo_apify_hunter.sh",
        "saqr_daily_hunter.py",
        "saqr_mohammed_daily_hunter.py",
        "saqr_precision_hunter.py",
    })
    rows = []
    for name in sorted(item for item in names if item):
        audit = script_audit(str(name))
        if audit["drift"] != "ok":
            rows.append({"file": name, **audit})
    return rows


def command_center_issues(jobs: list[dict[str, Any]], pod: dict[str, Any], secrets: list[dict[str, Any]], drift: list[dict[str, Any]]) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    if LOWER_SAQR.exists() and UPPER_SAQR.exists():
        issues.append({"severity": "high", "area": "Code", "title": "Split SAQR trees detected", "detail": "/data/saqr and /data/SAQR both exist."})
    for job in jobs:
        if job.get("last_error") or job.get("last_status") == "error":
            issues.append({"severity": "high", "area": job["domain"], "title": f"{job['name']} failed", "detail": str(job.get("last_error") or "last_status=error")[:240]})
        if "prompt says unlimited" in job.get("risk_reasons", []):
            issues.append({"severity": "high", "area": "Doctrine", "title": f"{job['name']} violates cap doctrine", "detail": "Prompt contains unlimited language while SOUL.md defines daily caps."})
        if "auto-send prompt" in job.get("risk_reasons", []):
            issues.append({"severity": "medium", "area": "Send Gate", "title": f"{job['name']} can send from prompt", "detail": "Outbound mode should be explicit and gated."})
        if "live script missing" in job.get("risk_reasons", []):
            issues.append({"severity": "high", "area": "Cron", "title": f"{job['name']} runner missing", "detail": f"Script not found in live scripts: {job.get('script')}"})
    daily = pod.get("daily", {})
    if int(daily.get("queued") or 0) > 0 and int(daily.get("published") or 0) == 0:
        issues.append({"severity": "high", "area": "POD", "title": "Daily publish queued but published zero", "detail": "POD cron writes queued rows; approval publisher only publishes approved rows."})
    if int(pod.get("statuses", {}).get("queued", 0) or 0) > 0:
        issues.append({"severity": "medium", "area": "POD", "title": "POD queue has unapproved designs", "detail": f"{pod['statuses'].get('queued', 0)} designs are queued."})
    if secrets:
        issues.append({"severity": "high", "area": "Secrets", "title": "Hardcoded credential patterns found", "detail": f"{len(secrets)} source files match key/token patterns. Values are hidden."})
    if drift:
        issues.append({"severity": "medium", "area": "Deploy", "title": "Script drift detected", "detail": f"{len(drift)} scripts are missing, stale, or split across trees."})
    order = {"high": 0, "medium": 1, "low": 2}
    issues.sort(key=lambda item: (order.get(item["severity"], 9), item["area"], item["title"]))
    return issues[:30]


def command_center_data() -> dict[str, Any]:
    jobs, cron = saqr_jobs_deep()
    pod = saqr_pod_deep()
    secrets = secret_risk_files()
    drift = script_drift_rows(jobs)
    issues = command_center_issues(jobs, pod, secrets, drift)
    send_jobs = [job for job in jobs if job["mode"] == "send"]
    send_blocked = bool(secrets) or any("prompt says unlimited" in job.get("risk_reasons", []) for job in send_jobs)
    send_state = "blocked" if send_blocked else ("open" if send_jobs else "review")
    drift_bad = len([row for row in drift if row.get("drift") != "ok"])
    tiles = {
        "cron_health": {
            "label": "Cron Health",
            "value": f"{max(cron['enabled'] - cron['failures'], 0)}/{cron['total']} healthy",
            "tone": "bad" if cron["failures"] else ("warn" if cron["paused"] else "good"),
            "detail": f"{cron['failures']} failing · {cron['paused']} paused",
        },
        "pod_engine": {
            "label": "POD Engine",
            "value": f"{pod['queue_total']} queued",
            "tone": "bad" if pod["daily"].get("queued") and not pod["daily"].get("published") else "good",
            "detail": f"published today: {pod['daily'].get('published', 0)}",
        },
        "job_hunting": {
            "label": "Job Hunting",
            "value": f"{cron['domains'].get('Mehdi Jobs', 0) + cron['domains'].get('Mohammed Jobs', 0)} jobs",
            "tone": "warn",
            "detail": "lead sheet metrics not wired",
        },
        "send_gate": {
            "label": "Send Gate",
            "value": send_state.upper(),
            "tone": "bad" if send_state == "blocked" else ("warn" if send_state == "review" else "good"),
            "detail": f"{len(send_jobs)} outbound jobs",
        },
        "credentials": {
            "label": "Credential Health",
            "value": "risk" if secrets else ("ok" if ENV_FILE.exists() else "missing env"),
            "tone": "bad" if secrets or not ENV_FILE.exists() else "good",
            "detail": f"{len(secrets)} hardcoded-risk files",
        },
        "code_drift": {
            "label": "Code Drift",
            "value": "split/drift" if drift_bad else "clean",
            "tone": "bad" if drift_bad else "good",
            "detail": f"{drift_bad} files need attention",
        },
    }
    return {
        "generated_at": utc_now(),
        "tiles": tiles,
        "cron": cron,
        "pod": pod,
        "jobs": jobs,
        "issues": issues,
        "send_gate": {"state": send_state, "send_jobs": len(send_jobs)},
        "secret_risks": secrets,
        "code_drift": drift,
        "paths": {
            "data": str(DATA_DIR),
            "jobs": str(CRON_JOBS),
            "lower": str(LOWER_SAQR),
            "upper": str(UPPER_SAQR),
            "live_scripts": str(LIVE_SCRIPTS),
        },
    }


COMMAND_CENTER_HTML = """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SAQR Deep Command Center</title>
  <style>
    :root { color-scheme: dark; --bg:#080b10; --panel:#111823; --panel2:#0d131c; --text:#e5edf7; --muted:#8ea0b7; --line:#263244; --red:#ef4444; --amber:#f59e0b; --green:#22c55e; --cyan:#38bdf8; }
    * { box-sizing: border-box; } body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:var(--text); }
    main { max-width: 1480px; margin: 0 auto; padding: 22px; display:flex; flex-direction:column; gap:14px; }
    header { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; border-bottom:1px solid var(--line); padding-bottom:16px; }
    h1 { margin:0; font-size:28px; letter-spacing:0; } p { margin:4px 0 0; color:var(--muted); } button { background:transparent; color:var(--text); border:1px solid var(--line); border-radius:6px; padding:8px 12px; cursor:pointer; }
    .tiles { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:10px; } .tile { border:1px solid var(--line); border-left-width:4px; border-radius:8px; padding:12px; background:var(--panel); min-width:0; }
    .good { border-left-color:var(--green); } .warn { border-left-color:var(--amber); } .bad { border-left-color:var(--red); }
    .label { color:var(--muted); font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; } .value { font-size:20px; font-weight:800; margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .detail { color:var(--muted); font-size:12px; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .grid { display:grid; grid-template-columns:2fr 1fr 1fr; gap:12px; } .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; min-width:0; } .panel h2 { margin:0 0 10px; font-size:15px; }
    .issue { display:flex; gap:9px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,.06); } .pill { display:inline-flex; height:21px; align-items:center; padding:0 7px; border-radius:99px; border:1px solid var(--line); font-size:11px; font-weight:800; white-space:nowrap; }
    .high { color:var(--red); border-color:var(--red); } .medium { color:var(--amber); border-color:var(--amber); } .low { color:var(--green); border-color:var(--green); }
    .issue-title { font-weight:700; font-size:13px; } .issue-detail { color:var(--muted); font-size:12px; line-height:1.35; }
    .metrics { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; } .metric { border:1px solid var(--line); border-radius:6px; padding:10px; background:var(--panel2); } .metric span { display:block; color:var(--muted); font-size:11px; } .metric strong { display:block; font-size:20px; margin-top:2px; }
    table { width:100%; border-collapse:collapse; font-size:12px; } th { text-align:left; color:var(--muted); padding:8px; border-bottom:1px solid var(--line); } td { padding:8px; border-bottom:1px solid rgba(255,255,255,.06); vertical-align:top; max-width:280px; } .sub { color:var(--muted); font-size:11px; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .two { display:grid; grid-template-columns:1fr 1fr; gap:12px; } .row { display:flex; justify-content:space-between; gap:8px; padding:7px 0; border-bottom:1px solid rgba(255,255,255,.06); }
    .note { color:var(--muted); font-size:12px; margin-top:10px; line-height:1.4; } a { color:var(--cyan); text-decoration:none; }
    @media (max-width: 1100px) { .tiles { grid-template-columns:repeat(3,minmax(0,1fr)); } .grid { grid-template-columns:1fr; } }
    @media (max-width: 720px) { main { padding:14px; } header { flex-direction:column; } .tiles { grid-template-columns:repeat(2,minmax(0,1fr)); } .two { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div><h1>SAQR Deep Command Center</h1><p>Read-only operational truth for cron, POD, job hunting, send gate, doctrine, credentials, and script drift.</p></div>
      <div><button id="refresh">Refresh</button><p id="updated"></p><p><a href="/">Back to main dashboard</a></p></div>
    </header>
    <section class="tiles" id="tiles"></section>
    <section class="grid">
      <div class="panel"><h2>Doctrine & Runtime Issues</h2><div id="issues"></div></div>
      <div class="panel"><h2>POD Pipeline</h2><div class="metrics" id="pod"></div><div class="note" id="pod-note"></div></div>
      <div class="panel"><h2>Send Gate</h2><div id="send"></div><div class="note">Read-only. No send, pause, trigger, or publish action is performed here.</div></div>
    </section>
    <section class="panel"><h2>SAQR Job Matrix</h2><div style="overflow-x:auto"><table><thead><tr><th>Job</th><th>Domain</th><th>Mode</th><th>State</th><th>Schedule</th><th>Result</th><th>Source</th><th>Risk</th></tr></thead><tbody id="jobs"></tbody></table></div></section>
    <section class="panel"><h2>Code Drift & Secret Risk</h2><div class="two"><div><h2>Script Drift</h2><div id="drift"></div></div><div><h2>Credential Patterns</h2><div id="secrets"></div></div></div></section>
  </main>
  <script>
    const token = localStorage.getItem("saqr_api_token") || "";
    const authHeaders = token ? { Authorization: "Bearer " + token } : {};
    const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
    const pill = (text, cls) => `<span class="pill ${cls || ""}">${esc(text)}</span>`;
    function render(data) {
      document.getElementById("updated").textContent = "Updated " + new Date(data.generated_at).toLocaleString();
      document.getElementById("tiles").innerHTML = Object.values(data.tiles).map(t => `<div class="tile ${t.tone}"><div class="label">${esc(t.label)}</div><div class="value">${esc(t.value)}</div><div class="detail">${esc(t.detail)}</div></div>`).join("");
      document.getElementById("issues").innerHTML = (data.issues || []).slice(0, 10).map(i => `<div class="issue">${pill(String(i.severity).toUpperCase(), i.severity)}<div><div class="issue-title">${esc(i.title)}</div><div class="issue-detail">${esc(i.area)} · ${esc(i.detail)}</div></div></div>`).join("") || `<div class="note">No issues detected.</div>`;
      const pod = data.pod || {}, daily = pod.daily || {}, st = pod.statuses || {};
      document.getElementById("pod").innerHTML = [["Queue", pod.queue_total || 0], ["Queued", st.queued || 0], ["Approved", st.approved || 0], ["Published", st.published || 0], ["Daily picks", daily.picks || 0], ["Published today", daily.published || 0]].map(([k,v]) => `<div class="metric"><span>${k}</span><strong>${v}</strong></div>`).join("");
      document.getElementById("pod-note").textContent = daily.queued > 0 && !daily.published ? "Warning: daily publish is queue-only right now. Rows must become approved before Printify publish runs." : "POD daily result is consistent with current approval state.";
      const gate = data.send_gate || {};
      document.getElementById("send").innerHTML = `<div class="tile ${gate.state === "blocked" ? "bad" : gate.state === "open" ? "good" : "warn"}"><div class="value">${esc(String(gate.state || "review").toUpperCase())}</div><div class="detail">${esc(gate.send_jobs || 0)} outbound jobs</div></div>`;
      document.getElementById("jobs").innerHTML = (data.jobs || []).slice(0, 16).map(j => `<tr><td><strong>${esc(j.name)}</strong><div class="sub">${esc(j.id)}</div></td><td>${esc(j.domain)}</td><td>${pill(j.mode)}</td><td>${esc(j.state)}</td><td>${esc(j.schedule || "-")}</td><td title="${esc(j.last_error || j.last_status || "-")}">${esc(j.last_error || j.last_status || "-").slice(0, 120)}</td><td>${esc(j.script_audit?.drift || "agent")}<div class="sub">${esc(j.script || "")}</div></td><td>${pill(String(j.risk).toUpperCase(), j.risk)}</td></tr>`).join("");
      document.getElementById("drift").innerHTML = (data.code_drift || []).slice(0, 12).map(r => `<div class="row"><span>${esc(r.file)}</span>${pill(r.drift, r.drift === "missing_live" ? "high" : "medium")}</div>`).join("") || `<div class="note">No drift in tracked files.</div>`;
      document.getElementById("secrets").innerHTML = (data.secret_risks || []).slice(0, 12).map(r => `<div class="row"><span title="${esc(r.path)}">${esc(r.file)}</span>${pill("pattern", "high")}</div>`).join("") || `<div class="note">No hardcoded key patterns found.</div>`;
    }
    async function load() {
      const res = await fetch("/api/command-center", { headers: authHeaders });
      if (!res.ok) throw new Error(await res.text());
      render(await res.json());
    }
    document.getElementById("refresh").addEventListener("click", () => load().catch(err => alert(err.message)));
    load().catch(err => { document.getElementById("issues").innerHTML = `<div class="note">${esc(err.message)}</div>`; });
  </script>
</body>
</html>
"""


# Routes

@app.get("/api/health")
def health() -> dict[str, Any]:
    container = container_state()
    return {
        "status": "ok",
        "time": utc_now(),
        "container": container["status"],
        "container_ok": container["ok"],
    }


@app.get("/api/overview")
def overview() -> dict[str, Any]:
    tasks = get_kanban()
    cron_jobs = cron_jobs_with_health()
    credits = credit_status_data()
    return {
        "generated_at": utc_now(),
        "container": container_state(),
        "tasks": {
            "total": len(tasks),
            "by_status": count_by_key(tasks, "status"),
            "critical": sum(1 for task in tasks if task.get("priority") == 2),
        },
        "cron": {
            "total": len(cron_jobs),
            "by_health": count_by_key(cron_jobs, "health"),
            "errors": [
                {"id": job.get("id"), "name": job.get("name")}
                for job in cron_jobs
                if job.get("health") == "error"
            ],
        },
        "pipeline": pipeline_stats_data(),
        "credits": {
            "active": sum(1 for value in credits.values() if value),
            "total": len(credits),
            "items": credits,
        },
        "config": read_config_summary(),
    }


@app.get("/api/kanban-tasks")
def list_tasks() -> list[dict[str, Any]]:
    return get_kanban()


@app.post("/api/kanban-tasks")
def create_task(task: TaskCreate) -> dict[str, str]:
    return {"id": add_kanban_task(task)}


@app.get("/api/kanban-tasks/{task_id}")
def get_task(task_id: str) -> dict[str, Any]:
    return get_kanban_task_detail(task_id)


@app.patch("/api/kanban-tasks/{task_id}")
def patch_task(task_id: str, update: TaskUpdate) -> dict[str, bool]:
    update_kanban_task(task_id, update)
    return {"ok": True}


@app.delete("/api/kanban-tasks/{task_id}")
def remove_task(task_id: str) -> dict[str, bool]:
    delete_kanban_task(task_id)
    return {"ok": True}


@app.get("/api/config")
def config_get() -> dict[str, Any]:
    return read_config()


@app.put("/api/config")
def config_update(update: ConfigUpdate) -> dict[str, str | bool]:
    update_config_file(update)
    return {"ok": True, "message": "Config updated. Restart container to apply."}


@app.get("/api/config/raw")
def config_raw() -> dict[str, str]:
    return {"text": CONFIG_FILE.read_text(encoding="utf-8") if CONFIG_FILE.exists() else ""}


@app.put("/api/config/raw")
def config_raw_update(update: RawConfigUpdate) -> dict[str, str | bool]:
    write_raw_config(update.text)
    return {"ok": True, "message": "Config written. Restart container to apply."}


@app.post("/api/config/restart")
def config_restart() -> dict[str, Any]:
    return run(["docker", "restart", CONTAINER_NAME], timeout=60)


@app.get("/api/cron-jobs")
def cron_status() -> list[dict[str, Any]]:
    return cron_jobs_with_health()


@app.post("/api/cron/{job_id}/toggle")
def cron_toggle(job_id: str) -> dict[str, bool]:
    data = read_json(CRON_JOBS, {"jobs": []})
    for job in data.get("jobs", []):
        if job.get("id") == job_id:
            job["enabled"] = not job.get("enabled", True)
            job["state"] = "scheduled" if job["enabled"] else "paused"
            if job["enabled"]:
                job["paused_at"] = None
                job["paused_reason"] = None
            else:
                job["paused_at"] = utc_now()
            write_json(CRON_JOBS, data)
            return {"ok": True, "enabled": job["enabled"]}
    raise HTTPException(404, "job not found")


@app.post("/api/cron/{job_id}/trigger")
def cron_trigger(job_id: str) -> dict[str, Any]:
    data = read_json(CRON_JOBS, {"jobs": []})
    job = next((item for item in data.get("jobs", []) if item.get("id") == job_id), None)
    if job is None:
        raise HTTPException(404, "job not found")
    raise HTTPException(
        501,
        f"Manual trigger is not wired for {job.get('name', job_id)}; use the Hermes scheduler path",
    )


@app.get("/api/pipeline")
def pipeline_stats() -> dict[str, Any]:
    return pipeline_stats_data()


@app.get("/api/credits")
def credit_status() -> dict[str, bool]:
    return credit_status_data()


@app.get("/api/soul-summary")
def soul_summary() -> dict[str, list[Any]]:
    if not SOUL_FILE.exists():
        return {"missions": [], "schedule": []}

    text = SOUL_FILE.read_text(encoding="utf-8")
    missions: list[str] = []
    schedule: list[dict[str, str]] = []
    in_mission = False
    in_schedule = False
    for line in text.splitlines():
        stripped = line.strip()
        if line.startswith("##") and "1." in line:
            in_mission = True
            in_schedule = False
            continue
        if line.startswith("##") and "1." not in line:
            in_mission = False
        if "Cron schedule" in stripped:
            in_schedule = True
            in_mission = False
            continue
        if in_mission and stripped.startswith(("1.", "2.", "3.", "4.")):
            missions.append(stripped.split(" - ")[-1].strip() if " - " in stripped else stripped)
        if in_schedule and stripped.startswith("|") and "---" not in stripped:
            parts = [part.strip() for part in stripped.split("|") if part.strip()]
            if len(parts) >= 4:
                schedule.append(
                    {"time": parts[0], "job": parts[1], "profile": parts[2], "deliver": parts[3]}
                )
    return {"missions": missions, "schedule": schedule}


@app.get("/api/container")
def container_info() -> dict[str, Any]:
    return {
        "inspect": run(
            [
                "docker",
                "inspect",
                CONTAINER_NAME,
                "--format",
                "{{.State.Status}}\t{{.State.StartedAt}}\t{{.Config.Image}}",
            ]
        ),
        "logs_tail": run(["docker", "logs", "--tail", "50", CONTAINER_NAME]),
        "stats": run(
            [
                "docker",
                "stats",
                CONTAINER_NAME,
                "--no-stream",
                "--format",
                "{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}",
            ]
        ),
    }


@app.post("/api/container/restart")
def container_restart() -> dict[str, Any]:
    return run(["docker", "restart", CONTAINER_NAME], timeout=60)


@app.get("/api/container/logs")
def container_logs(lines: int = 100) -> dict[str, Any]:
    safe_lines = min(max(lines, 1), MAX_LOG_LINES)
    return run(["docker", "logs", "--tail", str(safe_lines), CONTAINER_NAME])


@app.get("/api/env")
def env_status() -> dict[str, list[str]]:
    if not ENV_FILE.exists():
        return {"keys": []}
    keys = []
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            keys.append(line.split("=", 1)[0].strip())
    return {"keys": sorted(keys)}


@app.get("/api/scripts")
def list_scripts() -> list[dict[str, Any]]:
    root = scripts_dir()
    if not root.exists():
        return []
    files = []
    for script in sorted(root.iterdir()):
        if script.is_file() and script.suffix in (".py", ".sh") and not script.name.startswith("__"):
            files.append(
                {
                    "name": script.name,
                    "size": script.stat().st_size,
                    "modified": datetime.fromtimestamp(script.stat().st_mtime, tz=timezone.utc).isoformat(),
                    "runnable": script.name in ALLOWED_SCRIPTS,
                }
            )
    return files


@app.post("/api/scripts/{name}/run")
def run_script(name: str) -> dict[str, Any]:
    script_path = safe_script_path(name)
    if not script_path.exists():
        raise HTTPException(404, "script not found")
    if name not in ALLOWED_SCRIPTS:
        raise HTTPException(403, "script is not in SAQR_ALLOWED_SCRIPTS")
    if script_path.suffix == ".sh":
        return run(["bash", str(script_path)], timeout=120)
    return run(["python3", str(script_path)], timeout=120)


@app.get("/api/activity")
def activity_feed() -> list[dict[str, Any]]:
    """Last 20 completed/blocked tasks with their most recent run summary."""
    ensure_kanban_schema()
    with sqlite3.connect(str(KANBAN_DB)) as conn:
        conn.row_factory = sqlite3.Row
        
        # Check if task_runs table exists
        runs_table_exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='task_runs'"
        ).fetchone()
        
        if not runs_table_exists:
            rows = conn.execute("""
                SELECT id, title, status, completed_at, started_at,
                       NULL as summary, NULL as outcome, NULL as ended_at, NULL as run_started
                FROM tasks
                WHERE status IN ('done', 'blocked')
                ORDER BY completed_at DESC
                LIMIT 20
            """).fetchall()
        else:
            rows = conn.execute("""
                SELECT t.id, t.title, t.status, t.completed_at, t.started_at,
                       r.summary, r.outcome, r.ended_at, r.started_at as run_started
                FROM tasks t
                LEFT JOIN task_runs r ON r.task_id = t.id AND r.id = (
                    SELECT MAX(id) FROM task_runs WHERE task_id = t.id
                )
                WHERE t.status IN ('done', 'blocked')
                ORDER BY t.completed_at DESC
                LIMIT 20
            """).fetchall()
            
    result = []
    for row in rows:
        d = dict(row)
        d["completed_at"] = timestamp_to_iso(d.get("completed_at"))
        d["started_at"] = timestamp_to_iso(d.get("started_at"))
        duration = None
        if d.get("run_started") and d.get("ended_at"):
            try:
                duration = int(d["ended_at"]) - int(d["run_started"])
            except (TypeError, ValueError):
                pass
        d["duration_secs"] = duration
        d.pop("run_started", None)
        result.append(d)
    return result


@app.get("/api/command-center")
def command_center() -> dict[str, Any]:
    return command_center_data()


@app.get("/command-center")
def command_center_page() -> HTMLResponse:
    return HTMLResponse(COMMAND_CENTER_HTML)


if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(str(FRONTEND_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=9090)
