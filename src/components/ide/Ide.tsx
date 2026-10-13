import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  BookOpen,
  ChevronDown,
  Download,
  FilePlus,
  FolderOpen,
  PanelBottom,
  PanelLeft,
  Play,
  Save,
  Settings,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { JessEditor } from "./JessEditor";
import { ConsolePanel } from "./ConsolePanel";
import { SwingDialog } from "./SwingDialog";
import { Explorer, type IdeFile } from "./Explorer";
import { useJessRuntime } from "./useJessRuntime";
import { EXAMPLES } from "@/lib/jess/examples";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useIsMobile } from "@/hooks/use-mobile";
import type { EngineStatus } from "@/lib/jess/types";

const STORE = "jess-ide:v1";

interface SettingsState {
  fontSize: number;
  clearBeforeRun: boolean;
  echo: boolean;
  watchFacts: boolean;
  watchRules: boolean;
}
const DEFAULT_SETTINGS: SettingsState = { fontSize: 13.5, clearBeforeRun: true, echo: false, watchFacts: false, watchRules: false };

function seed(): { files: IdeFile[]; folders: string[] } {
  const mk = (id: string, name: string, folder: string, content: string): IdeFile => ({ id, name, folder, content, saved: content });
  return {
    folders: ["examples"],
    files: [
      mk("f-main", "main.clp", "", EXAMPLES[1]?.code ?? ""),
      mk("f-hello", "hello.clp", "examples", EXAMPLES[0]?.code ?? ""),
      mk("f-countdown", "countdown.clp", "examples", EXAMPLES[3]?.code ?? ""),
    ],
  };
}

let uid = 0;
const newId = () => `f-${Date.now().toString(36)}-${uid++}`;

const STATUS_LABEL: Record<EngineStatus, string> = {
  ready: "Ready",
  running: "Running",
  completed: "Completed",
  error: "Error",
  stopped: "Stopped",
};

type BottomTab = "console" | "problems" | "facts" | "agenda" | "rules";

