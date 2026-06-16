# SAQR Command Center

FastAPI dashboard acting as a control plane for the Hermes agent. Runs as a systemd service (port `9090`), reverse-proxied by Caddy at `cmd.kaliits.cloud`.

## Architecture

```
Browser → cmd.kaliits.cloud (Caddy) → localhost:9090 (uvicorn/FastAPI)
                                            ↓
                          /docker/hermes-agent-0hzy/data/
                            ├── kanban.db     (SQLite — shared with Hermes gateway)
                            ├── config.yaml   (Hermes agent config)
                            ├── cron/jobs.json
                            ├── jobs.json     (pipeline leads)
                            ├── .env          (API keys)
                            └── saqr/scripts/ (38 Python/bash scripts)
```

The Hermes agent runs in a Docker container with `/docker/hermes-agent-0hzy/data` mounted to `/opt/data` (rw). The Command Center writes directly to these files, and the Hermes gateway process reads them.

## API Endpoints

### System

| Method | Endpoint | Description | File |
|--------|----------|-------------|------|
| GET | `/api/health` | Container status + timestamp | `main.py:425` |
| GET | `/api/overview` | Aggregated dashboard data | `main.py:436` |

### Kanban

Writes to `kanban.db` — the same SQLite database the Hermes gateway watches every 60s.

| Method | Endpoint | Description | File |
|--------|----------|-------------|------|
| GET | `/api/kanban-tasks` | List all tasks (priority DESC, created DESC) | `main.py:468` |
| POST | `/api/kanban-tasks` | Create task (auto-assigns `"default"` profile) | `main.py:473` |
| PATCH | `/api/kanban-tasks/{id}` | Update task fields | `main.py:478` |
| DELETE | `/api/kanban-tasks/{id}` | Delete task by ID | `main.py:484` |

Valid statuses: `backlog`, `ready`, `in_progress`, `blocked`, `done`
Valid priorities: `0` (Normal), `1` (High), `2` (Critical)

Tasks are dispatched by the Hermes gateway when `status=ready` and `assignee=default`.

### Config

Reads/writes `config.yaml` (Hermes agent configuration). Restart the container to apply changes.

| Method | Endpoint | Description | File |
|--------|----------|-------------|------|
| GET | `/api/config` | Model, fallback providers, agent, delegation | `main.py:490` |
| PUT | `/api/config` | Update model/provider/base_url/max_turns/temperature | `main.py:495` |
| GET | `/api/config/raw` | Raw YAML text | `main.py:501` |
| PUT | `/api/config/raw` | Replace full YAML config | `main.py:506` |
| POST | `/api/config/restart` | Restart Hermes Docker container | `main.py:512` |

### Cron

Reads/writes `cron/jobs.json`. Health states: `ok`, `stale` (48h+), `error`, `never_run`, `paused`.

| Method | Endpoint | Description | File |
|--------|----------|-------------|------|
| GET | `/api/cron-jobs` | List all cron jobs with health | `main.py:517` |
| POST | `/api/cron/{id}/toggle` | Enable/disable a job | `main.py:522` |
| POST | `/api/cron/{id}/trigger` | Manual trigger placeholder | `main.py:539` |

### Pipeline

Reads `jobs.json` — tracks job-hunting leads for two profiles (mehdi / kourchal).

| Method | Endpoint | Description | File |
|--------|----------|-------------|------|
| GET | `/api/pipeline` | Total/applied counts per profile + last 5 leads | `main.py:551` |

### Credits

Checks for API key presence in `.env` (values are never exposed).

| Method | Endpoint | Description | File |
|--------|----------|-------------|------|
| GET | `/api/credits` | Boolean map per service | `main.py:556` |

Services checked: `apify`, `tavily`, `brave`, `openrouter`, `ninja`, `opencode_zen`

### Missions

Parses `SOUL.md` (agent doctrine / second brain).

| Method | Endpoint | Description | File |
|--------|----------|-------------|------|
| GET | `/api/soul-summary` | Missions list + cron schedule table | `main.py:561` |

### Container

Runs `docker` commands on the host.

| Method | Endpoint | Description | File |
|--------|----------|-------------|------|
| GET | `/api/container` | Inspect + logs (50 lines) + CPU/Mem/Net stats | `main.py:594` |
| POST | `/api/container/restart` | `docker restart` the container | `main.py:620` |
| GET | `/api/container/logs?lines=N` | Tail container logs (max 500) | `main.py:625` |

### Environment

| Method | Endpoint | Description | File |
|--------|----------|-------------|------|
| GET | `/api/env` | List env var names (keys only, no values) | `main.py:631` |

### Scripts

Executes Python/bash scripts from `saqr/scripts/`.

| Method | Endpoint | Description | File |
|--------|----------|-------------|------|
| GET | `/api/scripts` | List scripts (name, size, modified) | `main.py:643` |
| POST | `/api/scripts/{name}/run` | Execute a script (120s timeout) | `main.py:661` |

## Deployment

- **Service**: `saqr-dashboard.service` (systemd, runs as root)
- **Startup**: `ExecStart=/usr/bin/python3 /root/saqr-dashboard/main.py`
- **Auto-deploy**: Webhook endpoint + `deploy.sh` syncs git, rebuilds frontend, restarts service
