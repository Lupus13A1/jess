import { parse, type Node } from "./parser";
import {
  FALSE,
  Fact,
  JavaObject,
  JessError,
  NIL,
  Sym,
  TRUE,
  sym,
  type ConsoleEntry,
  type Snapshot,
  type Template,
  type Value,
} from "./types";

type Vars = Map<string, Value>;
interface Ctx {
  vars: Vars;
}

interface Term {
  neg: boolean;
  kind: "lit" | "var" | "any" | "pred" | "ret";
  value?: Value;
  name?: string;
  expr?: Node;
}
interface Constraint {
  multi: boolean; // $?x or $?
  varName?: string;
  or: Term[][];
}
type CE =
  | {
      type: "pattern";
      template: string;
      ordered: boolean;
      binder?: string;
      seq: Constraint[]; // ordered
      slots: { name: string; multi: boolean; seq: Constraint[] }[];
    }
  | { type: "test"; expr: Node }
  | { type: "not"; ces: CE[] }
  | { type: "exists"; ces: CE[] };

interface Rule {
  name: string;
  doc?: string;
  salience: number;
  ces: CE[];
  actions: Node[];
  order: number;
}
interface Activation {
  rule: Rule;
  facts: Fact[];
  vars: Vars;
  key: string;
  recency: number[];
}
interface DefFn {
  name: string;
  params: { name: string; multi: boolean }[];
  body: Node[];
}

class ReturnSignal {
  constructor(public value: Value) {}
}
class HaltSignal {}

const isList = (n: Node): n is Extract<Node, { k: "list" }> => n.k === "list";
const headName = (n: Node): string | null =>
  isList(n) && n.items[0]?.k === "atom" && n.items[0].v instanceof Sym ? n.items[0].v.name : null;

export function fmtNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

export function fmt(v: Value, quote = true): string {
  if (typeof v === "number") return fmtNumber(v);
  if (typeof v === "string") return quote ? JSON.stringify(v) : v;
  if (v instanceof Sym) return v.name;
  if (v instanceof Fact) return `<Fact-${v.id}>`;
  if (v instanceof JavaObject) return v.toString();
  if (Array.isArray(v)) return v.map((x) => fmt(x, quote)).join(" ");
  return String(v);
}

export function eqVal(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (a instanceof JavaObject && b instanceof JavaObject) return a === b;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => eqVal(x, b[i]!));
  return false;
}

const truthy = (v: Value) => v !== FALSE;
const bool = (b: boolean) => (b ? TRUE : FALSE);

export interface EngineOptions {
  out: (e: ConsoleEntry) => void;
  gui?: (event: JavaGuiEvent) => void;
}

export interface JavaGuiEvent {
  type: "message" | "input";
  message: string;
  title?: string;
  messageType?: number;
}

const KNOWN_CLASSES = new Set([
  "javax.swing.JFrame",
  "javax.swing.JPanel",
  "javax.swing.JButton",
  "javax.swing.JLabel",
  "javax.swing.JTextField",
  "javax.swing.JTextArea",
  "javax.swing.JCheckBox",
  "javax.swing.JComboBox",
  "javax.swing.JOptionPane",
  "javax.swing.JScrollPane",
  "javax.swing.JTable",
  "javax.swing.JList",
  "javax.swing.BorderLayout",
  "javax.swing.FlowLayout",
  "javax.swing.GridLayout",
  "java.awt.Color",
  "java.awt.Font",
  "java.awt.Dimension",
  "java.awt.Point",
  "java.awt.Button",
  "java.awt.Label",
  "java.awt.Panel",
  "java.awt.Frame",
  "java.util.ArrayList",
  "java.util.Vector",
  "java.util.HashMap",
  "java.util.Hashtable",
  "java.util.HashSet",
  "java.util.Date",
  "java.util.Random",
  "java.lang.String",
  "java.lang.Integer",
  "java.lang.Double",
  "java.lang.Boolean",
  "java.lang.System",
  "java.lang.Math",
  "java.lang.Thread",
]);

export class Engine {
  templates = new Map<string, Template>();
  rules = new Map<string, Rule>();
  facts = new Map<number, Fact>();
  factIndex = new Map<string, Fact>();
  deffacts = new Map<string, Node[]>();
  globals = new Map<string, { init: Node; value: Value }>();
  functions = new Map<string, DefFn>();
  fired = new Set<string>();
  topVars: Vars = new Map();
  nextFactId = 0;
  clock = 0;
  ruleOrder = 0;
  halted = false;
  watch = { facts: false, rules: false, activations: false };
  imports = new Set<string>(["java.lang.*", "java.util.*"]);
  file = "";
  source = "";
  private out: (e: ConsoleEntry) => void;
  private gui: ((event: JavaGuiEvent) => void) | undefined;
  private stdoutBuf = "";

  constructor(opts: EngineOptions) {
    this.out = opts.out;
    this.gui = opts.gui;
    this.clear();
  }

  // ---------- output ----------
  write(text: string) {
    this.stdoutBuf += text;
  }
  flush() {
    if (this.stdoutBuf) {
      this.out({ kind: "stdout", text: this.stdoutBuf });
      this.stdoutBuf = "";
    }
  }
  emit(e: ConsoleEntry) {
    this.flush();
    this.out(e);
  }

  // ---------- top-level ----------
  clear() {
    this.templates.clear();
    this.rules.clear();
    this.facts.clear();
    this.factIndex.clear();
    this.deffacts.clear();
    this.globals.clear();
    this.functions.clear();
    this.fired.clear();
    this.topVars = new Map();
    this.nextFactId = 0;
    this.clock = 0;
    this.imports = new Set<string>(["java.lang.*", "java.util.*"]);
    this.templates.set("initial-fact", { name: "initial-fact", ordered: true, slots: [] });
  }

  reset() {
    this.facts.clear();
    this.factIndex.clear();
    this.fired.clear();
    this.nextFactId = 0;
    for (const g of this.globals.values()) g.value = this.eval(g.init, { vars: new Map() });
    this.assertFact(this.templates.get("initial-fact")!, new Map([["__data", []]]));
    for (const nodes of this.deffacts.values()) {
      for (const n of nodes) this.assertFromNode(n, { vars: new Map() });
    }
  }

  /** Execute source code. echo=true mimics the interactive Jess> prompt. */
  execute(src: string, opts: { echo: boolean; file?: string }): { ok: boolean; last: Value } {
    this.halted = false;
    this.file = opts.file ?? "";
    this.source = src;
    let last: Value = NIL;
    let nodes: Node[];
    try {
      nodes = parse(src);
    } catch (e) {
      this.reportError(e);
      return { ok: false, last };
    }
    for (const node of nodes) {
      if (opts.echo) {
        const text = isList(node) ? src.slice(node.start, node.end) : fmt(this.peekAtom(node));
        this.emit({ kind: "prompt", text });
      }
      try {
        last = this.eval(node, { vars: this.topVars });
        this.flush();
        if (opts.echo && last !== NIL) this.emit({ kind: "result", text: fmt(last) });
      } catch (e) {
        if (e instanceof HaltSignal) {
          this.flush();
          continue;
        }
        this.reportError(e, node);
        return { ok: false, last };
      }
    }
    this.flush();
    return { ok: true, last };
  }

