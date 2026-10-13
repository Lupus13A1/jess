import { StreamLanguage, HighlightStyle, syntaxHighlighting, foldService, type StringStream } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import type { CompletionContext } from "@codemirror/autocomplete";
import { BUILTINS } from "@/lib/jess/engine";

export const CONSTRUCTS = ["defrule", "deffacts", "deftemplate", "deffunction", "defglobal", "defmodule", "defquery", "defclass"];
export const KEYWORDS = [
  "assert", "retract", "modify", "duplicate", "bind", "printout", "run", "reset", "clear", "facts", "rules",
  "agenda", "watch", "unwatch", "halt", "exit", "if", "then", "else", "while", "do", "foreach", "return",
  "progn", "and", "or", "not", "test", "exists", "slot", "multislot", "declare", "salience", "default", "eval", "build",
  "import", "new", "call", "set", "get", "set-member", "get-member", "definstance",
];
const KW = new Set(KEYWORDS);
const CON = new Set(CONSTRUCTS);
const ATOMS = new Set(["TRUE", "FALSE", "nil", "crlf", "t", "tab"]);
const BUILTIN = new Set(Object.keys(BUILTINS));

interface S {
  depth: number;
  afterParen: boolean;
}

const jess = StreamLanguage.define<S>({
  name: "jess",
  startState: () => ({ depth: 0, afterParen: false }),
  token(stream: StringStream, st: S) {
    if (stream.eatSpace()) return null;
    const ch = stream.peek()!;
    if (ch === ";") {
      stream.skipToEnd();
      return "comment";
    }
    if (ch === "(") {
      stream.next();
      st.depth++;
      st.afterParen = true;
      return "paren";
    }
    if (ch === ")") {
      stream.next();
      st.depth = Math.max(0, st.depth - 1);
      st.afterParen = false;
      return "paren";
    }
    const after = st.afterParen;
    st.afterParen = false;
    if (ch === '"') {
      stream.next();
      let esc = false;
      let c: string | void;
      while ((c = stream.next()) !== undefined) {
        if (c === '"' && !esc) break;
        esc = !esc && c === "\\";
      }
      return "string";
    }
    if (ch === "&" || ch === "|" || ch === "~") {
      stream.next();
      return "op";
    }
    if ((ch === ":" || ch === "=") && stream.string[stream.pos + 1] === "(") {
      stream.next();
      return "op";
    }
    stream.match(/^[^\s()";&|~]+/);
    const w = stream.current();
    if (w === "=>" || w === "<-") return "arrow";
    if (/^\$?\?\*.*\*$/.test(w)) return "global";
    if (/^\$?\?/.test(w)) return "var";
    if (/^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+)$/.test(w)) return "number";
    if (after) {
      if (CON.has(w)) return "construct";
      if (KW.has(w)) return "kw";
      if (BUILTIN.has(w)) return "builtin";
      return "head";
    }
    if (ATOMS.has(w)) return "atom";
    if (KW.has(w)) return "kw";
    return "symbol";
  },
  indent(st: S, textAfter: string) {
    const close = /^\)/.test(textAfter) ? 1 : 0;
    return Math.max(0, st.depth - close) * 3;
  },
  languageData: { commentTokens: { line: ";" }, closeBrackets: { brackets: ["(", '"'] } },
  tokenTable: {
    construct: t.definitionKeyword,
    kw: t.keyword,
    builtin: t.function(t.variableName),
    head: t.typeName,
    var: t.variableName,
    global: t.special(t.variableName),
    string: t.string,
    number: t.number,
    comment: t.lineComment,
    atom: t.atom,
    arrow: t.controlOperator,
    op: t.operator,
    paren: t.paren,
    symbol: t.name,
  },
});

export const jessLanguage = jess;

export const jessHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.definitionKeyword, color: "var(--syn-strong)", fontWeight: "700" },
    { tag: t.keyword, color: "var(--syn-strong)", fontWeight: "600" },
    { tag: t.function(t.variableName), color: "var(--syn-fn)" },
    { tag: t.typeName, color: "var(--syn-type)", fontWeight: "500", textDecoration: "underline", textDecorationColor: "var(--syn-faint)", textUnderlineOffset: "3px" },
    { tag: t.variableName, color: "var(--syn-var)", fontStyle: "italic" },
    { tag: t.special(t.variableName), color: "var(--syn-var)", fontStyle: "italic", fontWeight: "600" },
    { tag: t.string, color: "var(--syn-string)" },
    { tag: t.number, color: "var(--syn-number)" },
    { tag: t.lineComment, color: "var(--syn-comment)", fontStyle: "italic" },
    { tag: t.atom, color: "var(--syn-number)", fontWeight: "600" },
    { tag: t.controlOperator, color: "var(--syn-strong)", fontWeight: "800" },
    { tag: t.operator, color: "var(--syn-strong)", fontWeight: "700" },
    { tag: t.paren, color: "var(--syn-paren)" },
    { tag: t.name, color: "var(--syn-symbol)" },
  ]),
);

/** Fold any multi-line parenthesised expression starting on a line. */
export const jessFold = foldService.of((state, lineStart, lineEnd) => {
  const line = state.doc.sliceString(lineStart, lineEnd);
  const idx = line.indexOf("(");
  if (idx < 0 || line.slice(0, idx).includes(";")) return null;
  const text = state.doc.toString();
  let depth = 0;
  let inStr = false;
  for (let i = lineStart + idx; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === ";") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        if (i <= lineEnd) return null;
        return { from: lineStart + idx + 1, to: i };
      }
    }
  }
  return null;
});

const ALL_WORDS = [...CONSTRUCTS, ...KEYWORDS, ...Object.keys(BUILTINS)];
export function jessCompletions(ctx: CompletionContext) {
  const word = ctx.matchBefore(/[\w$?*\-<>=!+/]+/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  const doc = ctx.state.doc.toString();
  const vars = new Set(doc.match(/\$?\?[\w*\-]+/g) ?? []);
  return {
    from: word.from,
    options: [
      ...ALL_WORDS.map((w) => ({ label: w, type: CON.has(w) ? "class" : KW.has(w) ? "keyword" : "function" })),
      ...[...vars].map((v) => ({ label: v, type: "variable" })),
    ],
    validFor: /^[\w$?*\-]*$/,
  };
}
