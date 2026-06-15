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

/**
 * Render the two-step picker once and return the chosen session, or null when
 * the user backs all the way out. Re-reads the session list on every call so a
 * hub loop reflects activity from the session that just ran.
 */
async function selectSession(
  opts: { all?: boolean; limit?: string },
  showHeader: boolean,
): Promise<Session | null> {
  const all = listSessions();
  if (all.length === 0) {
    if (showHeader) intro("");
    cancel("No Claude Code sessions found under ~/.claude/projects.");
    process.exit(1);
  }

  // Fall back to the default when --limit isn't a positive number (e.g. `-n abc`).
  const parsed = Number.parseInt(opts.limit ?? `${DEFAULT_LIMIT}`, 10);
  const limit = opts.all ? all.length : Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
  const sessions = all.slice(0, limit);
  const projects = groupByProject(sessions);

  if (showHeader) intro(`${all.length} sessions · ${projects.length} projects`);

  // Two-step picker: project, then session. Looping lets the session step
  // send the user back up to the project list; `lastIdx` restores the project
  // cursor so going back lands on the project you just left.
  let lastIdx = 0;
  while (true) {
    const g = await pickProject(projects, lastIdx);
    if (!g) return null;
    lastIdx = projects.indexOf(g);
    const chosen = await pickSession(g);
    if (chosen === null) return null;
    if (chosen === BACK) continue;
    return chosen;
  }
}

/** Launch `claude --resume` as a child in the session's dir; resolve on exit. */
function runClaude(s: Session): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["--resume", s.id], {
      cwd: s.cwd,
      stdio: "inherit",
      shell: true, // resolves the `claude` shim (.cmd/.ps1) on Windows PATH
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

async function pick(opts: { all?: boolean; limit?: string; once?: boolean }): Promise<void> {
  const outFile = process.env.CLAUDEO_OUT;

  // Wrapper mode: one-shot. Hand the target back to the cd-persisting shell
  // function (from `claudeo shell-init`), which cd's the *parent* shell into it
  // and resumes — so your shell is left in the project. A child process can't
  // move the parent's cwd; the shell can.
  if (outFile) {
    const s = await selectSession(opts, true);
    if (!s) {
      cancel("Cancelled.");
      process.exit(0);
    }
    writeFileSync(outFile, `${s.cwd}\n${s.id}\n`);
    outro(color.green(`→ ${s.cwd}`));
    return;
  }

  // Hub mode (default, zero-install): launch claude as a child in the chosen
  // dir and, when it exits, return to the picker. Loop until the user backs out.
  // `--once` resumes a single session and exits (handy for scripting).
  // `fastFails` guards against a tight spin when `claude` can't launch: with
  // shell:true a missing binary surfaces as an instant nonzero exit, not an
  // `error` event, so we bail after two back-to-back immediate failures.
  let first = true;
  let fastFails = 0;
  for (;;) {
    const s = await selectSession(opts, first);
    first = false;
    if (!s) {
      outro(color.dim("Bye."));
      process.exit(0);
    }
    outro(color.green(`Launching claude in ${s.cwd}`));
    let code: number;
    const startedAt = Date.now();
    try {
      code = await runClaude(s);
    } catch (err) {
      cancel(`Could not launch claude: ${(err as Error).message}`);
      process.exit(1);
    }
    if (opts.once) process.exit(code);
    if (code !== 0 && Date.now() - startedAt < 1500) {
      if (++fastFails >= 2) {
        cancel("`claude` keeps exiting immediately — is it installed and on your PATH?");
        process.exit(1);
      }
    } else {
      fastFails = 0;
    }
  }
}

const program = new Command();

program
  .name("claudeo")
  .description("Interactive hub to resume Claude Code sessions across directories")
  .version("0.1.0")
  .option("-a, --all", "show every session (default: newest 40)")
  .option("-n, --limit <n>", "max sessions to show", `${DEFAULT_LIMIT}`)
  .option("-1, --once", "resume one session and exit (don't return to the picker)")
  .action((opts) => pick(opts));

program
  .command("shell-init [shell] [name]")
  .description("print the cd-persisting shell wrapper (pwsh | bash); name defaults to `claudeo`")
  .action((shell?: string, name?: string) => {
    process.stdout.write(shellInit(shell, name));
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