  private peekAtom(n: Node): Value {
    if (n.k === "atom") return n.v;
    if (n.k === "var") return sym((n.multi ? "$?" : "?") + n.name);
    return NIL;
  }

  private reportError(e: unknown, node?: Node) {
    this.flush();
    let type = "JessException";
    let msg = String(e);
    let line: number | undefined;
    let col: number | undefined;
    if (e instanceof JessError) {
      type = e.errorType;
      msg = e.message;
      line = e.line;
      col = e.col;
    } else if (e instanceof RangeError) {
      type = "StackOverflow";
      msg = "Maximum recursion depth exceeded";
    } else if (e instanceof Error) msg = e.message;
    if (line === undefined && node) {
      line = node.line;
      col = node.col;
    }
    const context = line ? this.source.split("\n")[line - 1] : undefined;
    this.out({
      kind: "error",
      text: msg,
      errorType: type,
      ...(line !== undefined ? { line } : {}),
      ...(col !== undefined ? { col } : {}),
      ...(this.file ? { file: this.file } : {}),
      ...(context !== undefined ? { context } : {}),
    });
  }

  private err(type: string, msg: string, n?: Node): never {
    throw new JessError(type, msg, n?.line, n?.col);
  }

  // ---------- facts ----------
  factKey(t: Template, slots: Map<string, Value>) {
    const parts = [t.name];
    for (const [k, v] of slots) parts.push(k + "=" + fmt(v));
    return parts.join("\u0001");
  }

  factText(f: Fact): string {
    if (f.template.ordered) {
      const d = f.slots.get("__data") as Value[];
      return `(MAIN::${f.template.name}${d.length ? " " + fmt(d) : ""})`;
    }
    const parts = f.template.slots.map((s) => `(${s.name}${(() => {
      const v = f.slots.get(s.name)!;
      const t = fmt(v);
      return t ? " " + t : "";
    })()})`);
    return `(MAIN::${f.template.name}${parts.length ? " " + parts.join(" ") : ""})`;
  }

  assertFact(t: Template, slots: Map<string, Value>): Value {
    const key = this.factKey(t, slots);
    if (this.factIndex.has(key)) return FALSE;
    const f = new Fact(this.nextFactId++, t, slots, ++this.clock);
    this.facts.set(f.id, f);
    this.factIndex.set(key, f);
    if (this.watch.facts) this.emit({ kind: "watch", text: ` ==> f-${f.id} ${this.factText(f)}` });
    return f;
  }

  retractFact(f: Fact): boolean {
    if (!this.facts.has(f.id)) return false;
    this.facts.delete(f.id);
    this.factIndex.delete(this.factKey(f.template, f.slots));
    if (this.watch.facts) this.emit({ kind: "watch", text: ` <== f-${f.id} ${this.factText(f)}` });
    return true;
  }

  private getTemplateOrImplied(name: string): Template {
    let t = this.templates.get(name);
    if (!t) {
      t = { name, ordered: true, slots: [] };
      this.templates.set(name, t);
    }
    return t;
  }

  private buildSlots(t: Template, items: Node[], ctx: Ctx, base?: Map<string, Value>) {
    const slots = new Map<string, Value>();
    if (base) for (const [k, v] of base) slots.set(k, v);
    else for (const s of t.slots) slots.set(s.name, s.default);
    for (const it of items) {
      if (!isList(it) || !headName(it)) this.err("ParseError", `Bad slot specification in ${t.name}`, it);
      const sname = headName(it)!;
      const def = t.slots.find((s) => s.name === sname);
      if (!def) this.err("SlotError", `No such slot ${sname} in template MAIN::${t.name}`, it);
      const vals = this.evalArgs(it.items.slice(1), ctx).flatMap((v) => (Array.isArray(v) ? v : [v]));
      slots.set(sname, def.multi ? vals : (vals[0] ?? NIL));
    }
    return slots;
  }

  assertFromNode(n: Node, ctx: Ctx): Value {
    if (!isList(n) || !headName(n)) this.err("ParseError", "Bad fact specification", n);
    const name = headName(n)!;
    const t = this.getTemplateOrImplied(name);
    if (t.ordered) {
      const data = this.evalArgs(n.items.slice(1), ctx).flatMap((v) => (Array.isArray(v) ? v : [v]));
      return this.assertFact(t, new Map([["__data", data]]));
    }
    return this.assertFact(t, this.buildSlots(t, n.items.slice(1), ctx));
  }

  private toFact(v: Value, n: Node): Fact {
    if (v instanceof Fact) return v;
    if (typeof v === "number") {
      const f = this.facts.get(v);
      if (!f) this.err("FactError", `No such fact: f-${v}`, n);
      return f;
    }
    this.err("TypeError", `Expected a fact, got ${fmt(v)}`, n);
  }

  // ---------- evaluation ----------
  evalArgs(nodes: Node[], ctx: Ctx): Value[] {
    return nodes.map((x) => this.eval(x, ctx));
  }

  lookupVar(name: string, ctx: Ctx, n: Node): Value {
    if (name.startsWith("*") && name.endsWith("*") && name.length > 2) {
      const g = this.globals.get(name);
      if (!g) this.err("UndefinedVariable", `No such variable ?${name}`, n);
      return g.value;
    }
    if (ctx.vars.has(name)) return ctx.vars.get(name)!;
    this.err("UndefinedVariable", `No such variable ?${name}`, n);
  }

  eval(n: Node, ctx: Ctx): Value {
    switch (n.k) {
      case "atom":
        return n.v;
      case "var":
        return this.lookupVar(n.name, ctx, n);
      case "op":
        return sym(n.op);
      case "list":
        return this.call(n, ctx);
    }
  }

  private body(nodes: Node[], ctx: Ctx): Value {
    let v: Value = NIL;
    for (const x of nodes) v = this.eval(x, ctx);
    return v;
  }

  private num(v: Value, n: Node): number {
    if (typeof v === "number") return v;
    this.err("TypeError", `Not a number: ${fmt(v)}`, n);
  }

  private str(v: Value): string {
    return fmt(v, false);
  }

