import { api } from "../api.js";
import { timers } from "../app.js";
import { t } from "../i18n.js";
import { badge, empty, frag, h, icon, json, kv, notAvailable, notice, pageHead, section, table, tag, td, time } from "../ui.js";
import { eventList } from "./run.js";

// Runtime command line exit codes (docs/runtime-interface.md); the baseline collector uses 0 and non-zero only.
const RUNTIME_EXIT = { 0: "accepted", 1: "rejected", 2: "no verdict", 3: "inconclusive" };

/** A set of cards of which one is chosen. Returns the element and a getter. */
function choiceCards(items, initial, onChange) {
  let value = initial;
  const el = h("div", { class: "choices", role: "radiogroup" });
  const draw = () => el.replaceChildren(...items.map((item) => h("button", {
    type: "button", class: `choice ${item.value === value ? "active" : ""}`, role: "radio", "aria-checked": String(item.value === value), disabled: item.disabled,
    onclick: () => { value = item.value; draw(); onChange(value); },
  }, h("span", { class: "tick" }, icon("check", 12)), h("span", { class: "name" }, item.name, item.side ?? null), item.desc ? h("span", { class: "desc" }, item.desc) : null)));
  draw();
  return { el, get: () => value };
}

export async function newRun() {
  const [system, defaults, jobs] = await Promise.all([api.system(), api.runDefaults(), api.jobs()]);
  const stamp = new Date().toISOString().replaceAll(/[-:]/g, "").slice(0, 15).replace("T", "-");
  const runId = h("input", { type: "text", value: `ui-${stamp}`, spellcheck: false, class: "mono" });
  const timeout = h("input", { type: "number", min: "0.01", max: "3600", step: "any", placeholder: "300" });
  const customise = h("input", { type: "checkbox" });
  const config = h("textarea", { spellcheck: false, disabled: true }, JSON.stringify(defaults.config, null, 2));
  const model = h("input", { type: "text", placeholder: t("model_placeholder"), spellcheck: false });
  const message = h("div", {});
  const planBox = h("div", {});
  const jobBox = h("div", {});
  const scriptFields = h("div", {});
  const runtimeFields = h("div", {});
  const cost = h("div", {});
  customise.addEventListener("change", () => { config.disabled = !customise.checked; });

  const firstBackend = (system.backends.find((b) => b.available) ?? system.backends[0])?.name;
  const selected = () => system.backends.find((b) => b.name === backend.get());
  const layout = () => {
    const isScript = backend.get() === "baseline-script";
    scriptFields.hidden = !isScript;
    runtimeFields.hidden = isScript;
    planBox.replaceChildren();
    cost.replaceChildren(selected()?.kind === "agent" ? notice("warn", t("agent_cost_title"), t("agent_cost_body")) : "");
  };
  const backend = choiceCards(system.backends.map((b) => ({
    value: b.name, name: b.name, disabled: !b.available, side: tag(b.kind),
    desc: b.available ? (b.note ?? "") : `${t("not_yet_available")}${b.note ? ` · ${b.note}` : ""}`,
  })), firstBackend, () => layout());
  const task = choiceCards(system.tasks.map((x) => ({
    value: x.path, name: x.id, side: x.fixture ? badge("fixture") : null, desc: x.title ?? x.path,
  })), system.tasks[0]?.path, () => planBox.replaceChildren());

  const jobsBox = h("div", {});
  const drawJobs = (list) => jobsBox.replaceChildren(
      table([t("job"), t("run"), t("backend"), t("state"), t("started")], list.map((j) => h("tr", {},
        td(h("code", {}, j.id)), td(h("a", { class: "primary-cell", href: `#/runs/${encodeURIComponent(j.run_id)}` }, j.run_id)), td(h("code", {}, j.backend)),
        td(badge(jobState(j), jobTone(j))), td(time(j.started_at)))),
        { empty: empty(null, t("no_jobs"), null, { compact: true }) }));
  const refreshJobs = () => api.jobs().then(drawJobs, () => {});
  let startedAt = 0;
  const jobState = (job) => (job.state === "running" && job.cancel_requested_at ? "stopping" : job.state === "exited" ? `exited ${job.exit_code}` : job.state);
  const jobTone = (job) => (job.state === "running" ? "partial running" : job.state === "cancelled" ? "neutral" : job.exit_code === 0 ? "pass" : job.state === "exited" ? "neutral" : "fail");
  const drawJob = (job) => {
    const running = job.state === "running";
    const cancel = running ? h("button", { class: "btn danger", disabled: Boolean(job.cancel_requested_at), onclick: async () => {
      cancel.disabled = true;
      try { drawJob(await api.cancelJob(job.id)); } catch (error) { cancel.disabled = false; message.replaceChildren(notice("bad", t("could_not_cancel"), error.message)); }
    } }, icon("x", 13), job.cancel_requested_at ? t("stopping") : t("cancel_run")) : null;
    const seconds = Math.max(0, Math.round(((running ? Date.now() : Date.parse(job.finished_at ?? "") || Date.now()) - Date.parse(job.started_at)) / 1000));
    jobBox.replaceChildren(section(`${t("job")} ${job.id}`, null, h("div", { class: "panel stack" },
      h("div", { class: "job-head" },
        badge(jobState(job), jobTone(job)),
        h("span", { class: "big" }, `runs/${job.run_id}`),
        running ? h("span", { class: "hint row" }, h("span", { class: "spinner" }), `${seconds} s ${t("elapsed")}`) : null,
        job.backend !== "baseline-script" && job.state === "exited" ? h("span", { class: "row hint" }, `${t("runtime_exit_means")}: `, badge(RUNTIME_EXIT[job.exit_code] ?? "unknown", job.exit_code === 2 ? "none" : "")) : null,
        h("span", { class: "grow" }),
        cancel,
        running ? null : h("a", { class: "btn primary", href: `#/runs/${encodeURIComponent(job.run_id)}` }, t("open_run"), icon("arrow", 14))),
      running ? h("div", { class: "progress" }, h("i")) : null,
      kv([[t("command"), h("code", { class: "wrap-any" }, job.command.join(" "))], [t("started"), time(job.started_at)]]),
      (job.events ?? []).length > 0 ? h("div", {}, h("h3", {}, t("event_log")), h("p", { class: "hint" }, t("event_log_hint")), eventList(job.events)) : null,
      h("div", {}, h("h3", {}, t("process_output")), h("div", { class: "spacer" }), h("pre", { class: "wrap term" }, job.log || t("no_output_yet"))),
      job.cancel_requested_at ? h("p", { class: "hint" }, t("cancel_hint")) : null,
      job.state === "exited" && job.exit_code !== 0 ? h("p", { class: "hint" }, t("nonzero_hint")) : null)));
  };
  const follow = (job) => {
    drawJob(job);
    if (Date.now() - startedAt < 2000) jobBox.scrollIntoView({ behavior: "smooth", block: "start" });
    const timer = setInterval(async () => {
      const next = await api.job(job.id).catch(() => null);
      if (!next) return;
      drawJob(next);
      if (next.state !== "running") { clearInterval(timer); timers.delete(timer); startButton.disabled = false; refreshJobs(); }
    }, 1000);
    timers.add(timer);
  };

  const start = async () => {
    message.replaceChildren();
    const body = { run_id: runId.value.trim(), backend: backend.get() };
    startButton.disabled = true;
    try {
      if (backend.get() === "baseline-script") {
        if (timeout.value !== "") body.timeout_seconds = Number(timeout.value);
        if (customise.checked) body.config = JSON.parse(config.value);
      } else {
        body.task = task.get();
        if (model.value.trim() !== "") body.model = model.value.trim();
      }
      startedAt = Date.now();
      follow(await api.startRun(body));
      refreshJobs();
    } catch (error) {
      startButton.disabled = false;
      message.replaceChildren(h("div", { class: "spacer" }), notice("bad", t("could_not_start"), error.message));
    }
  };
  const startButton = h("button", { class: "btn primary large", onclick: start }, icon("new", 13), t("start_run"));
  const preview = async () => {
    planBox.replaceChildren(h("div", { class: "loading" }, h("span", { class: "spinner" }), t("loading")));
    const result = await api.compile({ task: task.get(), backend: backend.get() }).catch((error) => ({ ok: false, error: error.message }));
    planBox.replaceChildren(h("div", { class: "spacer" }), result.ok ? h("details", { open: true }, h("summary", {}, t("compiled_plan")), json(result.plan)) : notice("bad", t("no_plan"), h("pre", { class: "wrap" }, result.error)));
  };

  drawJobs(jobs);
  const running = jobs.find((j) => j.state === "running");
  if (running) { startButton.disabled = true; follow(running); }

  scriptFields.append(h("div", { class: "panel" },
    h("label", { class: "field" }, h("span", {}, t("timeout_seconds")), timeout, h("span", { class: "hint" }, t("timeout_hint"))),
    h("label", { class: "row" }, customise, t("customise_config")),
    h("div", { class: "spacer" }), config,
    h("p", { class: "hint" }, t("config_hint"))));
  runtimeFields.append(
    system.tasks.length === 0 ? notAvailable(t("tasks"), t("tasks_missing")) : task.el,
    h("div", { class: "spacer" }),
    h("div", { class: "panel" },
      h("label", { class: "field" }, h("span", {}, t("model")), model, h("span", { class: "hint" }, t("model_hint"))),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: preview }, icon("contracts", 14), t("preview_plan")), h("span", { class: "hint" }, t("preview_plan_hint"))),
      planBox));
  layout();

  const step = (n, title, ...body) => h("div", { class: "step" }, h("div", { class: "n" }, n), h("div", { class: "grow" }, h("h2", {}, title), body));
  return frag(
    pageHead(t("new_title"), t("new_sub")),
    system.repository.dirty ? notice("warn", t("dirty_title"), t("dirty_body")) : null,
    system.backends.some((b) => b.kind === "agent") ? null : notAvailable(t("component_agent-backends"), t("agent_missing")),
    step(1, t("step_backend"), backend.el, h("div", { class: "spacer" }), cost),
    step(2, t("step_task"), scriptFields, runtimeFields),
    step(3, t("step_start"), h("div", { class: "panel" },
      h("label", { class: "field" }, h("span", {}, t("run_id")), runId, h("span", { class: "hint" }, t("run_id_hint"))),
      startButton, message)),
    jobBox,
    section(t("jobs_this_session"), t("jobs_hint"), jobsBox),
  );
}
