import { api } from "../api.js";
import { timers } from "../app.js";
import { t } from "../i18n.js";
import { badge, frag, h, json, notAvailable, notice, pageHead, table, td, time } from "../ui.js";
import { eventList } from "./run.js";

// Runtime command line exit codes (docs/runtime-interface.md); the baseline collector uses 0 and non-zero only.
const RUNTIME_EXIT = { 0: "accepted", 1: "rejected", 2: "no verdict", 3: "inconclusive" };

export async function newRun() {
  const [system, defaults, jobs] = await Promise.all([api.system(), api.runDefaults(), api.jobs()]);
  const stamp = new Date().toISOString().replaceAll(/[-:]/g, "").slice(0, 15).replace("T", "-");
  const runId = h("input", { type: "text", value: `ui-${stamp}`, spellcheck: false });
  const backend = h("select", {}, system.backends.map((b) => h("option", { value: b.name, disabled: !b.available }, `${b.name} (${b.kind})${b.available ? "" : ` · ${t("not_yet_available")}`}`)));
  const timeout = h("input", { type: "number", min: "0.01", max: "3600", step: "any", placeholder: "300" });
  const customise = h("input", { type: "checkbox" });
  const config = h("textarea", { spellcheck: false, disabled: true }, JSON.stringify(defaults.config, null, 2));
  const task = h("select", {}, system.tasks.map((x) => h("option", { value: x.path }, `${x.fixture ? "[fixture] " : ""}${x.id}${x.title ? ` · ${x.title}` : ""}`)));
  const model = h("input", { type: "text", placeholder: t("model_placeholder"), spellcheck: false });
  const message = h("div", {});
  const planBox = h("div", {});
  const jobBox = h("div", {});
  const scriptFields = h("div", {});
  const runtimeFields = h("div", {});
  customise.addEventListener("change", () => { config.disabled = !customise.checked; });

  const selected = () => system.backends.find((b) => b.name === backend.value);
  const layout = () => {
    const isScript = backend.value === "baseline-script";
    scriptFields.hidden = !isScript;
    runtimeFields.hidden = isScript;
    planBox.replaceChildren();
  };
  backend.addEventListener("change", layout);

  const drawJob = (job) => {
    jobBox.replaceChildren(
      h("h2", {}, `${t("job")} ${job.id}`),
      h("div", { class: "panel" }, h("dl", { class: "kv" },
        h("dt", {}, t("state")), h("dd", {}, badge(job.state === "running" ? "running" : job.state === "exited" ? `exited ${job.exit_code}` : job.state, job.state === "running" ? "partial" : job.exit_code === 0 ? "pass" : job.state === "exited" ? "neutral" : "fail")),
        h("dt", {}, t("command")), h("dd", {}, h("code", { class: "wrap-any" }, job.command.join(" "))),
        h("dt", {}, t("started")), h("dd", {}, time(job.started_at)),
        h("dt", {}, t("run")), h("dd", {}, job.state === "running" ? h("span", { class: "muted" }, `runs/${job.run_id}`) : h("a", { href: `#/runs/${encodeURIComponent(job.run_id)}` }, `runs/${job.run_id} →`))),
        job.backend !== "baseline-script" && job.state === "exited" ? h("p", {}, `${t("runtime_exit_means")}: `, badge(RUNTIME_EXIT[job.exit_code] ?? "unknown", job.exit_code === 2 ? "none" : "")) : null,
        (job.events ?? []).length > 0 ? frag(h("h3", {}, t("event_log")), h("p", { class: "hint" }, t("event_log_hint")), eventList(job.events)) : null,
        h("h3", {}, t("process_output")), h("pre", { class: "wrap" }, job.log || t("no_output_yet")),
        job.state === "exited" && job.exit_code !== 0 ? h("p", { class: "hint" }, t("nonzero_hint")) : null));
  };
  const follow = (job) => {
    drawJob(job);
    const timer = setInterval(async () => {
      const next = await api.job(job.id).catch(() => null);
      if (!next) return;
      drawJob(next);
      if (next.state !== "running") { clearInterval(timer); timers.delete(timer); }
    }, 1000);
    timers.add(timer);
  };

  const start = async () => {
    message.replaceChildren();
    const body = { run_id: runId.value.trim(), backend: backend.value };
    try {
      if (backend.value === "baseline-script") {
        if (timeout.value !== "") body.timeout_seconds = Number(timeout.value);
        if (customise.checked) body.config = JSON.parse(config.value);
      } else {
        body.task = task.value;
        if (model.value.trim() !== "") body.model = model.value.trim();
      }
      follow(await api.startRun(body));
    } catch (error) {
      message.replaceChildren(notice("bad", t("could_not_start"), error.message));
    }
  };
  const preview = async () => {
    planBox.replaceChildren(h("div", { class: "loading" }, t("loading")));
    const result = await api.compile({ task: task.value, backend: backend.value }).catch((error) => ({ ok: false, error: error.message }));
    planBox.replaceChildren(result.ok ? frag(h("h3", {}, t("compiled_plan")), json(result.plan)) : notice("bad", t("no_plan"), h("pre", { class: "wrap" }, result.error)));
  };

  const running = jobs.find((j) => j.state === "running");
  if (running) follow(running);
  layout();
  const agent = () => selected()?.kind === "agent";
  const cost = h("div", {});
  const drawCost = () => cost.replaceChildren(agent() ? notice("warn", t("agent_cost_title"), t("agent_cost_body")) : "");
  backend.addEventListener("change", drawCost);
  drawCost();

  scriptFields.append(
    h("label", { class: "field" }, h("span", {}, t("timeout_seconds")), timeout, h("span", { class: "hint" }, t("timeout_hint"))),
    h("label", { class: "row" }, customise, t("customise_config")),
    h("div", { class: "spacer" }), config,
    h("p", { class: "hint" }, t("config_hint")));
  runtimeFields.append(
    system.tasks.length === 0 ? notAvailable(t("tasks"), t("tasks_missing")) : h("label", { class: "field" }, h("span", {}, t("task")), task),
    h("label", { class: "field" }, h("span", {}, t("model")), model, h("span", { class: "hint" }, t("model_hint"))),
    h("button", { class: "btn", onclick: preview }, t("preview_plan")), h("span", { class: "hint" }, ` ${t("preview_plan_hint")}`));

  return frag(
    pageHead(t("new_title"), t("new_sub")),
    system.repository.dirty ? notice("warn", t("dirty_title"), t("dirty_body")) : null,
    system.backends.some((b) => b.kind === "agent") ? null : notAvailable(t("component_agent-backends"), t("agent_missing")),
    h("div", { class: "grid cols-2" },
      h("div", { class: "panel" },
        h("label", { class: "field" }, h("span", {}, t("backend")), backend, h("span", { class: "hint" }, selected()?.note ?? "")),
        h("label", { class: "field" }, h("span", {}, t("run_id")), runId, h("span", { class: "hint" }, t("run_id_hint"))),
        cost,
        h("button", { class: "btn primary", onclick: start }, t("start_run")),
        h("div", { class: "spacer" }), message),
      h("div", { class: "panel" }, scriptFields, runtimeFields, planBox)),
    jobBox,
    h("h2", {}, t("jobs_this_session")),
    table([t("job"), t("run"), t("backend"), t("state"), t("started")], jobs.map((j) => h("tr", {},
      td(h("code", {}, j.id)), td(h("a", { href: `#/runs/${encodeURIComponent(j.run_id)}` }, j.run_id)), td(h("code", {}, j.backend)),
      td(badge(j.state === "exited" ? `exited ${j.exit_code}` : j.state, j.state === "running" ? "partial" : j.exit_code === 0 ? "pass" : "fail")), td(time(j.started_at)))),
      { empty: t("no_jobs") }),
    h("p", { class: "hint" }, t("jobs_hint")),
  );
}
