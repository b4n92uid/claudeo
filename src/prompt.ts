import {
  createPrompt,
  useState,
  useEffect,
  useKeypress,
  usePrefix,
  usePagination,
  useMemo,
  isEnterKey,
  isUpKey,
  isDownKey,
  makeTheme,
} from "@inquirer/core";
import color from "picocolors";

/**
 * Node's readline waits `escapeCodeTimeout` ms after a lone Esc to rule out an
 * arrow-key sequence (`ESC [ A`) — the default 500 ms is felt as lag when Esc
 * is a navigation key. Local terminals deliver full sequences in one chunk, so
 * a short window stays correct while feeling instant.
 */
const ESCAPE_TIMEOUT_MS = 50;

export interface FilterChoice<V> {
  /** rendered list label (may contain ANSI) */
  name: string;
  value: V;
  /** label shown on the answered line (defaults to `name`) */
  short?: string;
  /** dim line shown beneath the active item */
  description?: string;
}

export interface FilterSelectConfig<V> {
  message: string;
  /** synchronous filter: given the typed term, return the choices to show */
  source: (term: string) => FilterChoice<V>[];
  pageSize?: number;
  /** if set, Esc resolves the prompt with this value (e.g. a back/cancel sentinel) */
  escapeValue?: V;
  /** help-line verb for the Esc key (default "back") */
  escapeLabel?: string;
  /** cursor position to start on (clamped to the list; default 0) */
  initialActive?: number;
}

/**
 * A type-to-filter select built on @inquirer/core. Like the stock `search`
 * prompt but synchronous and with an Esc keybinding — stock `search` only
 * exits on Ctrl+C, so it can't model "go back one step".
 */
const filterSelectInner = createPrompt<unknown, FilterSelectConfig<unknown>>(
  (config, done) => {
    const { pageSize = 12 } = config;
    const theme = makeTheme();
    const [status, setStatus] = useState<"idle" | "done">("idle");
    const [term, setTerm] = useState("");
    const [active, setActive] = useState(config.initialActive ?? 0);
    const prefix = usePrefix({ status, theme });

    // Shrink the lone-Esc disambiguation window so Esc-to-go-back feels instant.
    // Runs once at mount (before any keypress); the decoder reads this per key.
    useEffect((rl) => {
      (rl as { escapeCodeTimeout?: number }).escapeCodeTimeout = ESCAPE_TIMEOUT_MS;
    }, []);

    const items = useMemo(() => config.source(term), [term]);
    const bounded = items.length === 0 ? 0 : Math.min(active, items.length - 1);
    const selected = items[bounded];

    useKeypress((key, rl) => {
      if (isEnterKey(key)) {
        if (selected) {
          setStatus("done");
          done(selected.value);
        }
      } else if (isUpKey(key) || isDownKey(key)) {
        rl.clearLine(0); // arrow keys must not edit the filter text
        if (items.length > 0) {
          const offset = isUpKey(key) ? -1 : 1;
          setActive((bounded + offset + items.length) % items.length);
        }
      } else if (key.name === "escape" && config.escapeValue !== undefined) {
        setStatus("done");
        done(config.escapeValue);
      } else if (rl.line !== term) {
        // The filter text actually changed (typing / backspace) — mirror it and
        // reset to the top. Keys that don't edit the buffer (←/→/Home/End) fall
        // through untouched, so they don't jump the cursor back to row 0.
        setTerm(rl.line);
        setActive(0);
      }
    });

    const page = usePagination({
      items,
      active: bounded,
      renderItem({ item, isActive }) {
        const cursor = isActive ? color.cyan("❯") : " ";
        return `${cursor} ${item.name}`;
      },
      pageSize,
      loop: true,
    });

    const message = theme.style.message(config.message, status);

    if (status === "done") {
      const answer = selected ? selected.short ?? selected.name : "";
      return `${prefix} ${message} ${color.dim(answer)}`;
    }

    const help = (
      [
        ["↑↓", "navigate"],
        ["⏎", "select"],
        ...(config.escapeValue === undefined ? [] : [["esc", config.escapeLabel ?? "back"]]),
      ] as [string, string][]
    )
      .map(([k, a]) => `${color.bold(k)} ${color.dim(a)}`)
      .join(color.dim(" • "));

    const header = `${prefix} ${message} ${color.cyan(term)}`;
    const body = [
      items.length > 0 ? page : color.dim("  No matches"),
      selected?.description ?? "",
      help,
    ]
      .filter(Boolean)
      .join("\n");

    return [header, body];
  },
);

/** Generic wrapper around the (type-erased) inquirer prompt. */
export function filterSelect<V>(config: FilterSelectConfig<V>): Promise<V> {
  return filterSelectInner(config as FilterSelectConfig<unknown>) as Promise<V>;
}
