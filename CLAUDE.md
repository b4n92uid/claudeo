# claudeo

Interactive terminal picker to resume **Claude Code** sessions across directories.
Global binary `claudeo`; the user-facing command is the shell function **`co`**.

## What it does

`co` walks you through a **two-step, type-to-filter picker** (newest-first at each
step): first pick a **project**, then pick a **session** within it. Each step has a
live search bar. **Esc** in the session step goes **back** to the project list; Esc
in the project step **quits**. On selection it **cd's into that session's directory
and runs `claude --resume <id>`**. Sessions are grouped by their real `cwd` via
`groupByProject()` in `src/sessions.ts`.

## Why a shell function and not just a binary

A child process cannot change its parent shell's working directory. So `co` is a
shell function (PowerShell / bash) that wraps the `claudeo` binary:

1. `co` sets `CLAUDEO_OUT` to a temp file and runs `claudeo`.
2. `claudeo` renders the picker on the terminal. On selection it writes two lines
   to `$CLAUDEO_OUT`:  `<cwd>\n<sessionId>`.
3. `co` reads them, `cd`s into `<cwd>`, then runs `claude --resume <sessionId>`.
4. On cancel, `claudeo` writes nothing → `co` is a no-op.

Run `claudeo` standalone (no wrapper) and it falls back to spawning `claude`
itself in the chosen dir (cwd won't persist in the parent shell).

## Where the data comes from

Claude Code stores everything under `~/.claude/`:

- `projects/<encoded-dir>/<sessionId>.jsonl` — full transcripts (ground truth of
  what is resumable). Folder name is a **lossy, one-way** encoding of the cwd
  (`\` `/` `:` `.` all → `-`), so it cannot be reversed.
- `history.jsonl` — flat log of every typed prompt:
  `{ display, timestamp, project (=canonical cwd), sessionId }`. One small file →
  cwd + first prompt per session, cheaply. Not complete (capped/rotated, and
  retains deleted projects).

`listSessions()` walks the transcript files (ground truth), then enriches each
with cwd + first prompt from `history.jsonl`. When a session is missing from
history, it falls back to one 64 KiB head-read of the transcript
(`readHeadFromTranscript`) that recovers **both** the `cwd` field and the first
typed user prompt — so history-missing sessions still show a prompt instead of
"(no prompt recorded)". The read fires only when history lacks cwd (the same
condition as before), so it adds no I/O. Command/tool-result envelopes (content
starting with `<`, or non-text blocks) are skipped so the first *real* prompt
wins. The real path always comes from a `cwd`/`project` **field**, never from
decoding the folder name. Note drive-letter case can vary per event (`W:` vs `w:`); the
filesystem is case-insensitive on Windows so folder lookups still match, and
`groupByProject()` folds case when keying so `W:\…` / `w:\…` variants collapse into
one project (newest session's casing wins for display).

## Layout

- `src/cli.ts` — commander entry, two-step picker flow, output/spawn logic.
- `src/prompt.ts` — `filterSelect`, a type-to-filter select built on `@inquirer/core`
  (synchronous source + an Esc keybinding the stock `search` prompt lacks).
- `src/sessions.ts` — data layer: reads `~/.claude`, builds the `Session[]` list.
- `src/shell.ts` — the `co` wrapper text for pwsh / bash (`claudeo shell-init`).

## Commands

```bash
npm install          # deps
npm run build        # tsup -> dist/cli.js (ESM, with shebang)
npm run dev          # tsup --watch
npm link             # register `claudeo` globally (or: npm run link = build+link)
node dist/cli.js     # run locally without linking
```

### Install the `co` command

```powershell
# PowerShell (primary). Append the wrapper to your profile, then reload:
claudeo shell-init pwsh | Add-Content $PROFILE
. $PROFILE
```

```bash
# bash
claudeo shell-init bash >> ~/.bashrc && source ~/.bashrc
```

## Stack & conventions

- TypeScript, ESM, Node ≥18. Built with **tsup** (no hand-written build).
- UI is a custom `filterSelect` prompt (`src/prompt.ts`) built on **@inquirer/core**.
  The intro/outro/cancel banner lines are tiny `picocolors` helpers at the top of
  `src/cli.ts` (no prompt framework). Keep custom terminal drawing to a minimum —
  build on `@inquirer/core` hooks rather than bespoke ANSI code.
- `picocolors` for color, `commander` for arg parsing.
- `strict` + `noUncheckedIndexedAccess` are on — respect them.

## Ideas / TODO

- Show git branch / session summary (transcript has `gitBranch`, `summary`,
  `ai-title` record types) in the hint.
- `--cwd <path>` to scope to one project; `--new` to start a fresh session.
