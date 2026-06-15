/**
 * Shell wrappers that make `co` change the parent shell's directory.
 *
 * A child process cannot cd its parent, so `co` is a shell function:
 *   1. set CLAUDEO_OUT to a temp file
 *   2. run `claudeo` (renders the picker on the terminal)
 *   3. claudeo writes two lines on selection:  <cwd>\n<sessionId>
 *   4. the function reads them, cd's, then runs `claude --resume <id>`
 * On cancel, claudeo writes nothing, so the function is a no-op.
 */

const POWERSHELL = String.raw`function co {
  $tmp = [System.IO.Path]::GetTempFileName()
  $env:CLAUDEO_OUT = $tmp
  try { claudeo @args } finally { Remove-Item Env:\CLAUDEO_OUT -ErrorAction SilentlyContinue }
  if ((Test-Path $tmp) -and ((Get-Item $tmp).Length -gt 0)) {
    $lines = @(Get-Content -LiteralPath $tmp)
    Remove-Item $tmp -ErrorAction SilentlyContinue
    if ($lines[0]) { Set-Location -LiteralPath $lines[0] }
    if ($lines.Count -gt 1 -and $lines[1]) { claude --resume $lines[1] } else { claude }
  } else {
    Remove-Item $tmp -ErrorAction SilentlyContinue
  }
}`;

const BASH = String.raw`co() {
  local tmp; tmp="$(mktemp)"
  CLAUDEO_OUT="$tmp" claudeo "$@"
  if [ -s "$tmp" ]; then
    local dir id
    { IFS= read -r dir; IFS= read -r id; } < "$tmp"
    dir="$` + String.raw`{dir//\\//}"           # backslash -> forward slash so cd works in bash
    [ -n "$dir" ] && cd "$dir"
    if [ -n "$id" ]; then claude --resume "$id"; else claude; fi
  fi
  rm -f "$tmp"
}`;

export type ShellKind = "pwsh" | "bash";

export function shellInit(shell?: string): string {
  const kind: ShellKind = shell === "bash" ? "bash" : "pwsh";
  const body = kind === "bash" ? BASH : POWERSHELL;
  return body + "\n";
}
