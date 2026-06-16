"""
SAQR Command Center v2 — FastAPI backend
Full control: Kanban, LLM config, cron management, container ops, logs.
"""

import hmac, hashlib, json, os, sqlite3, subprocess, time, uuid, re, threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import yaml
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DATA_DIR = Path("/docker/hermes-agent-0hzy/data")
KANBAN_DB = DATA_DIR / "kanban.db"
CRON_JOBS = DATA_DIR / "cron" / "jobs.json"
JOBS_FILE = DATA_DIR / "jobs.json"
SOUL_FILE = DATA_DIR / "saqr" / "SOUL.md"
ENV_FILE = DATA_DIR / ".env"
CONFIG_FILE = DATA_DIR / "config.yaml"
CONTAINER_NAME = "hermes-agent-0hzy-hermes-agent-1"

app = FastAPI(title="SAQR Command Center", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── Models ──

class TaskCreate(BaseModel):
    title: str
    body: str = ""
    status: str = "backlog"
    priority: int = 0
    assignee: str = ""

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


# ── Helpers ──

def read_json(path):
    try: return json.loads(path.read_text())
    except Exception: return {}

def write_json(path, data):
    path.write_text(json.dumps(data, indent=2))
    return True

def run(cmd, timeout=10):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return {"ok": r.returncode == 0, "stdout": r.stdout[:10000], "stderr": r.stderr[:5000]}
    except subprocess.TimeoutExpired:
        return {"ok": False, "stdout": "", "stderr": "timeout"}
    except Exception as e:
        return {"ok": False, "stdout": "", "stderr": str(e)}


# ── Kanban ──

def get_kanban():
    conn = sqlite3.connect(str(KANBAN_DB))
    conn.row_factory = sqlite3.Row
    tasks = [dict(r) for r in conn.execute(
        "SELECT id, title, body, status, priority, assignee, created_at, started_at, completed_at, created_by "
        "FROM tasks ORDER BY priority DESC, created_at DESC"
    ).fetchall()]
    conn.close()
    for t in tasks:
        for k in ("created_at", "started_at", "completed_at"):
            if t.get(k):
                try: t[k] = datetime.fromtimestamp(t[k], tz=timezone.utc).isoformat()
                except: t[k] = None
    return tasks

def add_kanban_task(task: TaskCreate):
    tid = uuid.uuid4().hex[:12]
    now = int(time.time())
    conn = sqlite3.connect(str(KANBAN_DB))
    conn.execute("INSERT INTO tasks (id, title, body, status, priority, assignee, created_at) VALUES (?,?,?,?,?,?,?)",
                 (tid, task.title, task.body, task.status, task.priority, task.assignee, now))
    conn.commit()
    conn.close()
    return tid

def update_kanban_task(task_id: str, update: TaskUpdate):
    fields = {}
    for k in ("title", "body", "status", "priority", "assignee"):
        v = getattr(update, k, None)
        if v is not None: fields[k] = v
    if not fields: return
    now = int(time.time())
    if fields.get("status") == "in_progress": fields["started_at"] = now
    elif fields.get("status") == "done": fields["completed_at"] = now
    sets = ", ".join(f"{k}=?" for k in fields)
    conn = sqlite3.connect(str(KANBAN_DB))
    conn.execute(f"UPDATE tasks SET {sets} WHERE id=?", list(fields.values()) + [task_id])
    conn.commit()
    conn.close()

def delete_kanban_task(task_id: str):
    conn = sqlite3.connect(str(KANBAN_DB))
    conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
    conn.commit()
    conn.close()


# ── LLM Config ──

def read_config():
    if not CONFIG_FILE.exists():
        return {}
    text = CONFIG_FILE.read_text()
    raw = yaml.safe_load(text) or {}
    return {
        "raw": text,
        "model": raw.get("model", {}),
        "fallback_providers": raw.get("fallback_providers", []),
        "agent": raw.get("agent", {}),
        "delegation": raw.get("delegation", {}),
    }

def write_config_model(model_cfg: dict):
    if not CONFIG_FILE.exists():
        raise HTTPException(404, "config.yaml not found")
    text = CONFIG_FILE.read_text()
    lines = text.splitlines()
    new_lines = []
    in_model = False
    wrote = False
    for line in lines:
        stripped = line.rstrip()
        if stripped == "model:":
            in_model = True
            new_lines.append(stripped)
            continue
        if in_model:
            if stripped.startswith("  ") or stripped == "" or stripped.startswith("#"):
                continue
            else:
                in_model = False
                new_lines.append(stripped)
                continue
        new_lines.append(stripped)
    if not wrote:
        new_lines.insert(0, "model:")
        for k, v in model_cfg.items():
            new_lines.insert(1, f"  {k}: {v}")
    CONFIG_FILE.write_text("\n".join(new_lines) + "\n")
    return True


# ── Routes ──

FRONTEND_DIR = Path(__file__).parent / "frontend" / "dist"

@app.get("/api/health")
def health():
    c = run(["docker", "inspect", CONTAINER_NAME, "--format", "{{.State.Status}}"])
    return {
        "status": "ok",
        "time": datetime.now(timezone.utc).isoformat(),
        "container": c.get("stdout", "unknown").strip(),
    }

# ── Kanban ──
@app.get("/api/kanban-tasks")
def list_tasks(): return get_kanban()

@app.post("/api/kanban-tasks")
def create_task(task: TaskCreate):
    return {"id": add_kanban_task(task)}

@app.patch("/api/kanban-tasks/{task_id}")
def patch_task(task_id: str, update: TaskUpdate):
    update_kanban_task(task_id, update)
    return {"ok": True}

@app.delete("/api/kanban-tasks/{task_id}")
def remove_task(task_id: str):
    delete_kanban_task(task_id)
    return {"ok": True}

# ── LLM Config ──
@app.get("/api/config")
def config_get():
    return read_config()

@app.put("/api/config")
def config_update(update: ConfigUpdate):
    cfg = yaml.safe_load(CONFIG_FILE.read_text()) or {}
    mod = cfg.setdefault("model", {})
    if update.model is not None: mod["default"] = update.model
    if update.provider is not None: mod["provider"] = update.provider
    if update.base_url is not None: mod["base_url"] = update.base_url
    if update.max_turns is not None: cfg.setdefault("agent", {})["max_turns"] = update.max_turns
    CONFIG_FILE.write_text(yaml.dump(cfg, default_flow_style=False, sort_keys=False))
    return {"ok": True, "message": "Config updated. Restart container to apply."}

@app.get("/api/config/raw")
def config_raw():
    return {"text": CONFIG_FILE.read_text() if CONFIG_FILE.exists() else ""}

@app.put("/api/config/raw")
def config_raw_update(data: dict):
    text = data.get("text", "")
    if not text: raise HTTPException(400, "text required")
    CONFIG_FILE.write_text(text)
    return {"ok": True, "message": "Config written. Restart container to apply."}

@app.post("/api/config/restart")
def config_restart():
    return run(["docker", "restart", CONTAINER_NAME], timeout=60)

# ── Cron ──
@app.get("/api/cron-jobs")
def cron_status():
    data = read_json(CRON_JOBS)
    jobs = data.get("jobs", [])
    for j in jobs:
        if j.get("enabled") is False or j.get("state") == "paused":
            j["health"] = "paused"
        elif j.get("last_status") == "error":
            j["health"] = "error"
        elif j.get("last_run_at"):
            try:
                last = datetime.fromisoformat(j["last_run_at"].replace("Z", "+00:00"))
                age = (datetime.now(timezone.utc) - last).total_seconds() / 3600
                j["health"] = "ok" if age < 48 else "stale"
            except:
                j["health"] = "unknown"
        else:
            j["health"] = "never_run"
    return jobs

@app.post("/api/cron/{job_id}/toggle")
def cron_toggle(job_id: str):
    data = read_json(CRON_JOBS)
    for j in data.get("jobs", []):
        if j["id"] == job_id:
            j["enabled"] = not j.get("enabled", True)
            j["state"] = "scheduled" if j["enabled"] else "paused"
            if not j["enabled"]:
                j["paused_at"] = datetime.now(timezone.utc).isoformat()
            else:
                j["paused_at"] = None
                j["paused_reason"] = None
            write_json(CRON_JOBS, data)
            return {"ok": True, "enabled": j["enabled"]}
    raise HTTPException(404, "job not found")

@app.post("/api/cron/{job_id}/trigger")
def cron_trigger(job_id: str):
    return run(["python3", "-c", f"""
import json, subprocess
from pathlib import Path
data = json.loads(Path('/docker/hermes-agent-0hzy/data/cron/jobs.json').read_text())
for j in data['jobs']:
    if j['id'] == '{job_id}':
        print(f"Triggered: {{j['name']}}")
        break
"""])
# ── Pipeline ──
@app.get("/api/pipeline")
def pipeline_stats():
    data = read_json(JOBS_FILE)
    jobs = data.get("jobs", [])
    kourchal = [j for j in jobs if j.get("profile") == "kourchal"]
    mehdi = [j for j in jobs if j.get("profile") != "kourchal"]
    return {
        "total": len(jobs),
        "mehdi": {"total": len(mehdi), "applied": sum(1 for j in mehdi if j.get("status") == "applied")},
        "kourchal": {"total": len(kourchal), "applied": sum(1 for j in kourchal if j.get("status") == "applied")},
        "recent": jobs[-5:],
    }

# ── Credits ──
@app.get("/api/credits")
def credit_status():
    env = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return {
        "apify": bool(env.get("APIFY_API_KEY")),
        "tavily": bool(env.get("TAVILY_API_KEY")),
        "brave": bool(env.get("BRAVE_SEARCH_API_KEY")),
        "openrouter": bool(env.get("OPENROUTER_API_KEY")),
        "ninja": bool(env.get("NINJA_API_KEY")),
        "opencode_zen": bool(env.get("OPCODE_ZEN_API_KEY")),
    }

# ── Soul ──
@app.get("/api/soul-summary")
def soul_summary():
    if not SOUL_FILE.exists():
        return {"missions": [], "schedule": []}
    text = SOUL_FILE.read_text()
    missions, schedule = [], []
    in_mission = in_schedule = False
    for line in text.splitlines():
        if line.startswith("## §1."):
            in_mission = True; continue
        if line.startswith("## §"):
            in_mission = in_schedule = False
        if line.strip() == "**Cron schedule (locked, 2026-06-15)**":
            in_schedule = True; continue
        if in_mission and line.strip().startswith(("1.", "2.", "3.", "4.")):
            missions.append(line.strip().split("—")[-1].strip() if "—" in line else line.strip())
        if in_schedule and line.strip().startswith("|") and "|---|---|---" not in line:
            parts = [p.strip() for p in line.strip().split("|") if p.strip()]
            if len(parts) >= 4:
                schedule.append({"time": parts[0], "job": parts[1], "profile": parts[2], "deliver": parts[3]})
    return {"missions": missions, "schedule": schedule}

# ── Container ──
@app.get("/api/container")
def container_info():
    return {
        "inspect": run(["docker", "inspect", CONTAINER_NAME, "--format",
            '{{.State.Status}}\t{{.State.StartedAt}}\t{{.Config.Image}}']),
        "logs_tail": run(["docker", "logs", "--tail", "50", CONTAINER_NAME]),
        "stats": run(["docker", "stats", CONTAINER_NAME, "--no-stream", "--format",
            '{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}']),
    }

@app.post("/api/container/restart")
def container_restart():
    return run(["docker", "restart", CONTAINER_NAME], timeout=60)

@app.get("/api/container/logs")
def container_logs(lines: int = 100):
    return run(["docker", "logs", "--tail", str(lines), CONTAINER_NAME])

# ── Env ──
@app.get("/api/env")
def env_status():
    """List env keys without exposing values."""
    if not ENV_FILE.exists():
        return {}
    keys = []
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k = line.split("=", 1)[0].strip()
            keys.append(k)
    return {"keys": sorted(keys)}

# ── Scripts ──
@app.get("/api/scripts")
def list_scripts():
    scripts_dir = DATA_DIR / "saqr" / "scripts"
    if not scripts_dir.exists():
        return []
    files = []
    for f in sorted(scripts_dir.iterdir()):
        if f.suffix in (".py", ".sh") and not f.name.startswith("__"):
            files.append({"name": f.name, "size": f.stat().st_size, "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat()})
    return files

@app.post("/api/scripts/{name}/run")
def run_script(name: str):
    script_path = DATA_DIR / "saqr" / "scripts" / name
    if not script_path.exists():
        raise HTTPException(404, "script not found")
    if script_path.suffix == ".sh":
        return run(["bash", str(script_path)], timeout=120)
    return run(["python3", str(script_path)], timeout=120)


# ── Webhook ──
WEBHOOK_SECRET = "fc98c9ca6e57ce5bc07e07323724c252"

@app.post("/")
@app.post("/webhook")
async def webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("x-hub-signature-256", "")
    expected = "sha256=" + hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(401, "invalid signature")
    event = request.headers.get("x-github-event", "")
    if event == "push":
        def deploy():
            time.sleep(1)
            subprocess.run(["bash", "/root/saqr-dashboard/deploy.sh"], capture_output=True)
        threading.Thread(target=deploy, daemon=True).start()
        return {"ok": True, "message": "deploy triggered"}
    return {"ok": True, "message": f"event {event} ignored"}

if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR / "assets")), name="assets")

    @app.get("/")
    def index():
        return FileResponse(str(FRONTEND_DIR / "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9090)
