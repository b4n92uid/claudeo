# claudeo

Interactive hub to resume **Claude Code** sessions across directories. Global
binary `claudeo` (the default, zero-install entry point). An optional shell-function
wrapper — name chosen by the developer, default `claudeo` (shadows the binary) —
additionally leaves the parent shell in the chosen dir.

## What it does

A **two-step, type-to-filter picker** (newest-first at each step): first pick a
**project**, then a **session** within it. Each step has a live search bar. **Esc**
in the session step goes **back** to the project list; Esc in the project step
**quits**. Sessions are grouped by their real `cwd` via `groupByProject()` in
`src/sessions.ts`.

## Two run modes (`src/cli.ts`)

`selectSession()` renders the picker once and returns the chosen session (re-reading
the list each call). `pick()` branches on whether the wrapper is driving it:

- **Hub mode (default, no wrapper).** `runClaude()` spawns `claude --resume <id>` as
  a child with `cwd` set + `stdio: inherit`; when it exits, loop back to the picker.
  `--once` resumes a single session and exits instead of looping. The parent shell's
  cwd does **not** change (a child can't move its parent) — that's the wrapper's job.
- **Wrapper mode (`CLAUDEO_OUT` set).** One-shot: write `<cwd>\n<sessionId>`
  to `$CLAUDEO_OUT` and return; the shell function reads it, `cd`s the **parent**
  shell into `<cwd>`, then runs `claude --resume`. On cancel, nothing is written →
  the function is a no-op.

## Why the optional shell function

A child process cannot change its parent shell's working directory — only the shell
can. So the wrapper (PowerShell / bash, from `src/shell.ts` via `claudeo shell-init
[shell] [name]`) wraps the binary purely to leave your shell in the project dir after
Claude exits. Hub mode covers everything else without any profile edit.

The function name is the developer's choice (default `claudeo`). The emitted function
always calls the **binary** via a function-bypassing form — `command claudeo` (bash)
and `Get-Command -CommandType Application claudeo` (pwsh) — so naming the function
`claudeo` shadows the bare command to add cd-persistence **without recursing**. The
bash template injects the `${dir//\\//}` parameter-expansion via a `__DIRFIX__`
placeholder so it survives JS template-literal interpolation.

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
- `src/shell.ts` — the cd-persisting wrapper text for pwsh / bash, named per
  `claudeo shell-init [shell] [name]` (default `claudeo`).

## Commands

```bash
npm install          # deps
npm run build        # tsup -> dist/cli.js (ESM, with shebang)
npm run dev          # tsup --watch
npm link             # register `claudeo` globally (or: npm run link = build+link)
node dist/cli.js     # run locally without linking
```

### Install the optional cd-persisting wrapper

```powershell
# PowerShell (primary). Append the wrapper to your profile, then reload.
# Pass a name (e.g. `cs`) as a 2nd arg to use that instead of `claudeo`.
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
