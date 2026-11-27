// A stand-in for the Claude Code CLI, used only to test the adapter's own
// logic (argument passing, stream parsing, fail-closed outcomes, timeouts).
// It is not a model and results obtained with it say nothing about any model.
import { cpSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv.find((a) => a.startsWith("--mode="))?.slice(7) ?? "ok";
const producer = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/producers/coin-flips");
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");

let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;

emit({ type: "system", subtype: "init", model: "fake-model-not-a-model", claude_code_version: "0.0.0-fake" });
if (mode === "hang") await new Promise((resolve) => setTimeout(resolve, 60_000));
if (mode === "exit-nonzero") process.exit(7);
if (mode === "no-result") process.exit(0);
if (mode === "error-result") {
  emit({ type: "result", subtype: "error_max_budget_usd", is_error: true, result: "budget exceeded", total_cost_usd: 0, num_turns: 1 });
  process.exit(0);
}
emit({ type: "assistant", message: { content: [{ type: "text", text: `prompt had ${prompt.length} characters` }, { type: "tool_use", name: "Write", input: { file_path: "experiment.py" } }] } });
process.stdout.write("this line is not JSON\n");
for (const name of readdirSync(producer)) cpSync(join(producer, name), join(process.cwd(), name), { recursive: true });
emit({
  type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: 0.0123, num_turns: 3, duration_api_ms: 10,
  terminal_reason: "completed", permission_denials: [], modelUsage: { "fake-model-not-a-model": {} },
});
