# GitHub Issue Analyzer (Local LLM)

A backend service that fetches GitHub **open issues**, caches them locally using **SQLite**, and analyzes them with a **local LLM** (LM Studio/Ollama).

[![SQLite](https://img.shields.io/badge/Storage-SQLite-green)](https://bun.sh/docs/api/sqlite) [![Bun](https://img.shields.io/badge/Runtime-Bun-blue)](https://bun.sh/)

**Incremental Scanning** Incremental rescans fetch only new issues, rate-limit safe, deep history.
**Validation** Type-safe inputs, 400 errors for bad JSON.
**Usage flow** (visit → scan → analyze)

## Quickstart

### 1. Prerequisites

- **Bun**
- **LM Studio** or **Ollama** running locally:
  - _LM Studio_: Load model → Start server on `localhost:1234`
  - _Ollama_: `ollama serve` on `localhost:11434`

### 2. Install Bun

curl -fsSL https://bun.sh/install | bash

### 3. Clone & Install

```
git clone https://github.com/soura0/github-issue-analyzer
cd github-issue-analyzer
bun install
```

### 4. Start Local LLM (Pick One)

#### Option A: LM Studio (Faster, Recommended)

1. Download: https://lmstudio.ai/
2. Load gtp-oss/Llama3 → "Local Server" tab
3. Start Server → http://localhost:1234/v1

#### Option B: Ollama



```
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3
ollama serve  # Runs on :11434
```

### 5. Configure `.env`

1. **Copy template**:

```
cp .env.example .env
```

### 6. Run

```
bun run dev
```

## Frontend (Optional)

Live UI at http://localhost:3000 - No setup needed

## Architecture Decisions

### Why SQLite?

I chose SQLite (via bun:sqlite) over In-memory or JSON files for three reasons:

Durability: Unlike in-memory storage, the data persists if the server crashes or restarts.

Query Efficiency: As repositories grow, querying a specific repo via SQL (SELECT ... WHERE repo = ?) is significantly faster and cleaner than parsing a massive JSON file into memory every time.

Simplicity: It requires zero setup (no separate DB server process) but offers robust relational data integrity.

### LLM Context Strategy

To handle large repositories, the /analyze endpoint constructs a prompt using the "Sliding Window" approach (approximated):

Issues are sorted by created_at (newest first).

Issue bodies are truncated to 200 characters to reduce noise.

The context buffer is capped at ~12,000 characters to ensure we stay within the context window of standard local models (like Llama 3 or Mistral).
