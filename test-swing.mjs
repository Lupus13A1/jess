import { Engine } from "./src/lib/jess/engine.ts";

const e = new Engine({
  out: (entry) => console.log(`[${entry.kind}]`, entry.text),
});

console.log("=== Testing (import javax.swing.*) ===");
e.execute("(import javax.swing.*)", { echo: true });

console.log("\n=== Testing (bind ?f (new JFrame \"My App\")) ===");
e.execute('(bind ?f (new JFrame "My App"))', { echo: true });

console.log("\n=== Testing (?f setVisible TRUE) ===");
e.execute("(?f setVisible TRUE)", { echo: true });

console.log("\n=== Testing (call ?f getTitle) ===");
e.execute("(call ?f getTitle)", { echo: true });

