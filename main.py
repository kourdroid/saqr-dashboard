"""
SAQR Command Center v2 - FastAPI backend for the Hermes agent.

Controls Kanban work, LLM config, cron state, container operations, logs,
environment-key visibility, and local agent scripts.
"""

import json
import os
import re
import sqlite3
import subprocess
import time
import uuid
from datetime import datetime, timezone
from json import JSONDecodeError
from pathlib import Path
from typing import Any, Optional

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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
    return {
        "ok": True,
        "message": f"Queued manual trigger placeholder for {job.get('name', job_id)}",
    }


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
                }
            )
    return files


@app.post("/api/scripts/{name}/run")
def run_script(name: str) -> dict[str, Any]:
    script_path = safe_script_path(name)
    if not script_path.exists():
        raise HTTPException(404, "script not found")
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


if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(str(FRONTEND_DIR / "index.html"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=9090)
