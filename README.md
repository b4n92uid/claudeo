<p align="center">
  <img src="assets/banner.png" alt="Claudeo — resume Claude Code sessions, anywhere" width="100%">
</p>

<p align="center">
  <b>An interactive hub to resume <a href="https://claude.com/claude-code">Claude Code</a> sessions across every directory.</b><br>
  Run <code>claudeo</code>, filter to a project, pick a session — it launches Claude in that directory and returns you to the picker when you exit.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white" alt="Node ≥18">
  <img src="https://img.shields.io/badge/TypeScript-ESM-3178c6?logo=typescript&logoColor=white" alt="TypeScript ESM">
  <img src="https://img.shields.io/badge/license-MIT-d97757" alt="MIT License">
</p>

---

Claude Code scatters your sessions across one folder per working directory. When you
want to pick up where you left off, you have to remember *which* directory, `cd` there,
and find the right `--resume` id. **Claudeo** collapses all of that into one command:
a fuzzy, two-step picker over **every** resumable session on your machine.

## Demo

A type-to-filter picker in two steps — first the **project**, then the **session**:

```
  claudeo  104 sessions · 15 projects

? Search projects  weig
❯   4m  weight-tracker-pro   9 sessions
   1d  TheBall              3 sessions
  W:\Personal\WeightTrackerPro\Repo\weight-tracker-pro
↑↓ navigate • ⏎ select • esc quit
```

```
? Sessions in weight-tracker-pro
❯   4m  Fix the CI build error in github
   2h  Add a streak chart to the dashboard
   1d  Wire up the weigh-in reminder cron
↑↓ navigate • ⏎ select • esc back
```

Press **Esc** in the session list to pop back to the project list — your cursor lands
right back on the project you came from.

## Features

- 🔭 **Every session, one list** — walks all of `~/.claude/projects`, newest-first.
- ⌨️ **Type to filter** — a live search bar at each step (project name / path, then
  prompt text / session id).
- 🗂️ **Grouped by project** — sessions collapse under their working directory;
  case-variant paths (`W:\…` vs `w:\…`) merge into one.
- 💬 **Real prompt previews** — shows each session's first typed prompt, recovered
  straight from the transcript when the history log doesn't have it.
- 🛰️ **Session hub** — launches Claude in the session's directory, then drops you
  back at the picker when it exits, so you can hop between projects in one place.
- 📂 **Optional shell wrapper** — an opt-in shell function (named whatever you like)
  additionally leaves *your shell* in the project directory after Claude exits (a
  binary alone can't `cd` its parent).
- 🪶 **Tiny & fast** — one small TypeScript binary, no telemetry, no config.

## Install

```bash
git clone https://github.com/b4n92uid/claudeo.git && cd claudeo
npm install
npm run link        # builds + registers the `claudeo` binary globally
```

That's it — run **`claudeo`** and you have a working session hub. No shell
config required.

### Optional: leave your shell in the project

By default `claudeo` launches Claude as a child process, so when Claude exits your
shell returns to wherever it was. If you'd rather be **left in the project
directory** afterward, install the shell wrapper — a function that runs the picker,
then `cd`s your shell into the chosen directory before resuming.

**The function name is yours to choose.** Use the **same name** to upgrade `claudeo`
itself in place (the function shadows the binary and adds cd-persistence):

```powershell
# PowerShell (primary) — defines a `claudeo` function
claudeo shell-init pwsh | Add-Content $PROFILE ; . $PROFILE
```

```bash
# bash
claudeo shell-init bash >> ~/.bashrc && source ~/.bashrc
```

…or pass a **different name** to keep both — bare `claudeo` stays the looping hub,
and your alias does the cd-persisting variant:

```bash
claudeo shell-init bash cs >> ~/.bashrc && source ~/.bashrc   # adds a `cs` function
```

> **Why a shell function?** A child process can't change its parent shell's working
> directory — only the shell itself can. So the function runs the `claudeo` binary,
> which writes the chosen `<cwd>` + `<sessionId>` to a temp file; the function reads
> it, `cd`s **your shell** into that directory, then runs `claude --resume`. (Naming
> the function `claudeo` doesn't recurse — it invokes the binary via `command
> claudeo`.)

## Usage

```bash
claudeo         # hub: pick → launch Claude in its dir → back to the picker on exit
claudeo -a      # include every session (default: newest 40)
claudeo -n 100  # cap the list at N
claudeo --once  # resume a single session and exit (no return-to-picker loop)
```

With the optional wrapper installed under the same name, `claudeo` instead resumes
once and leaves your shell in the project directory. Give the wrapper a different
name to keep both.

| Key | Action |
|-----|--------|
| `type` | filter the current list |
| `↑` / `↓` | move the cursor |
| `⏎` | select |
| `Esc` | go back a step (quit / exit the hub from the project list) |
| `Ctrl+C` | cancel |

## How it works

Claude Code stores everything under `~/.claude/`:

- `projects/<encoded-dir>/<sessionId>.jsonl` — full transcripts (the ground truth of
  what's resumable).
- `history.jsonl` — a flat log of every typed prompt, with the canonical `cwd` and
  first prompt per session.

`claudeo` walks the transcript files, then enriches each session with its real working
directory and first prompt from `history.jsonl` — falling back to a single bounded read
of the transcript head when history doesn't have it. The real path always comes from a
`cwd`/`project` **field**, never from reversing the (lossy) folder name.

See [`CLAUDE.md`](CLAUDE.md) for the full architecture and the directory-encoding
details.

## Development

```bash
npm run build       # tsup → dist/cli.js (ESM, shebang)
npm run dev         # tsup --watch
node dist/cli.js    # run locally without linking
```

- **TypeScript, ESM, Node ≥18**, bundled with [tsup](https://tsup.egoist.dev/).
- Picker UI built on [`@inquirer/core`](https://github.com/SBoudrias/Inquirer.js)
  (`src/prompt.ts` — a custom type-to-filter select with an Esc keybinding).
- `picocolors` for color, `commander` for arg parsing.

## License

[MIT](LICENSE) © Abdelghani Beldjouhri