  call(n: Extract<Node, { k: "list" }>, ctx: Ctx): Value {
    const head = n.items[0];
    if (!head) return NIL;

    if (head.k === "var") {
      const target = this.lookupVar(head.name, ctx, head);
      if (target instanceof JavaObject) {
        if (n.items.length < 2) this.err("ParseError", "Expected method name", head);
        const methodName = this.nameOfMethod(n.items[1]!);
        const args = this.evalArgs(n.items.slice(2), ctx);
        return this.invokeJavaMethod(target, methodName, args, n);
      }
    }

    if (head.k === "list") {
      const target = this.eval(head, ctx);
      if (target instanceof JavaObject) {
        if (n.items.length < 2) this.err("ParseError", "Expected method name", head);
        const methodName = this.nameOfMethod(n.items[1]!);
        const args = this.evalArgs(n.items.slice(2), ctx);
        return this.invokeJavaMethod(target, methodName, args, n);
      }
    }

    if (head.k !== "atom" || !(head.v instanceof Sym)) {
      this.err("ParseError", `Bad function call: expected a function name`, n);
    }
    const name = head.v.name;
    const a = n.items.slice(1);
    const ev = () => this.evalArgs(a, ctx);

    switch (name) {
      // ---- constructs ----
      case "deftemplate":
        return this.defTemplate(n);
      case "defrule":
        return this.defRule(n);
      case "deffacts": {
        const fname = this.nameOf(a[0], n);
        let rest = a.slice(1);
        if (rest[0]?.k === "atom" && typeof rest[0].v === "string") rest = rest.slice(1);
        this.deffacts.set(fname, rest);
        return TRUE;
      }
      case "deffunction":
        return this.defFunction(n);
      case "defglobal": {
        for (let i = 0; i < a.length; i += 3) {
          const v = a[i]!;
          if (v.k !== "var" || !/^\*.+\*$/.test(v.name))
            this.err("ParseError", "defglobal expects ?*name* = value", v);
          if (!(a[i + 1]?.k === "atom" && (a[i + 1] as { v: Value }).v === sym("=")) || !a[i + 2])
            this.err("ParseError", "defglobal expects ?*name* = value", v);
          const init = a[i + 2]!;
          this.globals.set(v.name, { init, value: this.eval(init, ctx) });
        }
        return TRUE;
      }
      // ---- Java interop ----
      case "import": {
        for (const it of a) {
          const pkg = this.str(this.eval(it, ctx));
          this.imports.add(pkg);
        }
        return TRUE;
      }
      case "new": {
        if (!a[0]) this.err("ArgumentError", "new: expected class name", n);
        const className = this.str(this.eval(a[0], ctx));
        const args = this.evalArgs(a.slice(1), ctx);
        return this.instantiateJava(className, args, n);
      }
      case "call": {
        if (a.length < 2) this.err("ArgumentError", "call: expected target and method name", n);
        const target = this.eval(a[0]!, ctx);
        const methodName = this.nameOfMethod(a[1]!);
        const args = this.evalArgs(a.slice(2), ctx);
        return this.invokeJavaMethod(target, methodName, args, n);
      }
      case "set":
      case "set-member": {
        if (a.length < 3) this.err("ArgumentError", `${name}: expected target, property, and value`, n);
        const target = this.eval(a[0]!, ctx);
        const prop = this.nameOfMethod(a[1]!);
        const val = this.eval(a[2]!, ctx);
        return this.setJavaProperty(target, prop, val, n);
      }
      case "get":
      case "get-member": {
        if (a.length < 2) this.err("ArgumentError", `${name}: expected target and property`, n);
        const target = this.eval(a[0]!, ctx);
        const prop = this.nameOfMethod(a[1]!);
        return this.getJavaProperty(target, prop, n);
      }
      case "defclass": {
        if (a.length < 2) this.err("ArgumentError", "defclass: expected template name and Java class name", n);
        const tname = this.nameOf(a[0], n);
        const jclass = this.str(this.eval(a[1]!, ctx));
        const t: Template = {
          name: tname,
          ordered: false,
          slots: [
            { name: "OBJECT", multi: false, default: NIL },
            { name: "class", multi: false, default: sym(jclass) },
          ],
          doc: `Java bean wrapper for ${jclass}`,
        };
        this.templates.set(tname, t);
        return sym(tname);
      }
      case "definstance": {
        if (a.length < 2) this.err("ArgumentError", "definstance: expected template name and Java object", n);
        const tname = this.nameOf(a[0], n);
        const obj = this.eval(a[1]!, ctx);
        const t = this.templates.get(tname);
        if (!t) this.err("TemplateError", `No such template ${tname}`, n);
        const slots = new Map<string, Value>();
        slots.set("OBJECT", obj);
        if (obj instanceof JavaObject) {
          slots.set("class", sym(obj.className));
          for (const [k, v] of obj.properties) {
            slots.set(k, v);
            if (!t.slots.some((s) => s.name === k)) {
              t.slots.push({ name: k, multi: false, default: NIL });
            }
          }
        }
        return this.assertFact(t, slots);
      }
      // ---- engine ----
      case "reset":
        this.reset();
        return TRUE;
      case "clear":
        this.clear();
        return TRUE;
      case "run": {
        const lim = a[0] ? this.num(this.eval(a[0], ctx), a[0]) : Infinity;
        return this.run(lim);
      }
      case "halt":
        this.halted = true;
        return NIL;
      case "exit":
        this.halted = true;
        throw new HaltSignal();
      case "facts": {
        const list = [...this.facts.values()].sort((x, y) => x.id - y.id);
        for (const f of list) this.write(`f-${f.id}   ${this.factText(f)}\n`);
        this.write(`For a total of ${list.length} facts in module MAIN.\n`);
        return NIL;
      }
      case "rules": {
        for (const r of this.rules.values()) this.write(`MAIN::${r.name}\n`);
        this.write(`For a total of ${this.rules.size} rules in module MAIN.\n`);
        return NIL;
      }
      case "agenda": {
        const acts = this.agenda();
        for (const x of acts)
          this.write(
            `[Activation: MAIN::${x.rule.name}  ${x.facts.map((f) => "f-" + f.id).join(", ")} ; salience=${x.rule.salience}]\n`,
          );
        this.write(`For a total of ${acts.length} activations in module MAIN.\n`);
        return NIL;
      }
      case "watch":
      case "unwatch": {
        const on = name === "watch";
        for (const x of a) {
          const w = this.nameOf(x, n);
          if (w === "all") this.watch = { facts: on, rules: on, activations: on };
          else if (w in this.watch) this.watch[w as keyof typeof this.watch] = on;
        }
        return TRUE;
      }
      case "ppdefrule": {
        const r = this.rules.get(this.nameOf(a[0], n));
        if (!r) this.err("UndefinedRule", "No such rule", n);
        return `(defrule MAIN::${r.name} ...)`;
      }
      // ---- working memory ----
      case "assert": {
        let last: Value = FALSE;
        for (const x of a) last = this.assertFromNode(x, ctx);
        return last;
      }
      case "retract": {
        for (const x of a) {
          const v = this.eval(x, ctx);
          this.retractFact(this.toFact(v, x));
        }
        return TRUE;
      }
      case "modify":
      case "duplicate": {
        const f = this.toFact(this.eval(a[0]!, ctx), a[0]!);
        if (f.template.ordered) this.err("FactError", `Cannot ${name} an ordered fact`, n);
        const slots = this.buildSlots(f.template, a.slice(1), ctx, f.slots);
        if (name === "duplicate") return this.assertFact(f.template, slots);
        this.retractFact(f);
        const key = this.factKey(f.template, slots);
        if (this.factIndex.has(key)) return FALSE;
        f.slots = slots;
        f.stamp = ++this.clock;
        this.facts.set(f.id, f);
        this.factIndex.set(key, f);
        if (this.watch.facts) this.emit({ kind: "watch", text: ` ==> f-${f.id} ${this.factText(f)}` });
        return f;
      }
      case "fact-slot-value": {
        const f = this.toFact(this.eval(a[0]!, ctx), a[0]!);
        const s = this.str(this.eval(a[1]!, ctx));
        return f.slots.get(f.template.ordered ? "__data" : s) ?? NIL;
      }
      // ---- control ----
      case "bind": {
        const v = a[0];
        if (!v || v.k !== "var") this.err("ParseError", "bind: first argument must be a variable", n);
        const vals = this.evalArgs(a.slice(1), ctx);
        const val = v.multi || vals.length > 1 ? vals.flatMap((x) => (Array.isArray(x) ? x : [x])) : (vals[0] ?? NIL);
        if (/^\*.+\*$/.test(v.name)) {
          const g = this.globals.get(v.name);
          if (g) g.value = val;
          else this.globals.set(v.name, { init: { k: "atom", v: NIL, raw: "nil", isString: false, line: 0, col: 0 }, value: val });
        } else ctx.vars.set(v.name, val);
        return val;
      }
      case "if": {
        const cond = truthy(this.eval(a[0]!, ctx));
        const thenIdx = a.findIndex((x) => x.k === "atom" && x.v === sym("then"));
        const elseIdx = a.findIndex((x) => x.k === "atom" && x.v === sym("else"));
        if (thenIdx < 0) this.err("ParseError", "if: missing 'then'", n);
        const thenPart = a.slice(thenIdx + 1, elseIdx < 0 ? undefined : elseIdx);
        const elsePart = elseIdx < 0 ? [] : a.slice(elseIdx + 1);
        return this.body(cond ? thenPart : elsePart, ctx);
      }
      case "while": {
        let doIdx = a.findIndex((x) => x.k === "atom" && x.v === sym("do"));
        if (doIdx < 0) doIdx = 0;
        const bodyNodes = a.slice(doIdx + 1);
        let v: Value = FALSE;
        while (truthy(this.eval(a[0]!, ctx))) v = this.body(bodyNodes, ctx);
        return v;
      }
      case "foreach": {
        const v = a[0]!;
        if (v.k !== "var") this.err("ParseError", "foreach: expected a variable", n);
        const list = this.eval(a[1]!, ctx);
        let r: Value = NIL;
        for (const item of Array.isArray(list) ? list : [list]) {
          ctx.vars.set(v.name, item);
          r = this.body(a.slice(2), ctx);
        }
        return r;
      }
      case "progn":
        return this.body(a, ctx);
      case "return":
        throw new ReturnSignal(a[0] ? this.eval(a[0], ctx) : NIL);
      case "and":
        for (const x of a) if (!truthy(this.eval(x, ctx))) return FALSE;
        return TRUE;
      case "or":
        for (const x of a) if (truthy(this.eval(x, ctx))) return TRUE;
        return FALSE;
      case "printout": {
        const parts = a.slice(1).map((x) => {
          if (x.k === "atom" && x.v === sym("crlf")) return "\n";
          if (x.k === "atom" && x.v === sym("tab")) return "\t";
          return this.str(this.eval(x, ctx));
        });
        this.write(parts.join(""));
        return NIL;
      }
      case "eval":
      case "build": {
        const code = this.str(this.eval(a[0]!, ctx));
        let v: Value = NIL;
        for (const node of parse(code)) v = this.eval(node, { vars: new Map() });
        return v;
      }
    }

    // ---- user functions ----
    const fn = this.functions.get(name);
    if (fn) return this.callFn(fn, ev(), n);

    const b = BUILTINS[name];
    if (b) return b(ev(), this, n);

    if (name.includes(".")) {
      const dotIdx = name.lastIndexOf(".");
      const className = name.slice(0, dotIdx);
      const methodName = name.slice(dotIdx + 1);
      const args = ev();
      return this.invokeJavaStaticMethod(className, methodName, args, n);
    }

    this.err("UndefinedFunction", `Undefined function ${name}`, head);
  }

