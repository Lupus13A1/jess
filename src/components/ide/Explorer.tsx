import { useState } from "react";
import { ChevronDown, ChevronRight, FilePlus, FolderPlus, MoreHorizontal, Folder } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface IdeFile {
  id: string;
  name: string;
  folder: string;
  content: string;
  saved: string;
}

interface Props {
  files: IdeFile[];
  folders: string[];
  activeId: string;
  onOpen: (id: string) => void;
  onNewFile: (folder: string) => void;
  onNewFolder: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, folder: string) => void;
  onDeleteFolder: (folder: string) => void;
}

function ClpBadge({ name }: { name: string }) {
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  const jess = ext === "clp" || ext === "jess";
  return (
    <span
      className={`inline-flex h-4 w-7 shrink-0 items-center justify-center rounded-[3px] font-mono text-[8.5px] font-bold uppercase tracking-wide ${
        jess ? "bg-foreground/90 text-background" : "border border-border-strong text-muted-foreground"
      }`}
    >
      {ext || "txt"}
    </span>
  );
}

export function Explorer(p: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const commit = (id: string) => {
    if (draft.trim()) p.onRename(id, draft.trim());
    setEditing(null);
  };

  const row = (f: IdeFile, indent: boolean) => (
    <div
      key={f.id}
      className={`group flex h-7 cursor-pointer items-center gap-2 pr-1 text-[12.5px] ${indent ? "pl-7" : "pl-3"} ${
        f.id === p.activeId ? "bg-accent text-foreground shadow-[inset_2px_0_0_var(--foreground)]" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
      }`}
      onClick={() => p.onOpen(f.id)}
      onDoubleClick={() => {
        setEditing(f.id);
        setDraft(f.name);
      }}
    >
      <ClpBadge name={f.name} />
      {editing === f.id ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(f.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(f.id);
            if (e.key === "Escape") setEditing(null);
          }}
          onClick={(e) => e.stopPropagation()}
          className="h-5 min-w-0 flex-1 rounded-sm border border-border-strong bg-editor px-1 text-foreground outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{f.name}</span>
      )}
      {f.content !== f.saved && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground" title="Unsaved changes" />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <button className="rounded-sm p-0.5 opacity-0 hover:bg-secondary group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={`Actions for ${f.name}`}>
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44 text-xs">
          <DropdownMenuItem onClick={() => p.onOpen(f.id)}>Open</DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setEditing(f.id);
              setDraft(f.name);
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="text-xs">
              <DropdownMenuItem onClick={() => p.onMove(f.id, "")}>/ (project root)</DropdownMenuItem>
              {p.folders.map((fo) => (
                <DropdownMenuItem key={fo} onClick={() => p.onMove(f.id, fo)}>
                  {fo}/
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => p.onDelete(f.id)}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border pl-3 pr-1">
        <span className="panel-label">Explorer</span>
        <div className="flex">
          <button className="tool-btn px-1.5" onClick={() => p.onNewFile("")} title="New file" aria-label="New file">
            <FilePlus className="h-3.5 w-3.5" />
          </button>
          <button className="tool-btn px-1.5" onClick={p.onNewFolder} title="New folder" aria-label="New folder">
            <FolderPlus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        <div className="panel-label px-3 py-1.5">Project</div>
        {p.folders.map((fo) => {
          const open = !collapsed[fo];
          return (
            <div key={fo}>
              <div
                className="group flex h-7 cursor-pointer items-center gap-1.5 pl-2 pr-1 text-[12.5px] text-foreground/80 hover:bg-accent/50"
                onClick={() => setCollapsed((c) => ({ ...c, [fo]: open }))}
              >
                {open ? <ChevronDown className="h-3.5 w-3.5 text-subtle-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-subtle-foreground" />}
                <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 truncate font-medium">{fo}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <button className="rounded-sm p-0.5 opacity-0 hover:bg-secondary group-hover:opacity-100" aria-label={`Actions for folder ${fo}`}>
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="text-xs">
                    <DropdownMenuItem onClick={() => p.onNewFile(fo)}>New file here</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => p.onDeleteFolder(fo)}>Delete folder</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {open && p.files.filter((f) => f.folder === fo).map((f) => row(f, true))}
            </div>
          );
        })}
        {p.files.filter((f) => !f.folder || !p.folders.includes(f.folder)).map((f) => row(f, false))}
      </div>
      <div className="border-t border-border px-3 py-2 text-[11px] text-subtle-foreground">Double-click a file to rename</div>
    </div>
  );
}
