import {
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const ROOT = join(homedir(), ".claude");
const PROJECTS_DIR = join(ROOT, "projects");
const HISTORY = join(ROOT, "history.jsonl");

export interface Session {
  /** session UUID (transcript filename, also `claude --resume <id>`) */
  id: string;
  /** real working directory the session ran in */
  cwd: string;
  /** last-activity time, ms epoch (transcript mtime) */
  mtime: number;
  /** first user prompt, when known (from history.jsonl) */
  firstPrompt?: string;
  /** short label for display (basename of cwd) */
  project: string;
  /** absolute path to the transcript .jsonl */
  file: string;
}

interface HistEntry {
  cwd: string;
  firstPrompt?: string;
  firstTs: number;
}

/**
 * history.jsonl is a flat append-only log of every typed prompt:
 *   { display, timestamp, project (=canonical cwd), sessionId }
 * One small file -> cwd + first prompt per session, cheaply.
 */
function readHistory(): Map<string, HistEntry> {
  const map = new Map<string, HistEntry>();
  if (!existsSync(HISTORY)) return map;
  let raw: string;
  try {
    raw = readFileSync(HISTORY, "utf8");
  } catch {
    return map;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const o = JSON.parse(line);
      if (!o.sessionId || !o.project) continue;
      const ts: number = o.timestamp ?? 0;
      const cur = map.get(o.sessionId);
      if (!cur || ts < cur.firstTs) {
        map.set(o.sessionId, {
          cwd: o.project,
          firstPrompt: o.display ?? cur?.firstPrompt,
          firstTs: cur ? Math.min(cur.firstTs, ts) : ts,
        });
      }
    } catch {
      /* skip malformed line */
    }
  }
  return map;
}

/**
 * Fallback for sessions missing from history.jsonl: read the head of the
 * transcript once and pull both the first `cwd` and the first user prompt.
 * Reads at most 256 KiB — enough to clear leading attachments/context before
 * the first prompt. Either field may be undefined if not found in the head.
 */
function readHeadFromTranscript(file: string): { cwd?: string; firstPrompt?: string } {
  const out: { cwd?: string; firstPrompt?: string } = {};
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(256 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const text = buf.subarray(0, n).toString("utf8");
    for (const line of text.split("\n")) {
      if (!line) continue;
      let rec: { cwd?: unknown; type?: unknown; message?: { role?: unknown; content?: unknown } };
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // partial last line / non-JSON, ignore
      }
      if (out.cwd === undefined && typeof rec.cwd === "string") out.cwd = rec.cwd;
      if (out.firstPrompt === undefined) out.firstPrompt = firstUserText(rec);
      if (out.cwd !== undefined && out.firstPrompt !== undefined) break;
    }
  } catch {
    /* unreadable */
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return out;
}

/**
 * Tag names Claude Code wraps around injected (non-user-typed) content. A text
 * block opening with one of these is an envelope, not the prompt — but a real
 * prompt that merely starts with `<` (e.g. `<div>…`) is kept.
 */
const ENVELOPE_TAGS = new Set([
  "system-reminder",
  "command-message",
  "command-name",
  "command-args",
  "local-command-stdout",
  "local-command-caveat",
  "user-prompt-submit-hook",
  "bash-input",
  "bash-stdout",
  "bash-stderr",
]);

/** True when `text` opens with a known Claude Code envelope tag. */
function isEnvelope(text: string): boolean {
  const m = /^<\/?([a-z][a-z0-9-]*)/.exec(text);
  return m ? ENVELOPE_TAGS.has(m[1]!) : false;
}

/**
 * Pull the text of a first typed user prompt from a transcript record, if this
 * record is one. Transcript user turns look like
 *   { type: "user", message: { role: "user", content: "..." | [{type:"text",text}] } }
 * Tool results also arrive as `user` records with array content but no text
 * blocks, so those naturally yield nothing.
 */
function firstUserText(rec: {
  type?: unknown;
  message?: { role?: unknown; content?: unknown };
}): string | undefined {
  if (rec.type !== "user" || !rec.message || rec.message.role !== "user") return undefined;
  const content = rec.message.content;

  // Collect every text candidate in order. A single user turn often holds an
  // envelope text block (`<system-reminder>` / command caveat) followed by the
  // actual prompt, so we keep all of them and pick the first real one below.
  const texts: string[] = [];
  if (typeof content === "string") {
    texts.push(content);
  } else if (Array.isArray(content)) {
    for (const b of content) {
      if (b && typeof b === "object" && (b as { type?: unknown }).type === "text") {
        const t = (b as { text?: unknown }).text;
        if (typeof t === "string") texts.push(t);
      }
    }
  }

  for (const raw of texts) {
    const text = raw.trim();
    if (text && !isEnvelope(text)) return text;
  }
  return undefined;
}

/**
 * Build the flat, newest-first list of resumable sessions.
 *
 * Ground truth = transcript files under ~/.claude/projects/<folder>/*.jsonl
 * (a folder may exist with no history entry). Enriched with cwd + first
 * prompt from history.jsonl where present; cwd falls back to the transcript.
 */
export function listSessions(): Session[] {
  const hist = readHistory();
  const out: Session[] = [];
  if (!existsSync(PROJECTS_DIR)) return out;

  let folders: string[];
  try {
    folders = readdirSync(PROJECTS_DIR);
  } catch {
    return out;
  }

  for (const folder of folders) {
    const dir = join(PROJECTS_DIR, folder);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = join(dir, f);
      const id = f.replace(/\.jsonl$/, "");
      let mtime = 0;
      try {
        mtime = statSync(file).mtimeMs;
      } catch {
        continue;
      }
      const h = hist.get(id);
      // Read the transcript head only when history lacks cwd — exactly the old
      // cwd-only condition, so this adds no I/O. The same read also yields the
      // first prompt, recovering it for the history-missing sessions that would
      // otherwise show "(no prompt recorded)".
      const head = h?.cwd ? undefined : readHeadFromTranscript(file);
      const cwd = h?.cwd ?? head?.cwd;
      if (!cwd) continue;
      out.push({
        id,
        cwd,
        mtime,
        firstPrompt: h?.firstPrompt ?? head?.firstPrompt,
        project: basename(cwd) || cwd,
        file,
      });
    }
  }

  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

export interface Project {
  /** real working directory shared by these sessions (group key) */
  cwd: string;
  /** short label for display (basename of cwd) */
  project: string;
  /** sessions in this project, newest-first */
  sessions: Session[];
  /** most-recent session activity in this project, ms epoch */
  mtime: number;
}

/**
 * Collapse a flat session list into per-project groups. Keyed by the real cwd,
 * compared case-insensitively so paths that differ only in casing — e.g. the
 * `W:` vs `w:` drive-letter variants Claude Code records per event — merge into
 * one project. The first (newest) session's casing supplies the display path.
 * Both the project list and each project's sessions stay newest-first.
 */
export function groupByProject(sessions: Session[]): Project[] {
  const map = new Map<string, Project>();
  for (const s of sessions) {
    const key = s.cwd.toLowerCase();
    const g = map.get(key);
    if (g) {
      g.sessions.push(s);
      if (s.mtime > g.mtime) g.mtime = s.mtime;
    } else {
      map.set(key, {
        cwd: s.cwd,
        project: s.project,
        sessions: [s],
        mtime: s.mtime,
      });
    }
  }
  const out = [...map.values()];
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}