  private nameOfMethod(n: Node): string {
    if (n.k === "atom") {
      if (typeof n.v === "string") return n.v;
      if (n.v instanceof Sym) return n.v.name;
    }
    return this.str(this.eval(n, { vars: new Map() }));
  }

  resolveClassName(name: string): string {
    if (name.includes(".")) return name;
    for (const imp of this.imports) {
      if (imp.endsWith(".*")) {
        const prefix = imp.slice(0, -1);
        if (KNOWN_CLASSES.has(prefix + name)) {
          return prefix + name;
        }
      } else if (imp.endsWith("." + name)) {
        return imp;
      }
    }
    for (const imp of this.imports) {
      if (imp.endsWith(".*")) {
        return imp.slice(0, -1) + name;
      }
    }
    return name;
  }

  instantiateJava(className: string, args: Value[], _n: Node): JavaObject {
    const resolved = this.resolveClassName(className);
    const obj = new JavaObject(resolved);

    if (resolved.endsWith("JFrame") || resolved.endsWith("Frame")) {
      const title = args[0] ? this.str(args[0]) : "Jess Window";
      obj.properties.set("title", title);
      obj.state["visible"] = false;
      obj.state["width"] = 400;
      obj.state["height"] = 300;
      obj.state["children"] = [];
    } else if (
      resolved.endsWith("JButton") ||
      resolved.endsWith("JLabel") ||
      resolved.endsWith("Button") ||
      resolved.endsWith("Label")
    ) {
      const text = args[0] ? this.str(args[0]) : "";
      obj.properties.set("text", text);
    } else if (resolved.endsWith("JTextField") || resolved.endsWith("JTextArea")) {
      const text = args[0] ? this.str(args[0]) : "";
      obj.properties.set("text", text);
      if (args[1] !== undefined) obj.properties.set("columns", args[1]);
    } else if (resolved.endsWith("JPanel") || resolved.endsWith("Panel")) {
      obj.state["children"] = [];
    } else if (resolved.endsWith("ArrayList") || resolved.endsWith("Vector")) {
      obj.state["list"] = [];
    } else if (resolved.endsWith("HashMap") || resolved.endsWith("Hashtable")) {
      obj.state["map"] = new Map<string, Value>();
    } else if (resolved.endsWith("Date")) {
      obj.state["date"] = args[0] ? new Date(this.str(args[0])) : new Date();
    } else {
      obj.state["constructorArgs"] = args;
    }
    return obj;
  }

