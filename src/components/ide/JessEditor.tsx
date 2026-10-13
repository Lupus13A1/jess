import { useEffect, useRef } from "react";
import { EditorState, StateEffect, StateField, Compartment, type Extension } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
  gutter,
  GutterMarker,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language";
import { jessCompletions, jessFold, jessHighlight, jessLanguage } from "./jess-language";

export const setErrorLine = StateEffect.define<{ line: number; msg: string } | null>();

class ErrorMarker extends GutterMarker {
  constructor(private msg: string) {
    super();
  }
  override toDOM() {
    const el = document.createElement("span");
    el.className = "cm-error-marker";
    el.textContent = "●";
    el.title = this.msg;
    return el;
  }
}

const errorField = StateField.define<{ line: number; msg: string } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setErrorLine)) return e.value;
    if (tr.docChanged && v) return null;
    return v;
  },
});

const errorDecorations = EditorView.decorations.compute([errorField], (state) => {
  const v = state.field(errorField);
  if (!v || v.line < 1 || v.line > state.doc.lines) return Decoration.none;
  return Decoration.set([Decoration.line({ class: "cm-error-line" }).range(state.doc.line(v.line).from)]);
});

const errorGutter = gutter({
  class: "cm-error-gutter",
  lineMarker(view, line) {
    const v = view.state.field(errorField);
    if (!v || v.line > view.state.doc.lines) return null;
    return view.state.doc.lineAt(line.from).number === v.line ? new ErrorMarker(v.msg) : null;
  },
  lineMarkerChange: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(setErrorLine)) || tr.docChanged),
});

const theme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "var(--editor)", color: "var(--foreground)" },
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
    ".cm-content": { caretColor: "var(--foreground)", padding: "8px 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)", borderLeftWidth: "2px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--selection) !important",
    },
    ".cm-gutters": { backgroundColor: "var(--editor)", color: "var(--syn-faint)", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 16px", minWidth: "44px" },
    ".cm-activeLine": { backgroundColor: "var(--active-line)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--active-line)", color: "var(--foreground)" },
    ".cm-matchingBracket": { backgroundColor: "var(--bracket-match)", outline: "1px solid var(--muted-foreground)", color: "var(--foreground) !important" },
    ".cm-nonmatchingBracket": { outline: "1px dashed var(--foreground)" },
    ".cm-foldGutter .cm-gutterElement": { padding: "0 4px", cursor: "pointer", color: "var(--syn-faint)" },
    ".cm-foldPlaceholder": { backgroundColor: "var(--muted)", border: "1px solid var(--border)", color: "var(--muted-foreground)", padding: "0 6px" },
    ".cm-selectionMatch": { backgroundColor: "var(--bracket-match)" },
    ".cm-searchMatch": { backgroundColor: "var(--bracket-match)", outline: "1px solid var(--muted-foreground)" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--selection)" },
    ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--foreground)", borderTop: "1px solid var(--border)" },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
    ".cm-panel.cm-search": { padding: "6px 10px", fontFamily: "var(--font-sans)", fontSize: "12px" },
    ".cm-panel.cm-search input, .cm-panel.cm-search button": {
      fontFamily: "var(--font-sans)", fontSize: "12px", borderRadius: "3px",
    },
    ".cm-textfield": { backgroundColor: "var(--editor)", border: "1px solid var(--border)", color: "var(--foreground)", padding: "2px 6px" },
    ".cm-button": { backgroundImage: "none", backgroundColor: "var(--muted)", border: "1px solid var(--border)", color: "var(--foreground)" },
    ".cm-tooltip": { backgroundColor: "var(--panel)", border: "1px solid var(--border)", color: "var(--foreground)" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--selection)", color: "var(--foreground)" },
    ".cm-error-line": { backgroundColor: "var(--error-line)", boxShadow: "inset 2px 0 0 var(--foreground)" },
    ".cm-error-gutter .cm-gutterElement": { width: "12px", textAlign: "center" },
    ".cm-error-marker": { color: "var(--foreground)", fontSize: "10px" },
  },
  { dark: true },
);

interface Props {
  fileId: string;
  value: string;
  fontSize: number;
  error: { line: number; msg: string } | null;
  onChange: (v: string) => void;
  onCursor: (line: number, col: number, sel: number) => void;
  onRun: () => void;
  onSave: () => void;
  jump: { line: number; col: number; n: number } | null;
}

export function JessEditor({ fileId, value, fontSize, error, onChange, onCursor, onRun, onSave, jump }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const currentId = useRef(fileId);
  const cb = useRef({ onChange, onCursor, onRun, onSave });
  cb.current = { onChange, onCursor, onRun, onSave };
  const fontComp = useRef(new Compartment());

  const extensions = (): Extension[] => [
    lineNumbers(),
    errorGutter,
    foldGutter({ openText: "▾", closedText: "▸" }),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion({ override: [jessCompletions] }),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    jessLanguage,
    jessFold,
    jessHighlight,
    theme,
    errorField,
    errorDecorations,
    fontComp.current.of(EditorView.theme({ "&": { fontSize: fontSize + "px" } })),
    keymap.of([
      { key: "Mod-Enter", run: () => (cb.current.onRun(), true), preventDefault: true },
      { key: "Mod-s", run: () => (cb.current.onSave(), true), preventDefault: true },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) cb.current.onChange(u.state.doc.toString());
      if (u.selectionSet || u.docChanged) {
        const sel = u.state.selection.main;
        const ln = u.state.doc.lineAt(sel.head);
        cb.current.onCursor(ln.number, sel.head - ln.from + 1, Math.abs(sel.to - sel.from));
      }
    }),
  ];

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({ state: EditorState.create({ doc: value, extensions: extensions() }), parent: host.current });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // switch files, preserving per-file undo history
  useEffect(() => {
    const v = view.current;
    if (!v || currentId.current === fileId) return;
    states.current.set(currentId.current, v.state);
    currentId.current = fileId;
    const saved = states.current.get(fileId);
    v.setState(saved && saved.doc.toString() === value ? saved : EditorState.create({ doc: value, extensions: extensions() }));
    v.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // external content replacement (e.g. load example into same file)
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: fontComp.current.reconfigure(EditorView.theme({ "&": { fontSize: fontSize + "px" } })) });
  }, [fontSize]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: setErrorLine.of(error) });
    if (error && error.line <= v.state.doc.lines) {
      const ln = v.state.doc.line(error.line);
      v.dispatch({ effects: EditorView.scrollIntoView(ln.from, { y: "center" }) });
    }
  }, [error]);

  useEffect(() => {
    const v = view.current;
    if (!v || !jump || jump.line > v.state.doc.lines) return;
    const ln = v.state.doc.line(jump.line);
    const pos = Math.min(ln.to, ln.from + Math.max(0, jump.col - 1));
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    v.focus();
  }, [jump]);

  return <div ref={host} className="h-full w-full overflow-hidden" />;
}
