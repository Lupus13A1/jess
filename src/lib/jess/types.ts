export class Sym {
  constructor(public readonly name: string) {}
}
const symTable = new Map<string, Sym>();
export function sym(name: string): Sym {
  let s = symTable.get(name);
  if (!s) {
    s = new Sym(name);
    symTable.set(name, s);
  }
  return s;
}
export const TRUE = sym("TRUE");
export const FALSE = sym("FALSE");
export const NIL = sym("nil");

export class Fact {
  constructor(
    public id: number,
    public template: Template,
    public slots: Map<string, Value>,
    public stamp: number,
  ) {}
}

export class JavaObject {
  constructor(
    public className: string,
    public properties: Map<string, Value> = new Map(),
    public state: JavaState = {},
  ) {}

  toString(): string {
    const title = this.properties.get("title") ?? this.properties.get("text");
    if (title !== undefined && title !== null) {
      const t = typeof title === "object" && "name" in title ? (title as any).name : String(title);
      return `<Java-Object:${this.className}:${t}>`;
    }

    return `<Java-Object:${this.className}>`;
  }
}

export interface JavaState {
  visible?: boolean;
  width?: Value;
  height?: Value;
  children?: Value[];
  list?: Value[];
  map?: Map<string, Value>;
  date?: Date;
  constructorArgs?: Value[];
  calls?: { method: string; args: Value[] }[];
}

export type Value = number | string | Sym | Value[] | Fact | JavaObject;

export interface SlotDef {
  name: string;
  multi: boolean;
  default: Value;
}
export interface Template {
  name: string;
  ordered: boolean;
  slots: SlotDef[];
  doc?: string;
}

export type ConsoleKind = "stdout" | "prompt" | "result" | "info" | "warn" | "error" | "watch";
export interface ConsoleEntry {
  kind: ConsoleKind;
  text: string;
  errorType?: string;
  line?: number;
  col?: number;
  file?: string;
  context?: string;
}

export class JessError extends Error {
  constructor(
    public errorType: string,
    message: string,
    public line?: number,
    public col?: number,
  ) {
    super(message);
  }
}

export interface Snapshot {
  facts: { id: number; text: string }[];
  rules: { name: string; salience: number; doc?: string }[];
  agenda: { rule: string; facts: string; salience: number }[];
  templates: { name: string; slots: string[] }[];
  globals: { name: string; value: string }[];
  functions: string[];
}

export type EngineStatus = "ready" | "running" | "completed" | "error" | "stopped";