  invokeJavaMethod(target: Value, methodName: string, args: Value[], n: Node): Value {
    if (target instanceof Sym) {
      return this.invokeJavaStaticMethod(target.name, methodName, args, n);
    }
    if (typeof target === "string") {
      return this.invokeJavaStaticMethod(target, methodName, args, n);
    }
    if (!(target instanceof JavaObject)) {
      this.err("TypeError", `Expected a JavaObject or class name for method call ${methodName}, got ${fmt(target)}`, n);
    }

    const obj = target as JavaObject;

    if (methodName === "setVisible") {
      const v = truthy(args[0] ?? TRUE);
      obj.state["visible"] = v;
      const title = obj.properties.get("title") ?? obj.properties.get("text");
      const titleStr = title !== undefined ? ` "${this.str(title)}"` : "";
      this.write(`[Swing] ${obj.className}${titleStr} setVisible: ${v ? "TRUE" : "FALSE"}\n`);
      return TRUE;
    }
    if (methodName === "isVisible") {
      return bool(obj.state["visible"] === true);
    }
    if (methodName === "setSize") {
      obj.state["width"] = args[0] ?? 0;
      obj.state["height"] = args[1] ?? 0;
      return TRUE;
    }
    if (methodName === "add") {
      if (obj.state["list"]) {
        if (args[0] !== undefined) obj.state["list"].push(args[0]);
        return TRUE;
      }
      if (!obj.state["children"]) obj.state["children"] = [];
      if (args[0] !== undefined) obj.state["children"].push(args[0]);
      return obj;
    }
    if (methodName === "setTitle" || methodName === "setText") {
      const prop = methodName === "setTitle" ? "title" : "text";
      obj.properties.set(prop, args[0] ? this.str(args[0]) : "");
      return TRUE;
    }
    if (methodName === "getTitle" || methodName === "getText") {
      const prop = methodName === "getTitle" ? "title" : "text";
      return obj.properties.get(prop) ?? NIL;
    }
    if (
      methodName === "setLayout" ||
      methodName === "setDefaultCloseOperation" ||
      methodName === "pack" ||
      methodName === "repaint" ||
      methodName === "validate"
    ) {
      return TRUE;
    }

    if (obj.state["list"]) {
      if (methodName === "get") {
        const idx = typeof args[0] === "number" ? args[0] : 0;
        return obj.state["list"][idx] ?? NIL;
      }
      if (methodName === "size") {
        return obj.state["list"].length;
      }
      if (methodName === "clear") {
        obj.state["list"] = [];
        return TRUE;
      }
      if (methodName === "contains") {
        return bool(obj.state["list"].some((x: Value) => eqVal(x, args[0]!)));
      }
      if (methodName === "isEmpty") {
        return bool(obj.state["list"].length === 0);
      }
    }

    if (obj.state["map"]) {
      const map = obj.state["map"] as Map<string, Value>;
      if (methodName === "put") {
        const k = this.str(args[0]!);
        map.set(k, args[1] ?? NIL);
        return args[1] ?? NIL;
      }
      if (methodName === "get") {
        const k = this.str(args[0]!);
        return map.get(k) ?? NIL;
      }
      if (methodName === "size") {
        return map.size;
      }
      if (methodName === "containsKey") {
        const k = this.str(args[0]!);
        return bool(map.has(k));
      }
      if (methodName === "clear") {
        map.clear();
        return TRUE;
      }
    }

    if (methodName.startsWith("set") && methodName.length > 3 && args.length >= 1) {
      const prop = methodName.slice(3, 4).toLowerCase() + methodName.slice(4);
      obj.properties.set(prop, args[0]!);
      return TRUE;
    }
    if (methodName.startsWith("get") && methodName.length > 3 && args.length === 0) {
      const prop = methodName.slice(3, 4).toLowerCase() + methodName.slice(4);
      return obj.properties.get(prop) ?? NIL;
    }
    if (methodName.startsWith("is") && methodName.length > 2 && args.length === 0) {
      const prop = methodName.slice(2, 3).toLowerCase() + methodName.slice(3);
      return obj.properties.get(prop) ?? FALSE;
    }

    if (methodName === "toString") {
      return obj.toString();
    }

    if (!obj.state["calls"]) obj.state["calls"] = [];
    obj.state["calls"].push({ method: methodName, args });
    return TRUE;
  }

  invokeJavaStaticMethod(className: string, methodName: string, args: Value[], n: Node): Value {
    const resolved = this.resolveClassName(className);
    if (resolved === "java.lang.System" || resolved === "System") {
      if (methodName === "currentTimeMillis") return Date.now();
      if (methodName === "nanoTime") return Math.round(performance.now() * 1e6);
      if (methodName === "gc" || methodName === "exit") return NIL;
      if (methodName === "getProperty") return "Jess-Web/7.0";
    }
    if (resolved === "java.lang.Math" || resolved === "Math") {
      if (methodName === "sin") return Math.sin(this.num(args[0]!, n));
      if (methodName === "cos") return Math.cos(this.num(args[0]!, n));
      if (methodName === "tan") return Math.tan(this.num(args[0]!, n));
      if (methodName === "sqrt") return Math.sqrt(this.num(args[0]!, n));
      if (methodName === "pow") return Math.pow(this.num(args[0]!, n), this.num(args[1]!, n));
      if (methodName === "abs") return Math.abs(this.num(args[0]!, n));
      if (methodName === "min") return Math.min(this.num(args[0]!, n), this.num(args[1]!, n));
      if (methodName === "max") return Math.max(this.num(args[0]!, n), this.num(args[1]!, n));
      if (methodName === "random") return Math.random();
    }
    if (resolved.endsWith("JOptionPane")) {
      if (methodName === "showMessageDialog") {
        const msg = args.length > 1 ? this.str(args[1]!) : this.str(args[0] ?? "");
        const title = args.length > 2 ? this.str(args[2]!) : undefined;
        const messageType = args.length > 3 && typeof args[3] === "number" ? args[3] : undefined;
        this.gui?.({
          type: "message",
          message: msg,
          ...(title !== undefined ? { title } : {}),
          ...(messageType !== undefined ? { messageType } : {}),
        });
        this.write(`[JOptionPane] ${msg}\n`);
        return NIL;
      }
      if (methodName === "showInputDialog") {
        const msg = args.length > 1 ? this.str(args[1]!) : this.str(args[0] ?? "");
        const title = args.length > 3 ? this.str(args[2]!) : undefined;
        const messageType =
          args.length > 3 && typeof args[3] === "number"
            ? args[3]
            : args.length > 2 && typeof args[2] === "number"
              ? args[2]
              : undefined;
        this.gui?.({
          type: "input",
          message: msg,
          ...(title !== undefined ? { title } : {}),
          ...(messageType !== undefined ? { messageType } : {}),
        });
        this.write(`[JOptionPane Input] ${msg}\n`);
        return "OK";
      }
    }
    if (resolved === "java.lang.Integer" || resolved === "Integer") {
      if (methodName === "parseInt") return parseInt(this.str(args[0]!), 10);
    }
    if (resolved === "java.lang.Double" || resolved === "Double") {
      if (methodName === "parseDouble") return parseFloat(this.str(args[0]!));
    }
    return TRUE;
  }

  setJavaProperty(target: Value, prop: string, val: Value, n: Node): Value {
    if (target instanceof JavaObject) {
      target.properties.set(prop, val);
      return val;
    }
    this.err("TypeError", `Cannot set property ${prop} on non-Java object`, n);
  }

  getJavaProperty(target: Value, prop: string, n: Node): Value {
    if (target instanceof JavaObject) {
      return target.properties.get(prop) ?? NIL;
    }
    if (target instanceof Sym || typeof target === "string") {
      return this.getJavaStaticProperty(target instanceof Sym ? target.name : target, prop, n);
    }
    this.err("TypeError", `Cannot get property ${prop} from non-Java object`, n);
  }

  private getJavaStaticProperty(className: string, prop: string, n: Node): Value {
    const resolved = this.resolveClassName(className);
    if (resolved === "java.lang.Math" || resolved === "Math") {
      if (prop === "PI") return Math.PI;
      if (prop === "E") return Math.E;
    }
    if (resolved === "javax.swing.JOptionPane") {
      const messageTypes: Record<string, number> = {
        ERROR_MESSAGE: 0,
        INFORMATION_MESSAGE: 1,
        WARNING_MESSAGE: 2,
        QUESTION_MESSAGE: 3,
        PLAIN_MESSAGE: -1,
      };
      if (prop in messageTypes) return messageTypes[prop] ?? 0;
    }
    this.err("NoSuchField", `No such static field ${prop} on ${resolved}`, n);
  }

