"GitHub API Integration"

"SQLite schema for GitHub issues: separate 'number' (#123) from internal GitHub 'id', PRIMARY KEY(repo,id).
Add repo_scans table for last_scanned_at timestamp."

"GitHub REST API: List repository issues endpoint, state=open, per_page=100, pagination with page param,
sort=created direction=desc. Filter out pull requests using !i.pull_request. Handle 404 repo not found."

"GitHub API rate limits: authenticated vs unauthenticated"

"GitHub issues API 'since' parameter: fetch only issues created after timestamp to support incremental scanning.
Format: 2026-01-04. Combine with pagination."

"Make /scan incremental: check last_scanned_at, add since param, count new_fetched vs total_cached,
status: first_scan/updated/no_changes. Update metadata after every scan."

"bun:sqlite TypeError: db.get is not a function. What's the correct way to query single row?
db.query(sql).get() vs db.prepare()? Positional ? vs named $params for .run()?"

"I use Ollama (localhost:11434) but want to support LM Studio (localhost:1234).
OpenAI client with custom baseURL, same /v1/chat/completions endpoint"

"Vanilla JS frontend for /scan  /analyze APIs. Two forms, loading states, JSON pretty-print results, copy-to-clipboard, error handling, pico CSS, single index.html."

