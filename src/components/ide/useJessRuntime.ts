import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsoleEntry, EngineStatus, Snapshot } from "@/lib/jess/types";
import type { WorkerIn, WorkerOut } from "@/lib/jess/worker";
import type { JavaGuiEvent } from "@/lib/jess/engine";

const BANNER: ConsoleEntry[] = [
  { kind: "info", text: "Jess, the Rule Engine for the Java Platform" },
  { kind: "info", text: "Browser runtime · Jess 7 compatible subset · type (help) ideas: (facts) (rules) (agenda) (reset) (run)" },
];
const MAX = 4000;
const EMPTY: Snapshot = { facts: [], rules: [], agenda: [], templates: [], globals: [], functions: [] };

export interface GuiDialog extends JavaGuiEvent {
  id: number;
}

export interface RunOptions {
  clear: boolean;
  echo: boolean;
  watch: { facts: boolean; rules: boolean };
}

export function useJessRuntime() {
  const worker = useRef<Worker | null>(null);
  const started = useRef(0);
  const [status, setStatus] = useState<EngineStatus>("ready");
  const [entries, setEntries] = useState<ConsoleEntry[]>(BANNER);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [error, setError] = useState<{ line: number; col: number; msg: string; file: string } | null>(null);
  const [lastDuration, setLastDuration] = useState<number | null>(null);
  const [guiDialog, setGuiDialog] = useState<GuiDialog | null>(null);
  const guiQueue = useRef<GuiDialog[]>([]);
  const nextGuiId = useRef(0);
  const runFile = useRef("");
  const busy = useRef(false);

  const append = useCallback((es: ConsoleEntry[]) => {
    setEntries((prev) => {
      const next = prev.concat(es);
      return next.length > MAX ? next.slice(next.length - MAX) : next;
    });
  }, []);

  const spawn = useCallback(() => {
    const w = new Worker(new URL("../../lib/jess/worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      if (m.type === "out") append(m.entries);
      else if (m.type === "gui") {
        const dialog = { ...m.event, id: nextGuiId.current++ };
        setGuiDialog((current) => {
          if (current) {
            guiQueue.current.push(dialog);
            return current;
          }
          return dialog;
        });
      }
      else {
        busy.current = false;
        const ms = Math.round(performance.now() - started.current);
        setLastDuration(ms);
        setSnapshot(m.snapshot);
        setStatus(m.ok ? "completed" : "error");
        if (m.errorLine) setError({ line: m.errorLine, col: m.errorCol ?? 1, msg: m.errorMsg ?? "Error", file: runFile.current });
      }
    };
    w.onerror = (e) => {
      busy.current = false;
      append([{ kind: "error", errorType: "EngineCrash", text: e.message || "The Jess engine crashed" }]);
      setStatus("error");
    };
    worker.current = w;
  }, [append]);

  useEffect(() => {
    spawn();
    return () => worker.current?.terminate();
  }, [spawn]);

  const post = (m: WorkerIn) => {
    if (!worker.current || busy.current) return false;
    busy.current = true;
    started.current = performance.now();
    setStatus("running");
    worker.current.postMessage(m);
    return true;
  };

  const run = useCallback(
    (code: string, file: string, opts: RunOptions) => {
      setError(null);
      runFile.current = file;
      if (post({ type: "run", code, file, ...opts }))
        append([{ kind: "info", text: `── batch "${file}" ${opts.clear ? "(clear → load)" : ""}` }]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [append],
  );

  const evaluate = useCallback(
    (code: string) => {
      if (busy.current) {
        append([{ kind: "warn", text: "Engine is busy. Press Stop to interrupt the running program." }]);
        return;
      }
      append([{ kind: "prompt", text: code }]);
      post({ type: "eval", code });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [append],
  );

  const stop = useCallback(() => {
    if (!busy.current) return;
    worker.current?.terminate();
    busy.current = false;
    spawn();
    setSnapshot(EMPTY);
    setStatus("stopped");
    append([
      { kind: "warn", text: `Execution stopped by user after ${Math.round(performance.now() - started.current)} ms.` },
      { kind: "info", text: "Engine restarted — working memory and definitions were cleared." },
    ]);
  }, [append, spawn]);

  const clearConsole = useCallback(() => setEntries([]), []);
  const closeGuiDialog = useCallback(
    (value: string | null) => {
      worker.current?.postMessage({ type: "gui-response", value } satisfies WorkerIn);
      setGuiDialog(guiQueue.current.shift() ?? null);
    },
    [],
  );

  return { status, entries, snapshot, error, setError, lastDuration, run, evaluate, stop, clearConsole, guiDialog, closeGuiDialog };
}