export function Ide() {
  const isMobile = useIsMobile();
  const [{ files, folders }, setProject] = useState(seed);
  const [activeId, setActiveId] = useState("f-main");
  const [openIds, setOpenIds] = useState<string[]>(["f-main"]);
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [consoleH, setConsoleH] = useState(260);
  const [sidebarW, setSidebarW] = useState(232);
  const [tab, setTab] = useState<BottomTab>("console");
  const [cursor, setCursor] = useState({ line: 1, col: 1, sel: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [jump, setJump] = useState<{ line: number; col: number; n: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const rt = useJessRuntime();

  // ---- persistence ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const d = JSON.parse(raw);
        if (Array.isArray(d.files) && d.files.length) {
          setProject({ files: d.files, folders: d.folders ?? [] });
          const ids = (d.openIds as string[] | undefined)?.filter((id) => d.files.some((f: IdeFile) => f.id === id)) ?? [];
          const act = d.files.some((f: IdeFile) => f.id === d.activeId) ? d.activeId : d.files[0].id;
          setOpenIds(ids.length ? ids : [act]);
          setActiveId(act);
        }
        if (d.settings) setSettings({ ...DEFAULT_SETTINGS, ...d.settings });
      }
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(STORE, JSON.stringify({ files, folders, activeId, openIds, settings }));
  }, [loaded, files, folders, activeId, openIds, settings]);

  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
      setConsoleH(200);
    }
  }, [isMobile]);

  const active = files.find((f) => f.id === activeId) ?? files[0];

  // ---- file ops ----
  const updateFile = (id: string, patch: Partial<IdeFile>) =>
    setProject((p) => ({ ...p, files: p.files.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));

  const openFile = useCallback((id: string) => {
    setActiveId(id);
    setOpenIds((o) => (o.includes(id) ? o : [...o, id]));
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const uniqueName = (base: string, folder: string, list = files) => {
    const [stem, ext] = base.includes(".") ? [base.slice(0, base.lastIndexOf(".")), base.slice(base.lastIndexOf("."))] : [base, ".clp"];
    let name = stem + ext;
    let i = 1;
    while (list.some((f) => f.folder === folder && f.name === name)) name = `${stem}-${i++}${ext}`;
    return name;
  };

  const addFile = (name: string, content: string, folder = "") => {
    const f: IdeFile = { id: newId(), name: uniqueName(name, folder), folder, content, saved: "" };
    setProject((p) => ({ ...p, files: [...p.files, f] }));
    setActiveId(f.id);
    setOpenIds((o) => [...o, f.id]);
    return f;
  };

  const newFile = (folder = "") => addFile("untitled.clp", ";; New Jess program\n\n(reset)\n(run)\n", folder);

  const newFolder = () => {
    const name = window.prompt("Folder name", "rules");
    if (!name?.trim()) return;
    setProject((p) => ({ ...p, folders: p.folders.includes(name.trim()) ? p.folders : [...p.folders, name.trim()] }));
  };

  const deleteFile = (id: string) => {
    const f = files.find((x) => x.id === id);
    if (!f || !window.confirm(`Delete ${f.name}? This cannot be undone.`)) return;
    const remaining = files.filter((x) => x.id !== id);
    const list = remaining.length ? remaining : [{ id: newId(), name: "main.clp", folder: "", content: "", saved: "" }];
    setProject((p) => ({ ...p, files: list }));
    setOpenIds((o) => {
      const n = o.filter((x) => x !== id);
      return n.length ? n : [list[0]!.id];
    });
    if (activeId === id) setActiveId(openIds.find((x) => x !== id && list.some((l) => l.id === x)) ?? list[0]!.id);
  };

  const closeTab = (id: string) => {
    const n = openIds.filter((x) => x !== id);
    if (!n.length) return;
    setOpenIds(n);
    if (activeId === id) {
      const nextId = n[Math.max(0, openIds.indexOf(id) - 1)];
      if (nextId) setActiveId(nextId);
    }
  };

  const save = useCallback(() => {
    setProject((p) => ({ ...p, files: p.files.map((f) => (f.id === activeId ? { ...f, saved: f.content } : f)) }));
    toast(`Saved ${active?.name}`);
  }, [activeId, active?.name]);

  const download = () => {
    if (!active) return;
    const url = URL.createObjectURL(new Blob([active.content], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = active.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onOpenFiles = async (list: FileList | null) => {
    if (!list) return;
    for (const file of Array.from(list)) {
      const text = await file.text();
      const f = addFile(file.name, text);
      updateFile(f.id, { saved: text });
    }
  };

  // ---- run ----
  const runActive = useCallback(() => {
    if (!active || rt.status === "running") return;
    setTab("console");
    setConsoleOpen(true);
    rt.run(active.content, active.name, {
      clear: settings.clearBeforeRun,
      echo: settings.echo,
      watch: { facts: settings.watchFacts, rules: settings.watchRules },
    });
  }, [active, rt, settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "F5") {
        e.preventDefault();
        runActive();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        rt.stop();
      } else if (mod && e.key === "`") {
        e.preventDefault();
        setConsoleOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runActive, rt]);

  const editorError = useMemo(
    () => (rt.error && active && rt.error.file === active.name ? { line: rt.error.line, msg: rt.error.msg } : null),
    [rt.error, active],
  );

  const locate = (file: string, line: number, col: number) => {
    const f = files.find((x) => x.name === file);
    if (f) openFile(f.id);
    setJump({ line, col, n: Date.now() });
  };

  // ---- resizing ----
  const dragY = (e: RPointerEvent) => {
    const startY = e.clientY;
    const startH = consoleH;
    const move = (ev: PointerEvent) => setConsoleH(Math.max(90, Math.min(window.innerHeight - 180, startH - (ev.clientY - startY))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const dragX = (e: RPointerEvent) => {
    const startX = e.clientX;
    const startW = sidebarW;
    const move = (ev: PointerEvent) => setSidebarW(Math.max(170, Math.min(420, startW + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const running = rt.status === "running";
  const problems = rt.entries.filter((e) => e.kind === "error");
  const fileType = active?.name.endsWith(".clp") || active?.name.endsWith(".jess") ? "Jess" : "Plain Text";

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* ---------- Header ---------- */}
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-chrome px-2">
        <button className="tool-btn px-1.5" onClick={() => setSidebarOpen((v) => !v)} aria-label="Toggle explorer" title="Toggle explorer (Ctrl+B)">
          <PanelLeft className="h-4 w-4" />
        </button>
        <div className="mr-2 flex items-center gap-2 pl-1">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-foreground font-mono text-[11px] font-extrabold text-background">J</div>
          <span className="hidden text-[13px] font-semibold tracking-tight sm:inline">
            Jess <span className="font-normal text-muted-foreground">IDE</span>
          </span>
        </div>
        <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <button className="tool-btn" onClick={() => newFile()} title="New file">
          <FilePlus className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">New</span>
        </button>
        <button className="tool-btn" onClick={() => fileInput.current?.click()} title="Open .clp file">
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Open</span>
        </button>
        <button className="tool-btn" onClick={save} title="Save (Ctrl+S)">
          <Save className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Save</span>
        </button>
        <button className="tool-btn hidden md:inline-flex" onClick={download} title="Download file">
          <Download className="h-3.5 w-3.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="tool-btn" title="Examples">
              <BookOpen className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Examples</span>
              <ChevronDown className="hidden h-3 w-3 lg:inline" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="panel-label">Starter templates</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {EXAMPLES.map((ex) => (
              <DropdownMenuItem key={ex.file} className="flex flex-col items-start gap-0" onClick={() => {
                const f = addFile(ex.file, ex.code, "examples");
                if (!folders.includes("examples")) setProject((p) => ({ ...p, folders: [...p.folders, "examples"] }));
                updateFile(f.id, { saved: ex.code });
              }}>
                <span className="text-[13px] font-medium">{ex.name}</span>
                <span className="text-[11px] text-muted-foreground">{ex.description}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <input ref={fileInput} type="file" accept=".clp,.jess,.txt" multiple hidden onChange={(e) => { onOpenFiles(e.target.files); e.target.value = ""; }} />

        <div className="flex-1" />

        <div className="flex items-center gap-1 rounded-[5px] border border-border bg-panel p-0.5">
          <button
            onClick={runActive}
            disabled={running}
            title="Run current file (F5 / Ctrl+Enter)"
            className="inline-flex h-7 items-center gap-1.5 rounded-[3px] bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Run
          </button>
          <button
            onClick={rt.stop}
            disabled={!running}
            title="Stop execution (Ctrl+Shift+X)"
            className="inline-flex h-7 items-center gap-1.5 rounded-[3px] border border-border-strong px-2.5 text-[12px] font-semibold text-foreground transition-colors hover:bg-accent disabled:border-border disabled:text-subtle-foreground"
          >
            <Square className="h-3 w-3 fill-current" />
            <span className="hidden sm:inline">Stop</span>
          </button>
        </div>
        <button className="tool-btn ml-1 px-1.5" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
          <Settings className="h-4 w-4" />
        </button>
      </header>

      {/* ---------- Body ---------- */}
      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <>
            {isMobile && <div className="absolute inset-0 z-20 bg-background/70" onClick={() => setSidebarOpen(false)} />}
            <aside
              style={{ width: isMobile ? 260 : sidebarW }}
              className={`shrink-0 border-r border-border ${isMobile ? "absolute inset-y-0 left-0 z-30" : "relative"}`}
            >
              <Explorer
                files={files}
                folders={folders}
                activeId={activeId}
                onOpen={openFile}
                onNewFile={newFile}
                onNewFolder={newFolder}
                onRename={(id, name) => updateFile(id, { name })}
                onDelete={deleteFile}
                onMove={(id, folder) => updateFile(id, { folder })}
                onDeleteFolder={(fo) => setProject((p) => ({ folders: p.folders.filter((x) => x !== fo), files: p.files.map((f) => (f.folder === fo ? { ...f, folder: "" } : f)) }))}
              />
              {!isMobile && <div onPointerDown={dragX} className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-border-strong/40" />}
            </aside>
          </>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          {/* tabs */}
          <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-panel">
            {openIds.map((id) => {
              const f = files.find((x) => x.id === id);
              if (!f) return null;
              const on = id === activeId;
              return (
                <div
                  key={id}
                  onClick={() => setActiveId(id)}
                  className={`group flex shrink-0 cursor-pointer items-center gap-2 border-r border-border pl-3 pr-1.5 text-[12.5px] ${
                    on ? "bg-editor text-foreground shadow-[inset_0_1px_0_var(--foreground)]" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="font-mono text-[10px] text-subtle-foreground">{f.folder ? f.folder + "/" : ""}</span>
                  <span className={on ? "font-medium" : ""}>{f.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(id);
                    }}
                    className="flex h-4 w-4 items-center justify-center rounded-sm hover:bg-secondary"
                    aria-label={`Close ${f.name}`}
                  >
                    {f.content !== f.saved ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-foreground group-hover:hidden" />
                    ) : null}
                    <X className={`h-3 w-3 ${f.content !== f.saved ? "hidden group-hover:block" : on ? "" : "opacity-0 group-hover:opacity-100"}`} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* editor */}
          <div className="min-h-0 flex-1 bg-editor">
            {active && (
              <JessEditor
                fileId={active.id}
                value={active.content}
                fontSize={settings.fontSize}
                error={editorError}
                jump={jump}
                onChange={(v) => updateFile(active.id, { content: v })}
                onCursor={(line, col, sel) => setCursor({ line, col, sel })}
                onRun={runActive}
                onSave={save}
              />
            )}
          </div>

          {/* bottom panel */}
          <section style={{ height: consoleOpen ? consoleH : 36 }} className="relative flex shrink-0 flex-col border-t border-border bg-panel">
            {consoleOpen && <div onPointerDown={dragY} className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize hover:bg-border-strong/40" />}
            <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2">
              {(
                [
                  ["console", "Console", null],
                  ["problems", "Problems", problems.length],
                  ["facts", "Facts", rt.snapshot.facts.length],
                  ["agenda", "Agenda", rt.snapshot.agenda.length],
                  ["rules", "Rules", rt.snapshot.rules.length],
                ] as [BottomTab, string, number | null][]
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  onClick={() => {
                    setTab(k);
                    setConsoleOpen(true);
                  }}
                  className={`flex h-7 shrink-0 items-center gap-1.5 rounded-[3px] px-2.5 text-[11.5px] font-medium uppercase tracking-wider ${
                    tab === k && consoleOpen ? "bg-accent text-foreground" : "text-subtle-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                  {n !== null && n > 0 && <span className="rounded-sm bg-secondary px-1 font-mono text-[10px] text-muted-foreground">{n}</span>}
                </button>
              ))}
              <div className="flex-1" />
              {tab === "console" && consoleOpen && (
                <button className="tool-btn px-1.5" onClick={rt.clearConsole} title="Clear console" aria-label="Clear console">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button className="tool-btn px-1.5" onClick={() => setConsoleOpen((v) => !v)} title="Toggle panel (Ctrl+`)" aria-label="Toggle panel">
                <PanelBottom className="h-3.5 w-3.5" />
              </button>
            </div>
            {consoleOpen && (
              <div className="min-h-0 flex-1">
                {tab === "console" && <ConsolePanel entries={rt.entries} busy={running} onSubmit={rt.evaluate} onLocate={locate} />}
                {tab === "problems" && (
                  <ListView empty="No problems detected.">
                    {problems.map((e, i) => (
                      <button key={i} onClick={() => e.file && e.line && locate(e.file, e.line, e.col ?? 1)} className="flex w-full items-baseline gap-3 px-4 py-1 text-left hover:bg-accent/60">
                        <span className="font-semibold text-foreground">{e.errorType}</span>
                        <span className="min-w-0 flex-1 truncate text-foreground/80">{e.text.split("\n")[0]}</span>
                        <span className="shrink-0 text-subtle-foreground">{e.file}{e.line ? `:${e.line}:${e.col ?? 1}` : ""}</span>
                      </button>
                    ))}
                  </ListView>
                )}
                {tab === "facts" && (
                  <ListView empty="Working memory is empty. Run a program or type (reset).">
                    {rt.snapshot.facts.map((f) => (
                      <div key={f.id} className="flex gap-4 px-4 py-0.5">
                        <span className="w-10 shrink-0 text-subtle-foreground">f-{f.id}</span>
                        <span className="text-foreground/90">{f.text}</span>
                      </div>
                    ))}
                  </ListView>
                )}
                {tab === "agenda" && (
                  <ListView empty="Agenda is empty — no pending activations.">
                    {rt.snapshot.agenda.map((a, i) => (
                      <div key={i} className="flex gap-4 px-4 py-0.5">
                        <span className="w-14 shrink-0 text-subtle-foreground">sal {a.salience}</span>
                        <span className="font-semibold">MAIN::{a.rule}</span>
                        <span className="text-muted-foreground">{a.facts}</span>
                      </div>
                    ))}
                  </ListView>
                )}
                {tab === "rules" && (
                  <ListView empty="No rules, templates or functions defined yet.">
                    {rt.snapshot.rules.map((r) => (
                      <div key={r.name} className="flex gap-4 px-4 py-0.5">
                        <span className="w-20 shrink-0 text-subtle-foreground">defrule</span>
                        <span className="font-semibold">{r.name}</span>
                        {r.salience !== 0 && <span className="text-muted-foreground">salience {r.salience}</span>}
                        {r.doc && <span className="italic text-subtle-foreground">"{r.doc}"</span>}
                      </div>
                    ))}
                    {rt.snapshot.templates.map((t) => (
                      <div key={t.name} className="flex gap-4 px-4 py-0.5">
                        <span className="w-20 shrink-0 text-subtle-foreground">template</span>
                        <span className="font-semibold">{t.name}</span>
                        <span className="text-muted-foreground">{t.slots.join(" ")}</span>
                      </div>
                    ))}
                    {rt.snapshot.functions.map((fn) => (
                      <div key={fn} className="flex gap-4 px-4 py-0.5">
                        <span className="w-20 shrink-0 text-subtle-foreground">function</span>
                        <span className="font-semibold">{fn}</span>
                      </div>
                    ))}
                    {rt.snapshot.globals.map((g) => (
                      <div key={g.name} className="flex gap-4 px-4 py-0.5">
                        <span className="w-20 shrink-0 text-subtle-foreground">global</span>
                        <span className="font-semibold">{g.name}</span>
                        <span className="text-muted-foreground">= {g.value}</span>
                      </div>
                    ))}
                  </ListView>
                )}
              </div>
            )}
          </section>
        </main>
      </div>

      {/* ---------- Status bar ---------- */}
      <footer className="flex h-6 shrink-0 items-center gap-4 overflow-hidden border-t border-border bg-chrome px-3 font-mono text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          <span
            className={`h-2 w-2 rounded-full ${
              rt.status === "running" ? "running-dot bg-foreground" : rt.status === "error" ? "border-2 border-foreground" : rt.status === "completed" ? "bg-foreground" : "bg-subtle-foreground"
            }`}
          />
          {STATUS_LABEL[rt.status]}
          {rt.status === "completed" && rt.lastDuration !== null && <span className="font-normal text-subtle-foreground">· {rt.lastDuration} ms</span>}
        </span>
        <span className="truncate">{active?.folder ? active.folder + "/" : ""}{active?.name}</span>
        <div className="flex-1" />
        <span>Ln {cursor.line}, Col {cursor.col}{cursor.sel ? ` (${cursor.sel} sel)` : ""}</span>
        <span className="hidden sm:inline">Spaces: 3</span>
        <span className="hidden sm:inline">UTF-8</span>
        <span className="hidden md:inline">{fileType}</span>
        <span className="hidden md:inline">Facts {rt.snapshot.facts.length}</span>
      </footer>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md border-border bg-popover">
          <DialogHeader>
            <DialogTitle className="text-base">Settings</DialogTitle>
            <DialogDescription>Editor and Jess runtime preferences.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            <div className="panel-label pb-1 pt-2">Editor</div>
            <div className="flex items-center justify-between py-1.5">
              <span>Font size</span>
              <div className="flex items-center gap-1 font-mono">
                <button className="tool-btn border border-border" onClick={() => setSettings((s) => ({ ...s, fontSize: Math.max(10, s.fontSize - 1) }))}>−</button>
                <span className="w-10 text-center">{settings.fontSize}</span>
                <button className="tool-btn border border-border" onClick={() => setSettings((s) => ({ ...s, fontSize: Math.min(24, s.fontSize + 1) }))}>+</button>
              </div>
            </div>
            <div className="panel-label pb-1 pt-3">Runtime</div>
            {(
              [
                ["clearBeforeRun", "Run (clear) before each Run", "Start every run from an empty engine, like a fresh jess.bat session."],
                ["echo", "Echo commands", "Print each top-level form as Jess> (...) with its result."],
                ["watchFacts", "(watch facts)", "Trace facts entering and leaving working memory."],
                ["watchRules", "(watch rules)", "Trace every rule firing."],
              ] as [keyof SettingsState, string, string][]
            ).map(([k, label, desc]) => (
              <label key={k} className="flex cursor-pointer items-start justify-between gap-4 py-1.5">
                <span>
                  <span className="block font-mono text-[13px]">{label}</span>
                  <span className="block text-xs text-muted-foreground">{desc}</span>
                </span>
                <Switch checked={settings[k] as boolean} onCheckedChange={(v) => setSettings((s) => ({ ...s, [k]: v }))} />
              </label>
            ))}
            <div className="panel-label pb-1 pt-3">Shortcuts</div>
            <div className="grid grid-cols-2 gap-y-1 font-mono text-xs text-muted-foreground">
              <span>Run</span><span>F5 · Ctrl+Enter</span>
              <span>Stop</span><span>Ctrl+Shift+X</span>
              <span>Save</span><span>Ctrl+S</span>
              <span>Find / Replace</span><span>Ctrl+F</span>
              <span>Multi-cursor</span><span>Alt+Click · Ctrl+D</span>
              <span>Toggle comment</span><span>Ctrl+/</span>
              <span>Fold / Unfold</span><span>Ctrl+Shift+[ ]</span>
              <span>Explorer · Panel</span><span>Ctrl+B · Ctrl+`</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {rt.guiDialog && <SwingDialog dialog={rt.guiDialog} onClose={rt.closeGuiDialog} />}
    </div>
  );
}

function ListView({ children, empty }: { children: React.ReactNode; empty: string }) {
  const arr = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <div className="h-full overflow-auto py-2 font-mono text-[12.5px]">
      {arr.length ? children : <div className="px-4 py-2 italic text-subtle-foreground">{empty}</div>}
    </div>
  );
}
