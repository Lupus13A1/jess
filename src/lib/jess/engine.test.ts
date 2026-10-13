import { describe, expect, it } from "vitest";
import { Engine } from "./engine";
import type { ConsoleEntry } from "./types";
import { EXAMPLES } from "./examples";

function make() {
  const out: ConsoleEntry[] = [];
  const e = new Engine({ out: (x) => out.push(x) });
  const text = () => out.filter((x) => x.kind === "stdout").map((x) => x.text).join("");
  return { e, out, text };
}

describe("jess engine", () => {
  it("reset returns TRUE and run returns number of rules fired", () => {
    const { e } = make();
    e.execute("(defrule a => (printout t 1 crlf))", { echo: false });
    expect(e.execute("(reset)", { echo: false }).last).toMatchObject({ name: "TRUE" });
    expect(e.execute("(run)", { echo: false }).last).toBe(1);
  });

  it("matches predicate constraints on template slots", () => {
    const { e, text } = make();
    e.execute(EXAMPLES[1].code, { echo: false });
    expect(text()).toContain("Alice is an adult.");
    expect(text()).toContain("Carol is an adult.");
    expect(text()).not.toContain("Bob is an adult.");
  });

  it("modify re-triggers rules and salience orders firing", () => {
    const { e, text } = make();
    e.execute(EXAMPLES[3].code, { echo: false });
    expect(text()).toContain("T-minus 1\nLiftoff!");
  });

  it("reports undefined functions with a line number", () => {
    const { e, out } = make();
    e.execute("(reset)\n(foo 1)", { echo: false });
    const err = out.find((x) => x.kind === "error");
    expect(err?.errorType).toBe("UndefinedFunction");
    expect(err?.line).toBe(2);
  });

  it("clear removes all rules and facts", () => {
    const { e } = make();
    e.execute("(defrule a => ) (reset) (clear)", { echo: false });
    expect(e.rules.size).toBe(0);
    expect(e.facts.size).toBe(0);
  });

  it("supports (import ...) and Java Swing object creation and method calls", () => {
    const { e, text } = make();
    const r1 = e.execute("(import javax.swing.*)", { echo: false });
    expect(r1.ok).toBe(true);
    expect(r1.last).toMatchObject({ name: "TRUE" });

    const r2 = e.execute('(bind ?f (new JFrame "Hello Window"))', { echo: false });
    expect(r2.ok).toBe(true);
    expect(String(r2.last)).toContain("javax.swing.JFrame");

    const r3 = e.execute("(?f setVisible TRUE)", { echo: false });
    expect(r3.ok).toBe(true);
    expect(text()).toContain("[Swing] javax.swing.JFrame \"Hello Window\" setVisible: TRUE");

    const r4 = e.execute("(call ?f setSize 500 400)", { echo: false });
    expect(r4.ok).toBe(true);

    const r5 = e.execute("(?f getTitle)", { echo: false });
    expect(r5.last).toBe("Hello Window");
  });

  it("supports Java collections and static calls", () => {
    const { e } = make();
    e.execute('(bind ?list (new ArrayList))', { echo: false });
    e.execute('(?list add "alpha")', { echo: false });
    e.execute('(?list add "beta")', { echo: false });
    const sz = e.execute("(?list size)", { echo: false });
    expect(sz.last).toBe(2);
    const item0 = e.execute("(?list get 0)", { echo: false });
    expect(item0.last).toBe("alpha");

    const math = e.execute("(call Math sqrt 64)", { echo: false });
    expect(math.last).toBe(8);

    const staticDot = e.execute("(Math.max 10 20)", { echo: false });
    expect(staticDot.last).toBe(20);
  });

  it("supports java.lang.Math constants and trigonometric static calls", () => {
    const { e } = make();
    e.execute("(import java.lang.Math)", { echo: false });

    const pi = e.execute("(get-member Math PI)", { echo: false });
    expect(pi.last).toBe(Math.PI);

    const sin = e.execute("(call Math sin (get-member Math PI))", { echo: false });
    const cos = e.execute("(call Math cos (get-member Math PI))", { echo: false });
    const tan = e.execute("(call Math tan (get-member Math PI))", { echo: false });
    expect(sin.last).toBeCloseTo(0);
    expect(cos.last).toBeCloseTo(-1);
    expect(tan.last).toBeCloseTo(0);
  });

  it("supports static JOptionPane constants in GUI calls", () => {
    const { e, text } = make();
    const result = e.execute(
      `(import javax.swing.*)
(call JOptionPane showMessageDialog nil "Displayed Text" "Input Mismatch" (get-member JOptionPane ERROR_MESSAGE))`,
      { echo: false },
    );

    expect(result.ok).toBe(true);
    expect(text()).toContain("[JOptionPane] Displayed Text");
  });

  it("emits browser GUI events for JOptionPane calls", () => {
    const events: { type: string; message: string; title?: string }[] = [];
    const e = new Engine({
      out: () => undefined,
      gui: (event) => events.push(event),
    });

    e.execute(
      `(import javax.swing.*)
(call JOptionPane showMessageDialog nil "Displayed Text" "Input Mismatch" (get-member JOptionPane ERROR_MESSAGE))
(call JOptionPane showInputDialog nil "Please enter a number" (get-member JOptionPane QUESTION_MESSAGE))`,
      { echo: false },
    );

    expect(events).toEqual([
      { type: "message", message: "Displayed Text", title: "Input Mismatch", messageType: 0 },
      { type: "input", message: "Please enter a number", messageType: 3 },
    ]);
  });

  it("runs the Swing GUI demo example successfully", () => {
    const { e, text } = make();
    const res = e.execute(EXAMPLES[7].code, { echo: false });
    expect(res.ok).toBe(true);
    expect(text()).toContain("Importing Swing packages...");
    expect(text()).toContain("[Swing] javax.swing.JFrame \"Jess Expert System GUI\" setVisible: TRUE");
    expect(text()).toContain("Button text: Start Inference");
  });
});
