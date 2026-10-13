import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ConsoleEntry } from "@/lib/jess/types";

function balanced(s: string) {
  let d = 0;
  let str = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (str) {
      if (c === "\\") i++;
      else if (c === '"') str = false;
    } else if (c === '"') str = true;
    else if (c === ";") while (i < s.length && s[i] !== "\n") i++;
    else if (c === "(") d++;
    else if (c === ")") d--;
  }
  return d <= 0 && !str;
}

export function ConsolePanel({
  entries,
  busy,
  onSubmit,
  onLocate,
}: {
  entries: ConsoleEntry[];
  busy: boolean;
  onSubmit: (code: string) => void;
  onLocate: (file: string, line: number, col: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const history = useRef<string[]>([]);
  const hIdx = useRef(-1);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (!value.trim()) {
        e.preventDefault();
        return;
      }
      if (balanced(value)) {
        e.preventDefault();
        history.current.unshift(value);
        hIdx.current = -1;
        onSubmit(value);
        setValue("");
      }
    } else if (e.key === "ArrowUp" && !value.includes("\n")) {
      e.preventDefault();
      if (hIdx.current < history.current.length - 1) {
        const nextIndex = ++hIdx.current;
        setValue(history.current[nextIndex] ?? "");
      }
    } else if (e.key === "ArrowDown" && !value.includes("\n")) {
      e.preventDefault();
      if (hIdx.current > 0) {
        const nextIndex = --hIdx.current;
        setValue(history.current[nextIndex] ?? "");
      }
      else {
        hIdx.current = -1;
        setValue("");
      }
    }
  };

  return (
    <div className="flex h-full flex-col font-mono text-[12.5px] leading-[1.55]" onClick={() => window.getSelection()?.isCollapsed && input.current?.focus()}>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-4 py-2">
        {entries.map((e, i) => (
          <Entry key={i} e={e} onLocate={onLocate} />
        ))}
        <div className="flex items-start gap-2">
          <span className="select-none pt-px font-semibold text-muted-foreground">Jess&gt;</span>
          <textarea
            ref={input}
            value={value}
            rows={Math.min(8, value.split("\n").length)}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
            placeholder={busy ? "running…" : "(facts)"}
            aria-label="Jess console input"
            className="flex-1 resize-none bg-transparent text-foreground outline-none placeholder:text-subtle-foreground"
          />
        </div>
      </div>
    </div>
  );
}

function Entry({ e, onLocate }: { e: ConsoleEntry; onLocate: (f: string, l: number, c: number) => void }) {
  switch (e.kind) {
    case "prompt":
      return (
        <div className="whitespace-pre-wrap">
          <span className="font-semibold text-muted-foreground">Jess&gt; </span>
          <span className="text-foreground">{e.text}</span>
        </div>
      );
    case "result":
      return <div className="whitespace-pre-wrap font-semibold text-foreground">{e.text}</div>;
    case "stdout":
      return <div className="whitespace-pre-wrap text-foreground/90">{e.text.replace(/\n$/, "")}</div>;
    case "info":
      return <div className="whitespace-pre-wrap italic text-subtle-foreground">{e.text}</div>;
    case "watch":
      return <div className="whitespace-pre-wrap text-muted-foreground">{e.text}</div>;
    case "warn":
      return (
        <div className="my-1 flex gap-2 whitespace-pre-wrap">
          <span className="shrink-0 rounded-sm border border-border-strong px-1 text-[10px] font-bold leading-4.5 tracking-wider text-muted-foreground">WARN</span>
          <span className="text-foreground/90">{e.text}</span>
        </div>
      );
    case "error": {
      const loc = e.line ? `${e.file || "input"}:${e.line}${e.col ? ":" + e.col : ""}` : null;
      const canJump = loc && e.file && e.file !== "<console>";
      return (
        <div className="my-1.5 border-l-2 border-foreground bg-muted/60 py-1.5 pl-3 pr-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm bg-foreground px-1 text-[10px] font-bold leading-4.5 tracking-wider text-background">ERROR</span>
            <span className="font-semibold text-foreground">{e.errorType}</span>
            {loc &&
              (canJump ? (
                <button
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onLocate(e.file!, e.line!, e.col ?? 1);
                  }}
                  className="text-muted-foreground underline decoration-border-strong underline-offset-2 hover:text-foreground"
                >
                  at {loc}
                </button>
              ) : (
                <span className="text-muted-foreground">at {loc}</span>
              ))}
          </div>
          <div className="mt-0.5 whitespace-pre-wrap text-foreground/90">{e.text}</div>
          {e.context !== undefined && e.line && (
            <pre className="mt-1 overflow-x-auto text-muted-foreground">
              <span className="text-subtle-foreground">{String(e.line).padStart(4)} │ </span>
              {e.context}
              {"\n"}
              <span className="text-foreground">{" ".repeat(7 + Math.max(0, (e.col ?? 1) - 1))}^</span>
            </pre>
          )}
        </div>
      );
    }
  }
}
