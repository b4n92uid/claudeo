/**
 * Optional shell wrappers that make the picker change the *parent* shell's
 * directory. A child process cannot cd its parent, so this is a shell function:
 *   1. set CLAUDEO_OUT to a temp file
 *   2. run the `claudeo` binary (renders the picker on the terminal)
 *   3. claudeo writes two lines on selection:  <cwd>\n<sessionId>
 *   4. the function reads them, cd's, then runs `claude --resume <id>`
 * On cancel, claudeo writes nothing, so the function is a no-op.
 *
 * The function name is the developer's choice (default `claudeo`, which simply
 * shadows the bare binary to add cd-persistence). Either way the function calls
 * the *binary* via a function-bypassing form (`command claudeo` / Get-Command
 * -CommandType Application), so naming it `claudeo` does not recurse.
 */

const POWERSHELL = String.raw`function __NAME__ {
  $exe = Get-Command claudeo -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $exe) { Write-Error 'claudeo binary not found on PATH'; return }
  $tmp = [System.IO.Path]::GetTempFileName()
  $env:CLAUDEO_OUT = $tmp
  try { & $exe.Source @args } finally { Remove-Item Env:\CLAUDEO_OUT -ErrorAction SilentlyContinue }
  if ((Test-Path $tmp) -and ((Get-Item $tmp).Length -gt 0)) {
    $lines = @(Get-Content -LiteralPath $tmp)
    Remove-Item $tmp -ErrorAction SilentlyContinue
    if ($lines[0]) { Set-Location -LiteralPath $lines[0] }
    if ($lines.Count -gt 1 -and $lines[1]) { claude --resume $lines[1] } else { claude }
  } else {
    Remove-Item $tmp -ErrorAction SilentlyContinue
  }
}`;

// `__DIRFIX__` stands in for the bash parameter-expansion below; written inline
// it would trip JS template-literal `${...}` interpolation. Filled in by shellInit.
const BASH = String.raw`__NAME__() {
  local tmp; tmp="$(mktemp)"
  CLAUDEO_OUT="$tmp" command claudeo "$@"     # 'command' runs the binary, not this function
  if [ -s "$tmp" ]; then
    local dir id
    { IFS= read -r dir; IFS= read -r id; } < "$tmp"
    __DIRFIX__                                  # backslash -> forward slash so cd works in bash
    [ -n "$dir" ] && cd "$dir"
    if [ -n "$id" ]; then claude --resume "$id"; else claude; fi
  fi
  rm -f "$tmp"
}`;

/** The placeholder's real text: dir="${dir//\\//}" — built as a plain string. */
const DIRFIX = 'dir="${dir//\\\\//}"';

export type ShellKind = "pwsh" | "bash";

/** Default wrapper function name when the developer doesn't supply one. */
const DEFAULT_NAME = "claudeo";

/** Conservative shell-identifier check so the emitted function is always valid. */
function sanitizeName(name?: string): string {
  const trimmed = name?.trim();
  if (!trimmed) return DEFAULT_NAME;
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(trimmed)) {
    throw new Error(`Invalid wrapper name "${trimmed}": use letters, digits, _ or - (must not start with a digit).`);
  }
  return trimmed;
}

export function shellInit(shell?: string, name?: string): string {
  const kind: ShellKind = shell === "bash" ? "bash" : "pwsh";
  const fnName = sanitizeName(name);
  const body = kind === "bash" ? BASH : POWERSHELL;
  // Function replacement for __DIRFIX__ so its `$` isn't read as a replacement token.
  return body.replaceAll("__NAME__", fnName).replaceAll("__DIRFIX__", () => DIRFIX) + "\n";
}