  private nameOf(n: Node | undefined, parent: Node): string {
    if (!n || n.k !== "atom" || !(n.v instanceof Sym)) this.err("ParseError", "Expected a name", n ?? parent);
    return n.v.name;
  }

  private callFn(fn: DefFn, args: Value[], n: Node): Value {
    const vars: Vars = new Map();
    const fixed = fn.params.filter((p) => !p.multi).length;
    const hasMulti = fn.params.some((p) => p.multi);
    if (args.length < fixed || (!hasMulti && args.length > fixed))
      this.err("ArgumentError", `${fn.name}: expected ${fixed} argument(s), got ${args.length}`, n);
    fn.params.forEach((p, i) => vars.set(p.name, p.multi ? args.slice(i) : (args[i] ?? NIL)));
    try {
      return this.body(fn.body, { vars });
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    }
  }

  // ---------- constructs ----------
  private defTemplate(n: Extract<Node, { k: "list" }>): Value {
    const a = n.items.slice(1);
    const name = this.nameOf(a[0], n);
    const t: Template = { name, ordered: false, slots: [] };
    for (const x of a.slice(1)) {
      if (x.k === "atom" && typeof x.v === "string") {
        t.doc = x.v;
        continue;
      }
      const h = headName(x);
      if (!isList(x) || !h) this.err("ParseError", "Bad slot definition in deftemplate", x);
      if (h === "declare") continue;
      if (h !== "slot" && h !== "multislot")
        this.err("ParseError", `Expected slot or multislot, got ${h}`, x);
      const sname = this.nameOf(x.items[1], x);
      let def: Value = h === "multislot" ? [] : NIL;
      for (const opt of x.items.slice(2)) {
        const oh = headName(opt);
        if (isList(opt) && (oh === "default" || oh === "default-dynamic")) {
          const vals = this.evalArgs(opt.items.slice(1), { vars: new Map() });
          def = h === "multislot" ? vals : (vals[0] ?? NIL);
        }
      }
      t.slots.push({ name: sname, multi: h === "multislot", default: def });
    }
    this.templates.set(name, t);
    return TRUE;
  }

  private defFunction(n: Extract<Node, { k: "list" }>): Value {
    const a = n.items.slice(1);
    const name = this.nameOf(a[0], n);
    const plist = a[1];
    if (!plist || !isList(plist)) this.err("ParseError", "deffunction: expected parameter list", n);
    const params = plist.items.map((p) => {
      if (p.k !== "var") this.err("ParseError", "deffunction: parameters must be variables", p);
      return { name: p.name, multi: p.multi };
    });
    let body = a.slice(2);
    if (body[0]?.k === "atom" && typeof body[0].v === "string" && body.length > 1) body = body.slice(1);
    this.functions.set(name, { name, params, body });
    return TRUE;
  }

  private defRule(n: Extract<Node, { k: "list" }>): Value {
    const a = n.items.slice(1);
    const name = this.nameOf(a[0], n);
    let i = 1;
    let doc: string | undefined;
    if (a[i]?.k === "atom" && typeof (a[i] as { v: Value }).v === "string") {
      doc = (a[i] as { v: string }).v;
      i++;
    }
    let salience = 0;
    const declaration = a[i];
    if (declaration && headName(declaration) === "declare") {
      if (!isList(declaration)) this.err("ParseError", `defrule ${name}: invalid declare`, n);
      for (const d of declaration.items.slice(1)) {
        if (headName(d) === "salience") {
          if (!isList(d)) continue;
          const salienceNode = d.items[1];
          if (!salienceNode) this.err("ParseError", "declare salience requires a value", d);
          salience = this.num(this.eval(salienceNode, { vars: new Map() }), d);
        }
      }
      i++;
    }
    const arrow = a.findIndex((x) => x.k === "atom" && x.v === sym("=>"));
    if (arrow < 0) this.err("ParseError", `defrule ${name}: missing '=>'`, n);
    const lhs = a.slice(i, arrow);
    const ces = this.parseCEs(lhs);
    if (!ces.some((c) => c.type === "pattern")) {
      ces.unshift({ type: "pattern", template: "initial-fact", ordered: true, seq: [], slots: [] });
    }
    const rule: Rule = { name, salience, ces, actions: a.slice(arrow + 1), order: this.ruleOrder++ };
    if (doc !== undefined) rule.doc = doc;
    this.rules.set(name, rule);
    return TRUE;
  }

  private parseCEs(nodes: Node[]): CE[] {
    const out: CE[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const x = nodes[i];
      if (!x) this.err("ParseError", "Expected a conditional element");
      if (x.k === "var" && nodes[i + 1]?.k === "op" && (nodes[i + 1] as { op: string }).op === "<-") {
        const p = nodes[i + 2];
        if (!p || !isList(p)) this.err("ParseError", "Expected a pattern after '<-'", x);
        const ce = this.parsePattern(p);
        ce.binder = x.name;
        out.push(ce);
        i += 2;
        continue;
      }
      if (!isList(x)) this.err("ParseError", "Expected a pattern on the rule LHS", x);
      const pattern = x;
      const h = headName(pattern);
      if (h === "test") {
        const expr = pattern.items[1];
        if (!expr) this.err("ParseError", "Expected expression in test conditional element", pattern);
        out.push({ type: "test", expr });
      }
      else if (h === "not") out.push({ type: "not", ces: this.parseCEs(pattern.items.slice(1)) });
      else if (h === "exists") out.push({ type: "exists", ces: this.parseCEs(pattern.items.slice(1)) });
      else if (h === "and") out.push(...this.parseCEs(pattern.items.slice(1)));
      else if (h === "or") this.err("Unsupported", "The 'or' conditional element is not supported in this runtime", pattern);
      else out.push(this.parsePattern(pattern));
    }
    return out;
  }

  private parsePattern(p: Extract<Node, { k: "list" }>): Extract<CE, { type: "pattern" }> {
    const name = headName(p);
    if (!name) this.err("ParseError", "Pattern must start with a template name", p);
    const t = this.templates.get(name);
    const items = p.items.slice(1);
    if (t && !t.ordered) {
      const slots = items.map((it) => {
        const sn = headName(it);
        if (!isList(it) || !sn) this.err("ParseError", `Bad slot pattern in ${name}`, it);
        const def = t.slots.find((s) => s.name === sn);
        if (!def) this.err("SlotError", `No such slot ${sn} in template MAIN::${name}`, it);
        return { name: sn, multi: def.multi, seq: this.parseConstraints(it.items.slice(1)) };
      });
      return { type: "pattern", template: name, ordered: false, seq: [], slots };
    }
    return { type: "pattern", template: name, ordered: true, seq: this.parseConstraints(items), slots: [] };
  }

