import { Command } from "commander";
import color from "picocolors";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { listSessions, groupByProject, type Session, type Project } from "./sessions.js";
import { filterSelect } from "./prompt.js";
import { shellInit } from "./shell.js";

const DEFAULT_LIMIT = 40;

/** Esc in the session step → go back to the project step. */
const BACK = Symbol("back");
/** Esc in the project step (top level) → quit. */
const CANCEL = Symbol("cancel");

/** Banner printed above the picker. */
function intro(text: string): void {
  console.log(`\n${color.inverse(color.cyan(" claudeo "))} ${color.dim(text)}`);
}

/** Closing line on success. */
function outro(text: string): void {
  console.log(`${text}\n`);
}

/** Aborted / nothing-to-do line. */
function cancel(text: string): void {
  console.log(`${color.red("✖")} ${color.dim(text)}\n`);
}

/** True when `term` (case-insensitive) appears in any of the haystacks. */
function matches(term: string, ...haystacks: (string | undefined)[]): boolean {
  if (!term) return true;
  const t = term.toLowerCase();
  return haystacks.some((h) => h?.toLowerCase().includes(t));
}

/** Inquirer rejects with this error name on Ctrl+C / Esc. */
function isCancelError(err: unknown): boolean {
  return err instanceof Error && err.name === "ExitPromptError";
}

function rel(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)}d`;
  const mo = d / 30;
  if (mo < 12) return `${Math.floor(mo)}mo`;
  return `${Math.floor(mo / 12)}y`;
}

function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? clean.slice(0, n - 1) + "…" : clean;
}

/** Step 1: search-pick a project. Returns null on cancel (Esc or Ctrl+C). */
async function pickProject(projects: Project[], initialActive: number): Promise<Project | null> {
  try {
    const r = await filterSelect<Project | typeof CANCEL>({
      message: "Search projects",
      escapeValue: CANCEL,
      escapeLabel: "quit",
      initialActive,
      source: (term) =>
        projects
          .filter((g) => matches(term, g.project, g.cwd))
          .map((g) => ({
            name: `${color.dim(rel(g.mtime).padStart(4))}  ${color.bold(g.project)}  ${color.dim(
              `${g.sessions.length} session${g.sessions.length === 1 ? "" : "s"}`,
            )}`,
            value: g,
            short: g.project,
            description: color.dim(g.cwd),
          })),
    });
    return r === CANCEL ? null : r;
  } catch (err) {
    if (isCancelError(err)) return null;
    throw err;
  }
}

/** Step 2: search-pick a session within a project. Esc returns BACK to go up. */
async function pickSession(g: Project): Promise<Session | typeof BACK | null> {
  try {
    return await filterSelect<Session | typeof BACK>({
      message: `Sessions in ${g.project}`,
      escapeValue: BACK,
      source: (term) =>
        g.sessions
          .filter((s) => matches(term, s.firstPrompt, s.id))
          .map((s) => ({
            name: `${color.dim(rel(s.mtime).padStart(4))}  ${
              s.firstPrompt ? truncate(s.firstPrompt, 72) : color.dim("(no prompt recorded)")
            }`,
            value: s as Session | typeof BACK,
            short: s.firstPrompt ? truncate(s.firstPrompt, 48) : s.id,
            description: color.dim(s.id),
          })),
    });
  } catch (err) {
    if (isCancelError(err)) return null;
    throw err;
  }
}

async function pick(opts: { all?: boolean; limit?: string }): Promise<void> {
  const all = listSessions();
  if (all.length === 0) {
    intro("");
    cancel("No Claude Code sessions found under ~/.claude/projects.");
    process.exit(1);
  }

  const limit = opts.all ? all.length : Number.parseInt(opts.limit ?? `${DEFAULT_LIMIT}`, 10);
  const sessions = all.slice(0, Math.max(1, limit));
  const projects = groupByProject(sessions);

  intro(`${all.length} sessions · ${projects.length} projects`);

  // Two-step picker: project, then session. Looping lets the session step
  // send the user back up to the project list; `lastIdx` restores the project
  // cursor so going back lands on the project you just left.
  let s: Session | undefined;
  let lastIdx = 0;
  while (!s) {
    const g = await pickProject(projects, lastIdx);
    if (!g) {
      cancel("Cancelled.");
      process.exit(0);
    }
    lastIdx = projects.indexOf(g);
    const chosen = await pickSession(g);
    if (chosen === null) {
      cancel("Cancelled.");
      process.exit(0);
    }
    if (chosen === BACK) continue;
    s = chosen;
  }

  const outFile = process.env.CLAUDEO_OUT;

  if (outFile) {
    // Driven by the `co` shell wrapper: hand back the target, let the shell cd + resume.
    writeFileSync(outFile, `${s.cwd}\n${s.id}\n`);
    outro(color.green(`→ ${s.cwd}`));
    return;
  }

  // Standalone (no wrapper): resume directly in the chosen dir. cwd won't persist
  // in the parent shell — install the `co` wrapper for that (see `claudeo shell-init`).
  outro(color.green(`Launching claude in ${s.cwd}`));
  const child = spawn("claude", ["--resume", s.id], {
    cwd: s.cwd,
    stdio: "inherit",
    shell: true,
  });
  child.on("exit", (code) => process.exit(code ?? 0));
}

const program = new Command();

program
  .name("claudeo")
  .description("Interactive picker to resume Claude Code sessions across directories")
  .version("0.1.0")
  .option("-a, --all", "show every session (default: newest 40)")
  .option("-n, --limit <n>", "max sessions to show", `${DEFAULT_LIMIT}`)
  .action((opts) => pick(opts));

program
  .command("shell-init [shell]")
  .description("print the `co` shell wrapper (pwsh | bash) for your profile")
  .action((shell?: string) => {
    process.stdout.write(shellInit(shell));
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
