import express from "express";
import { Database } from "bun:sqlite";
import axios from "axios";
import { z } from "zod";
import OpenAI from "openai";
import cors from "cors";
import path from "path";

// --- Configuration ---
const PORT = parseInt(process.env.PORT || "3000");
const DB_PATH = "issues.db";

// 'http://localhost:11434/v1' (Ollama) or 'http://localhost:1234/v1' (LM Studio)
const LLM_BASE_URL = process.env.LLM_URL || "http://localhost:1234/v1";
const LLM_API_KEY = "lm-studio"; //ignored by cant be empty

// --- Database Setup (SQLite) ---
// Choice Reasoning: SQLite is durable, serverless, and handles relational queries (filtering by repo)
// better than a flat JSON file, without the overhead of Postgres.
const db = new Database(DB_PATH);

// We store 'number' (human readable #ID) separately from internal GitHub 'id'
db.run(`
  CREATE TABLE IF NOT EXISTS issues (
    repo TEXT,
    id INTEGER,
    number INTEGER,
    title TEXT,
    body TEXT,
    html_url TEXT,
    created_at TEXT,
    PRIMARY KEY (repo, id)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS repo_scans (
    repo TEXT PRIMARY KEY,
    last_scanned_at TEXT,
    total_issues INTEGER DEFAULT 0
  )
`);

// --- AI & Validation Setup ---
const openai = new OpenAI({ baseURL: LLM_BASE_URL, apiKey: LLM_API_KEY });
const ScanSchema = z.object({ repo: z.string().min(1) });
const AnalyzeSchema = z.object({
  repo: z.string().min(1),
  prompt: z.string().min(1),
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --- /scan ---
app.post("/scan", async (req, res) => {
  const validation = ScanSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).json({ error: validation.error });

  const { repo } = validation.data;
  console.log(`[SCAN] Starting scan for ${repo}...`);

  // 1. Check existing scan state
  const scanStmt = db.query(
    "SELECT last_scanned_at FROM repo_scans WHERE repo = $repo"
  );
  const scanRow = scanStmt.get({ $repo: repo }) as any;

  const isFirstScan = !scanRow;
  const sinceParam = scanRow?.last_scanned_at
    ? `&since=${scanRow.last_scanned_at}`
    : "";

  console.log(
    `${isFirstScan ? "First" : "Resuming"} scan${
      sinceParam ? ` since ${scanRow!.last_scanned_at.slice(0, 19)}` : ""
    }`
  );

  let newIssues = 0;
  let page = 1;
  const MAX_PAGES = 10; // Increased for deeper history
  let hasMore = true;

  try {
    while (hasMore && page <= MAX_PAGES) {
      const url = `https://api.github.com/repos/${repo}/issues?state=open&per_page=100&page=${page}&sort=created&direction=desc${sinceParam}`;

      const response = await axios.get(url, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          "User-Agent": "github-issue-analyzer",
        },
        validateStatus: (status) => status < 500,
      });

      if (response.status === 404)
        return res.status(404).json({ error: "Repository not found" });
      if (response.status !== 200)
        throw new Error(`GitHub API: ${response.status}`);

      const data = response.data as any[];
      const filtered = data.filter((i: any) => !i.pull_request);

      if (filtered.length === 0) {
        hasMore = false;
      } else {
        // Insert/replace (dedupes automatically)
        const insert = db.prepare(`
          INSERT OR REPLACE INTO issues (repo, id, number, title, body, html_url, created_at)
          VALUES ($repo, $id, $number, $title, $body, $html_url, $created_at)
        `);
        const tx = db.transaction((issues: any[]) => {
          for (const issue of issues) insert.run(issue);
        });
        tx(
          filtered.map((i) => ({
            $repo: repo,
            $id: i.id,
            $number: i.number,
            $title: i.title,
            $body: i.body || "",
            $html_url: i.html_url,
            $created_at: i.created_at,
          }))
        );

        newIssues += filtered.length;
        console.log(
          `Page ${page}: +${filtered.length} new issues (total new: ${newIssues})`
        );

        hasMore = filtered.length === 100; // Continue if full page
        page++;
      }
    }
    console.log("DONE!!")

    // 2. Update scan metadata (always, even if no new)
    const countStmt = db.query(
      "SELECT COUNT(*) as cnt FROM issues WHERE repo = $repo"
    );
    const finalCount = (countStmt.get({ $repo: repo }) as any)?.cnt || 0;

    const updateStmt = db.prepare(
      "INSERT OR REPLACE INTO repo_scans (repo, last_scanned_at, total_issues) VALUES (?, ?, ?)"
    );
    const now = new Date().toISOString();
    updateStmt.run(repo, now, finalCount);

    // 3. Edge case messages
    const status = isFirstScan
      ? "first_scan"
      : newIssues > 0
      ? "updated"
      : "no_changes";

    res.json({
      repo,
      status, // "first_scan" | "updated" | "no_changes"
      new_fetched: newIssues,
      issues_fetched: finalCount,
      last_scanned_at: now,
      cached_successfully: true,
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// --- /analyze ---
app.post("/analyze", async (req, res) => {
  const validation = AnalyzeSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).json({ error: validation.error });

  const { repo, prompt } = validation.data;
  console.log(`[ANALYZE] Analyzing ${repo} with prompt: "${prompt}"`);

  try {
    // 1. Retrieve issues from SQLite
    const query = db.prepare(
      "SELECT number, title, body FROM issues WHERE repo = $repo ORDER BY created_at DESC"
    );
    const rows = query.all({ $repo: repo }) as {
      number: number;
      title: string;
      body: string;
    }[];

    if (rows.length === 0)
      return res
        .status(404)
        .json({ error: "No issues found in cache. Please /scan first." });

    // 2. Context Construction (Simple Truncation)
    // We limit context to ~12k characters to be safe for most local LLMs (approx 3k-4k tokens)
    const MAX_CHARS = 12000;
    let context = "";

    for (const row of rows) {
      const issueText = `[ID: #${row.number}] Title: ${
        row.title
      }\nBody: ${row.body.slice(0, 200).replace(/\s+/g, " ")}...\n\n`;
      if (context.length + issueText.length > MAX_CHARS) break;
      context += issueText;
    }

    // 3. Call LLM
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are a technical assistant. Analyze the following GitHub issues and answer the user's question. Reference issue numbers (e.g. #102) where relevant.",
        },
        {
          role: "user",
          content: `Issues List:\n${context}\n\nUser Question: ${prompt}`,
        },
      ],
      model: "local-model", // LM Studio ignores this, Ollama might need specific model name
      temperature: 0.7,
    });

    return res.json({ analysis: completion.choices[0].message.content });
  } catch (error: any) {
    console.error(error);
    return res
      .status(500)
      .json({ error: "LLM Analysis failed", details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Connected to LLM at ${LLM_BASE_URL}`);
});