  private parseConstraints(nodes: Node[]): Constraint[] {
    const out: Constraint[] = [];
    let i = 0;
    const term = (): Term => {
      let neg = false;
      if (nodes[i]?.k === "op" && (nodes[i] as { op: string }).op === "~") {
        neg = true;
        i++;
      }
      const x = nodes[i++];
      if (!x) this.err("ParseError", "Incomplete constraint");
      if (x.k === "op" && (x.op === ":" || x.op === "=")) {
        const expr = nodes[i++];
        if (!expr) this.err("ParseError", "Expected expression in constraint", x);
        return { neg, kind: x.op === ":" ? "pred" : "ret", expr };
      }
      if (x.k === "var") return x.name === "" ? { neg, kind: "any" } : { neg, kind: "var", name: x.name };
      if (x.k === "atom") return { neg, kind: "lit", value: x.v };
      this.err("ParseError", "Unexpected element in pattern", x);
    };
    while (i < nodes.length) {
      const first = nodes[i];
      if (!first) this.err("ParseError", "Incomplete constraint");
      if (first.k === "var" && first.multi) {
        i++;
        const constraint: Constraint = { multi: true, or: [] };
        if (first.name) constraint.varName = first.name;
        out.push(constraint);
        continue;
      }
      const or: Term[][] = [[term()]];
      while (nodes[i]?.k === "op") {
        const op = (nodes[i] as { op: string }).op;
        if (op === "&") {
          i++;
          const conjunction = or[or.length - 1];
          if (!conjunction) this.err("ParseError", "Incomplete constraint");
          conjunction.push(term());
        } else if (op === "|") {
          i++;
          or.push([term()]);
        } else break;
      }
      out.push({ multi: false, or });
    }
    return out;
  }

  // ---------- matching ----------
  private matchSingle(c: Constraint, val: Value, b: Vars): Vars | null {
    for (const conj of c.or) {
      const b2 = new Map(b);
      let ok = true;
      for (const t of conj) {
        let r: boolean;
        switch (t.kind) {
          case "any":
            r = true;
            break;
          case "lit":
            r = eqVal(val, t.value!);
            break;
          case "var":
            if (b2.has(t.name!)) r = eqVal(val, b2.get(t.name!)!);
            else if (/^\*.+\*$/.test(t.name!)) r = eqVal(val, this.globals.get(t.name!)?.value ?? NIL);
            else {
              if (!t.neg) b2.set(t.name!, val);
              r = !t.neg;
            }
            break;
          case "pred":
            r = truthy(this.eval(t.expr!, { vars: b2 }));
            break;
          case "ret":
            r = eqVal(val, this.eval(t.expr!, { vars: b2 }));
            break;
        }
        if (t.neg) r = !r;
        if (!r) {
          ok = false;
          break;
        }
      }
      if (ok) return b2;
    }
    return null;
  }

  private *matchSeq(cs: Constraint[], ci: number, vals: Value[], vi: number, b: Vars): Generator<Vars> {
    if (ci === cs.length) {
      if (vi === vals.length) yield b;
      return;
    }
    const c = cs[ci]!;
    if (c.multi) {
      if (c.varName && b.has(c.varName)) {
        const bound = b.get(c.varName)!;
        const arr = Array.isArray(bound) ? bound : [bound];
        if (eqVal(vals.slice(vi, vi + arr.length), arr)) yield* this.matchSeq(cs, ci + 1, vals, vi + arr.length, b);
        return;
      }
      for (let len = 0; vi + len <= vals.length; len++) {
        const b2 = new Map(b);
        if (c.varName) b2.set(c.varName, vals.slice(vi, vi + len));
        yield* this.matchSeq(cs, ci + 1, vals, vi + len, b2);
      }
      return;
    }
    if (vi >= vals.length) return;
    const b2 = this.matchSingle(c, vals[vi]!, b);
    if (b2) yield* this.matchSeq(cs, ci + 1, vals, vi + 1, b2);
  }

  private *matchFact(ce: Extract<CE, { type: "pattern" }>, f: Fact, b: Vars): Generator<Vars> {
    if (ce.ordered) {
      const data = (f.slots.get("__data") as Value[]) ?? [];
      yield* this.matchSeq(ce.seq, 0, data, 0, b);
      return;
    }
    const self = this;
    function* rec(si: number, bb: Vars): Generator<Vars> {
      if (si === ce.slots.length) {
        yield bb;
        return;
      }
      const s = ce.slots[si]!;
      const v = f.slots.get(s.name)!;
      if (s.multi) {
        for (const r of self.matchSeq(s.seq, 0, Array.isArray(v) ? v : [v], 0, bb)) yield* rec(si + 1, r);
      } else {
        if (s.seq.length !== 1) return;
        const r = self.matchSingle(s.seq[0]!, v, bb);
        if (r) yield* rec(si + 1, r);
      }
    }
    yield* rec(0, b);
  }

  private *matchCEs(ces: CE[], i: number, b: Vars, used: Fact[]): Generator<[Vars, Fact[]]> {
    if (i === ces.length) {
      yield [b, used];
      return;
    }
    const ce = ces[i]!;
    if (ce.type === "test") {
      if (truthy(this.eval(ce.expr, { vars: b }))) yield* this.matchCEs(ces, i + 1, b, used);
      return;
    }
    if (ce.type === "not" || ce.type === "exists") {
      const any = !this.matchCEs(ce.ces, 0, b, []).next().done;
      if (any === (ce.type === "exists")) yield* this.matchCEs(ces, i + 1, b, used);
      return;
    }
    for (const f of this.facts.values()) {
      if (f.template.name !== ce.template) continue;
      for (const b2 of this.matchFact(ce, f, b)) {
        let b3 = b2;
        if (ce.binder) {
          b3 = new Map(b2);
          b3.set(ce.binder, f);
        }
        yield* this.matchCEs(ces, i + 1, b3, [...used, f]);
      }
    }
  }

  agenda(): Activation[] {
    const acts: Activation[] = [];
    for (const r of this.rules.values()) {
      for (const [vars, facts] of this.matchCEs(r.ces, 0, new Map(), [])) {
        const key = r.name + "|" + facts.map((f) => f.id + ":" + f.stamp).join(",");
        if (this.fired.has(key)) continue;
        acts.push({ rule: r, facts, vars, key, recency: facts.map((f) => f.stamp).sort((x, y) => y - x) });
      }
    }
    acts.sort((x, y) => {
      if (y.rule.salience !== x.rule.salience) return y.rule.salience - x.rule.salience;
      const n = Math.max(x.recency.length, y.recency.length);
      for (let i = 0; i < n; i++) {
        const d = (y.recency[i] ?? -1) - (x.recency[i] ?? -1);
        if (d) return d;
      }
      return x.rule.order - y.rule.order;
    });
    return acts;
  }

  run(limit = Infinity): number {
    this.halted = false;
    let count = 0;
    while (!this.halted && count < limit) {
      const acts = this.agenda();
      if (!acts.length) break;
      const act = acts[0]!;
      this.fired.add(act.key);
      count++;
      if (this.watch.rules)
        this.emit({
          kind: "watch",
          text: `FIRE ${count} MAIN::${act.rule.name} ${act.facts.map((f) => "f-" + f.id).join(", ")}`,
        });
      try {
        this.body(act.rule.actions, { vars: new Map(act.vars) });
      } catch (e) {
        if (e instanceof ReturnSignal) continue;
        if (e instanceof JessError) {
          e.message = `${e.message}\n  while executing rule MAIN::${act.rule.name}`;
        }
        throw e;
      }
    }
    return count;
  }

