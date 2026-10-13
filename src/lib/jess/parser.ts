import { JessError, sym, type Value } from "./types";

export type Node =
  | { k: "list"; items: Node[]; line: number; col: number; start: number; end: number }
  | { k: "atom"; v: Value; raw: string; isString: boolean; line: number; col: number }
  | { k: "var"; name: string; multi: boolean; line: number; col: number }
  | { k: "op"; op: "&" | "|" | "~" | ":" | "=" | "<-"; line: number; col: number };

const NUM = /^[+-]?(\d+\.?\d*([eE][+-]?\d+)?|\.\d+([eE][+-]?\d+)?)$/;
const DELIM = new Set(["(", ")", '"', ";", "&", "|", "~"]);

export function parse(src: string): Node[] {
  let i = 0;
  let line = 1;
  let col = 1;
  const n = src.length;

  const adv = () => {
    if (src[i] === "\n") {
      line++;
      col = 1;
    } else col++;
    i++;
  };

  const skip = () => {
    while (i < n) {
      const c = src[i];
      if (c === undefined) break;
      if (c === ";") {
        while (i < n) {
          const commentChar = src[i];
          if (commentChar === undefined || commentChar === "\n") break;
          adv();
        }
      } else if (/\s/.test(c)) adv();
      else break;
    }
  };

  function readNode(): Node {
    skip();
    if (i >= n) throw new JessError("ParseError", "Unexpected end of input", line, col);
    const c = src[i];
    const L = line;
    const C = col;
    if (c === "(") {
      const start = i;
      adv();
      const items: Node[] = [];
      for (;;) {
        skip();
        if (i >= n)
          throw new JessError("ParseError", "Missing closing parenthesis ')' for expression", L, C);
        if (src[i] === ")") {
          adv();
          break;
        }
        items.push(readNode());
      }
      return { k: "list", items, line: L, col: C, start, end: i };
    }
    if (c === ")") throw new JessError("ParseError", "Unexpected ')'", L, C);
    if (c === '"') {
      adv();
      let s = "";
      for (;;) {
        if (i >= n) throw new JessError("ParseError", "Unterminated string literal", L, C);
        const ch = src[i];
        if (ch === "\\" && i + 1 < n) {
          adv();
          const e = src[i];
          s += e === "n" ? "\n" : e === "t" ? "\t" : e;
          adv();
          continue;
        }
        if (ch === '"') {
          adv();
          break;
        }
        s += ch;
        adv();
      }
      return { k: "atom", v: s, raw: JSON.stringify(s), isString: true, line: L, col: C };
    }
    if (c === "&" || c === "|" || c === "~") {
      adv();
      return { k: "op", op: c, line: L, col: C };
    }
    if ((c === ":" || c === "=") && src[i + 1] === "(") {
      adv();
      return { k: "op", op: c, line: L, col: C };
    }
    let raw = "";
    while (i < n && !/\s/.test(src[i]!) && !DELIM.has(src[i]!)) {
      raw += src[i]!;
      adv();
    }
    if (raw === "<-") return { k: "op", op: "<-", line: L, col: C };
    if (raw.startsWith("$?")) return { k: "var", name: raw.slice(2), multi: true, line: L, col: C };
    if (raw.startsWith("?")) return { k: "var", name: raw.slice(1), multi: false, line: L, col: C };
    if (NUM.test(raw)) return { k: "atom", v: Number(raw), raw, isString: false, line: L, col: C };
    return { k: "atom", v: sym(raw), raw, isString: false, line: L, col: C };
  }

  const out: Node[] = [];
  for (;;) {
    skip();
    if (i >= n) break;
    out.push(readNode());
  }
  return out;
}
