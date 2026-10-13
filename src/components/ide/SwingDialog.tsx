import { useEffect, useRef, useState } from "react";
import { AlertCircle, HelpCircle, Info, X } from "lucide-react";
import type { GuiDialog } from "./useJessRuntime";

interface SwingDialogProps {
  dialog: GuiDialog;
  onClose: (value: string | null) => void;
}

export function SwingDialog({ dialog, onClose }: SwingDialogProps) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const isInput = dialog.type === "input";
  const Icon = dialog.messageType === 0 ? AlertCircle : dialog.messageType === 3 ? HelpCircle : Info;
  const iconClass = dialog.messageType === 0 ? "text-red-500" : dialog.messageType === 3 ? "text-sky-500" : "text-blue-500";
  const title = dialog.title ?? (isInput ? "Input" : "Message");

  useEffect(() => {
    if (isInput) input.current?.focus();
  }, [isInput]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" role="presentation">
      <div
        className="w-full max-w-[430px] overflow-hidden rounded-md border border-border-strong bg-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="swing-dialog-title"
      >
        <div className="flex h-9 items-center justify-between border-b border-border bg-secondary px-3">
          <h2 id="swing-dialog-title" className="text-[12px] font-medium text-foreground">
            {title}
          </h2>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => onClose(null)} aria-label="Close dialog">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex gap-4 px-5 py-5">
          <Icon className={`mt-0.5 h-7 w-7 shrink-0 ${iconClass}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap text-[12px] leading-5 text-foreground">{dialog.message}</p>
            {isInput && (
              <input
                ref={input}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onClose(value);
                  if (event.key === "Escape") onClose(null);
                }}
                className="mt-3 h-7 w-full rounded border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
                aria-label="Input value"
              />
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-secondary/40 px-4 py-2.5">
          {isInput && (
            <button className="h-7 rounded border border-border px-4 text-[11px] text-muted-foreground hover:bg-accent" onClick={() => onClose(null)}>
              Cancel
            </button>
          )}
          <button
            className="h-7 min-w-[48px] rounded border border-primary/40 bg-primary/80 px-4 text-[11px] font-medium text-primary-foreground hover:bg-primary"
            onClick={() => onClose(isInput ? value : null)}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
