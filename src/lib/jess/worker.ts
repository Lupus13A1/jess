/// <reference lib="webworker" />
import { Engine, fmt, type JavaGuiEvent } from "./engine";
import { NIL, type ConsoleEntry, type Snapshot } from "./types";

export type WorkerIn =
  | { type: "run"; code: string; file: string; clear: boolean; echo: boolean; watch: { facts: boolean; rules: boolean } }
  | { type: "eval"; code: string }
  | { type: "gui-response"; value: string | null };

export type WorkerOut =
  | { type: "out"; entries: ConsoleEntry[] }
  | { type: "gui"; event: JavaGuiEvent }
  | { type: "done"; ok: boolean; snapshot: Snapshot; errorLine?: number; errorCol?: number; errorMsg?: string };

let buffer: ConsoleEntry[] = [];
let lastFlush = Date.now();
let lastError: ConsoleEntry | undefined;
const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);
const errorDetails = (entry: ConsoleEntry | undefined) => ({
  errorLine: entry?.line,
  errorCol: entry?.col,
  errorMsg: entry?.text,
});

const flush = () => {
  if (buffer.length) post({ type: "out", entries: buffer });
  buffer = [];
  lastFlush = Date.now();
};

const engine = new Engine({
  out: (e) => {
    if (e.kind === "error") lastError = e;
    buffer.push(e);
    if (buffer.length > 200 || Date.now() - lastFlush > 80) flush();
  },
  gui: (event) => post({ type: "gui", event }),
});

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (msg.type === "gui-response") return;
  lastError = undefined;
  let ok: boolean;
  if (msg.type === "run") {
    if (msg.clear) engine.clear();
    engine.watch.facts = msg.watch.facts;
    engine.watch.rules = msg.watch.rules;
    ok = engine.execute(msg.code, { echo: msg.echo, file: msg.file }).ok;
  } else {
    const r = engine.execute(msg.code, { echo: false, file: "<console>" });
    ok = r.ok;
    if (ok && r.last !== NIL) engine.emit({ kind: "result", text: fmt(r.last) });
  }
  flush();
  const details = msg.type === "run" ? errorDetails(lastError) : {};
  post({
    type: "done",
    ok,
    snapshot: engine.snapshot(),
    ...details,
  });
};