  snapshot(): Snapshot {
    return {
      facts: [...this.facts.values()].sort((x, y) => x.id - y.id).map((f) => ({ id: f.id, text: this.factText(f) })),
      rules: [...this.rules.values()].map((r) => {
        const rule: { name: string; salience: number; doc?: string } = { name: r.name, salience: r.salience };
        if (r.doc !== undefined) rule.doc = r.doc;
        return rule;
      }),
      agenda: (() => {
        try {
          return this.agenda().map((x) => ({
            rule: x.rule.name,
            facts: x.facts.map((f) => "f-" + f.id).join(", "),
            salience: x.rule.salience,
          }));
        } catch {
          return [];
        }
      })(),
      templates: [...this.templates.values()]
        .filter((t) => t.name !== "initial-fact")
        .map((t) => ({ name: t.name, slots: t.ordered ? ["(ordered)"] : t.slots.map((s) => (s.multi ? "$" : "") + s.name) })),
      globals: [...this.globals.entries()].map(([k, g]) => ({ name: `?${k}`, value: fmt(g.value) })),
      functions: [...this.functions.keys()],
    };
  }
}

// ---------- builtins ----------
type Builtin = (args: Value[], e: Engine, n: Node) => Value;
const nums = (args: Value[], e: Engine, n: Node) =>
  args.map((v) => {
    if (typeof v !== "number") throw new JessError("TypeError", `Not a number: ${fmt(v)}`, n.line, n.col);
    return v;
  });
const s = (v: Value) => fmt(v, false);
const flat = (args: Value[]) => args.flatMap((v) => (Array.isArray(v) ? v : [v]));
const list = (v: Value) => (Array.isArray(v) ? v : [v]);
let gensym = 0;

export const BUILTINS: Record<string, Builtin> = {
  "+": (a, e, n) => nums(a, e, n).reduce((x, y) => x + y, 0),
  "*": (a, e, n) => nums(a, e, n).reduce((x, y) => x * y, 1),
  "-": (a, e, n) => {
    const v = nums(a, e, n);
    return v.length === 1 ? -v[0]! : v.slice(1).reduce((x, y) => x - y, v[0]!);
  },
  "/": (a, e, n) => {
    const v = nums(a, e, n);
    return v.slice(1).reduce((x, y) => {
      if (y === 0) throw new JessError("ArithmeticError", "Division by zero", n.line, n.col);
      return x / y;
    }, v[0]!);
  },
  mod: (a, e, n) => {
    const [x, y] = nums(a, e, n);
    return x! % y!;
  },
  "**": (a, e, n) => {
    const [x, y] = nums(a, e, n);
    return x! ** y!;
  },
  max: (a, e, n) => Math.max(...nums(a, e, n)),
  min: (a, e, n) => Math.min(...nums(a, e, n)),
  abs: (a, e, n) => Math.abs(nums(a, e, n)[0]!),
  sqrt: (a, e, n) => Math.sqrt(nums(a, e, n)[0]!),
  exp: (a, e, n) => Math.exp(nums(a, e, n)[0]!),
  log: (a, e, n) => Math.log(nums(a, e, n)[0]!),
  round: (a, e, n) => Math.round(nums(a, e, n)[0]!),
  integer: (a, e, n) => Math.trunc(nums(a, e, n)[0]!),
  float: (a, e, n) => nums(a, e, n)[0]!,
  random: () => Math.floor(Math.random() * 65536),
  pi: () => Math.PI,
  time: () => Date.now() / 1000,
  "<": (a, e, n) => bool(nums(a, e, n).every((v, i, arr) => i === 0 || arr[i - 1]! < v)),
  ">": (a, e, n) => bool(nums(a, e, n).every((v, i, arr) => i === 0 || arr[i - 1]! > v)),
  "<=": (a, e, n) => bool(nums(a, e, n).every((v, i, arr) => i === 0 || arr[i - 1]! <= v)),
  ">=": (a, e, n) => bool(nums(a, e, n).every((v, i, arr) => i === 0 || arr[i - 1]! >= v)),
  "=": (a, e, n) => bool(nums(a, e, n).every((v, i, arr) => i === 0 || arr[0]! === v)),
  "<>": (a, e, n) => bool(nums(a, e, n).slice(1).every((v) => v !== a[0]!)),
  eq: (a) => bool(a.slice(1).every((v) => eqVal(a[0]!, v) && typeof v === typeof a[0])),
  neq: (a) => bool(a.slice(1).every((v) => !eqVal(a[0]!, v))),
  not: (a) => bool(!truthy(a[0]!)),
  numberp: (a) => bool(typeof a[0] === "number"),
  integerp: (a) => bool(typeof a[0] === "number" && Number.isInteger(a[0])),
  floatp: (a) => bool(typeof a[0] === "number" && !Number.isInteger(a[0])),
  stringp: (a) => bool(typeof a[0] === "string"),
  symbolp: (a) => bool(a[0] instanceof Sym),
  lexemep: (a) => bool(typeof a[0] === "string" || a[0] instanceof Sym),
  multifieldp: (a) => bool(Array.isArray(a[0])),
  evenp: (a) => bool(typeof a[0] === "number" && a[0] % 2 === 0),
  oddp: (a) => bool(typeof a[0] === "number" && Math.abs(a[0] % 2) === 1),
  "str-cat": (a) => a.map(s).join(""),
  "sym-cat": (a) => sym(a.map(s).join("")),
  "str-length": (a) => s(a[0]!).length,
  "str-index": (a) => {
    const i = s(a[1]!).indexOf(s(a[0]!));
    return i < 0 ? FALSE : i + 1;
  },
  "sub-string": (a) => s(a[2]!).substring((a[0] as number) - 1, a[1] as number),
  upcase: (a) => (a[0] instanceof Sym ? sym(a[0].name.toUpperCase()) : s(a[0]!).toUpperCase()),
  lowcase: (a) => (a[0] instanceof Sym ? sym(a[0].name.toLowerCase()) : s(a[0]!).toLowerCase()),
  "str-compare": (a) => Math.sign(s(a[0]!).localeCompare(s(a[1]!))),
  "create$": (a) => flat(a),
  "nth$": (a) => list(a[1]!)[(a[0] as number) - 1] ?? NIL,
  "length$": (a) => list(a[0]!).length,
  "first$": (a) => list(a[0]!).slice(0, 1),
  "rest$": (a) => list(a[0]!).slice(1),
  "member$": (a) => {
    const i = list(a[1]!).findIndex((v) => eqVal(v, a[0]!));
    return i < 0 ? FALSE : i + 1;
  },
  "subseq$": (a) => list(a[0]!).slice((a[1] as number) - 1, a[2] as number),
  "delete$": (a) => {
    const l = list(a[0]!).slice();
    l.splice((a[1] as number) - 1, (a[2] as number) - (a[1] as number) + 1);
    return l;
  },
  "insert$": (a) => {
    const l = list(a[0]!).slice();
    l.splice((a[1] as number) - 1, 0, ...flat(a.slice(2)));
    return l;
  },
  "implode$": (a) => fmt(list(a[0]!)),
  "explode$": (a) => parse(s(a[0]!)).map((n) => (n.k === "atom" ? n.v : NIL)),
  "gensym*": () => sym("gen" + ++gensym),
  "symbol-to-string": (a) => s(a[0]!),
  "string-to-symbol": (a) => sym(s(a[0]!)),
  "fact-id": (a) => (a[0] instanceof Fact ? a[0].id : NIL),
  "time-string": () => new Date().toISOString(),
};
