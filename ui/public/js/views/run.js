import { api } from "../api.js";
import { t } from "../i18n.js";
import { markdown } from "../md.js";
import { setCrumbs } from "../app.js";
import { badge, bytes, dataClass, empty, fact, frag, h, icon, json, kv, notAvailable, notice, num, pageHead, revision, section, segmented, sha, show, statusIcon, table, tabs, tag, td, time } from "../ui.js";

// ------------------------------------------------------------------ verdict

function requirementList(record, extra) {
  let onlyOpen = false;
  const list = h("div", { class: "reqs" });
  const draw = () => {
    const rows = record.results.filter((r) => !onlyOpen || r.status !== "pass");
    list.replaceChildren(...(rows.length === 0 ? [empty(null, t("all_passed"), null, { icon: "check", compact: true })] : rows.map((r) => {
      const rationale = extra.get(r.requirement)?.rationale;
      return h("details", { class: `req ${r.status} ${r.level === "mandatory" && r.status !== "pass" ? "blocking" : ""}`, id: `req-${r.requirement}`, open: r.status !== "pass" && r.level === "mandatory" },
        h("summary", {},
          h("span", { class: "state", title: r.status }, statusIcon(r.status)),
          h("span", { class: "id" }, r.requirement),
          h("span", {}, r.title),
          h("span", { class: "chips" }, tag(r.level), tag(r.verifiability), badge(r.status)),
          h("span", { class: "chev" }, icon("chevron", 15))),
        h("div", { class: "more" },
          h("div", {}, h("div", { class: "label" }, t("verifier_detail")), r.detail ? h("div", { class: "detail" }, r.detail) : h("div", { class: "hint" }, t("no_detail"))),
          rationale ? h("div", {}, h("div", { class: "label" }, t("rationale")), h("div", { class: "muted" }, rationale)) : null,
          h("div", { class: "row" }, h("span", { class: "label" }, t("check")), h("code", {}, r.kind))));
    })));
  };
  draw();
  const open = record.results.filter((r) => r.status !== "pass").length;
  return section(t("requirement_results"), record.results.some((r) => r.level === "advisory") ? t("advisory_note") : null, list,
    segmented([["all", t("filter_all"), record.results.length], ["open", t("filter_not_passed"), open]], "all", (v) => { onlyOpen = v === "open"; draw(); }));
}

function verdictPanel(run, outcome, reverify) {
  if (!outcome.issued) {
    return frag(
      h("div", { class: "verdict-hero none" },
        h("div", { class: "top" }, h("div", { class: "seal" }, icon("none", 28)),
          h("div", {}, h("div", { class: "word" }, t("no_verdict_issued")), h("div", { class: "means wrap-any" }, outcome.no_verdict)), h("div", {})),
        h("div", { class: "foot" }, h("button", { class: "btn", onclick: () => reverify({}) }, icon("refresh", 14), t("verify_again")))),
      h("div", { class: "spacer" }),
      notice("info", t("no_verdict_title"), t("no_verdict_body")));
  }
  const { record, requirements } = outcome;
  const extra = new Map(requirements.map((r) => [r.id, r]));
  const blocking = record.results.filter((r) => r.level === "mandatory" && r.status !== "pass");

  const contractOf = () => (picker ? Object.fromEntries(picker.value.split("@").map((v, i) => [i === 0 ? "contract" : "version", v])) : { contract: record.contract.id, version: record.contract.version });
  const picker = run.contracts.length > 1 ? h("select", { "aria-label": t("contract"), onchange: () => act(again, contractOf()) },
    run.contracts.map((c) => h("option", { value: `${c.id}@${c.version}`, selected: c.id === record.contract.id && c.version === record.contract.version }, `${c.id} ${c.version}`))) : null;
  const task = run.reproduction_tasks[0]?.path;
  const repoFlag = run.summary.runtime ? `${run.summary.path}/workspace` : ".";
  const busy = h("span", { class: "hint row" });
  const progress = h("div", { class: "progress", hidden: true }, h("i"));
  // One request at a time: the controls are disabled and the bar runs until the verifier answers.
  const act = async (button, body, label) => {
    for (const control of [again, reproduce, picker]) if (control) control.disabled = true;
    progress.hidden = false;
    busy.replaceChildren(h("span", { class: "spinner" }), label ?? t("checking"));
    await reverify(body);
  };
  const again = h("button", { class: "btn", onclick: () => act(again, contractOf()) }, icon("refresh", 14), t("verify_again"));
  const reproduce = task ? h("button", { class: "btn primary", onclick: () => act(reproduce, { ...contractOf(), reproduce_task: task }, t("reexecuting")) }, icon("new", 12), t("verify_reexecute")) : null;
  const flags = record.reproduction?.requested ? ` --reproduce --task ${task ?? "<task>"}` : "";
  const required = record.capabilities?.required ?? [];
  const established = new Set(record.capabilities?.established ?? []);
  const jump = (id) => (event) => {
    event.preventDefault();
    const target = document.getElementById(`req-${id}`);
    if (target) { target.open = true; target.scrollIntoView({ behavior: "smooth", block: "center" }); }
  };

  return frag(
    h("div", { class: `verdict-hero ${record.verdict}` },
      h("div", { class: "top" },
        h("div", { class: "seal" }, icon(record.verdict, 28)),
        h("div", {}, h("div", { class: "word" }, record.verdict), h("div", { class: "means" }, t(`verdict_means_${record.verdict}`))),
        h("div", { class: "score" }, h("div", { class: "n" }, record.summary.passed, h("small", {}, ` / ${record.summary.mandatory}`)), h("div", { class: "hint" }, t("mandatory_passed_l")))),
      progress,
      h("div", { class: "body" },
        h("div", { class: "strip" }, record.results.map((r) => h("a", { href: `#req-${r.requirement}`, class: `${r.status} ${r.level} ${r.level === "mandatory" && r.status !== "pass" ? "blocking" : ""}`, title: `${r.requirement} · ${r.status} · ${r.title}`, onclick: jump(r.requirement) }, r.requirement))),
        h("div", { class: "statement" }, record.statement)),
      h("div", { class: "foot" }, picker, again, reproduce, busy,
        h("span", { class: "hint" }, `${t("issued_at")} `, time(record.issued_at)))),
    task ? null : h("p", { class: "hint" }, t("no_reproduction_task")),

    blocking.length > 0 ? frag(h("div", { class: "spacer" }), notice(record.verdict === "rejected" ? "bad" : "warn", t("why_not_accepted"),
      h("ul", {}, blocking.map((r) => h("li", {}, h("a", { href: `#req-${r.requirement}`, onclick: jump(r.requirement) }, h("code", {}, r.requirement)), " ", badge(r.status), " ", r.title, r.detail ? h("div", { class: "mono wrap-any" }, r.detail) : null))))) : null,

    requirementList(record, extra),

    section(t("verdict_binding"), null, h("div", { class: "panel" },
      kv([
        [t("contract"), frag(h("a", { href: `#/contracts/${encodeURIComponent(record.contract.id)}/${encodeURIComponent(record.contract.version)}` }, `${record.contract.id} ${record.contract.version}`), " · ", h("code", {}, record.contract.path))],
        [t("contract_digest"), frag(sha(record.contract.sha256, true), " ", record.contract.registered ? badge("matches registry", "pass") : badge("not registered", "fail"))],
        [t("registry_digest"), sha(record.contract.registry_sha256, true)],
        [t("artifact_digest"), record.artifact.sha256 ? sha(record.artifact.sha256, true) : badge("missing", "fail")],
        [t("verifier_revision"), frag(sha(record.verifier.revision, true), record.verifier.dirty ? frag(" ", h("span", { class: "badge warn plain" }, "dirty")) : null)],
        [t("reproduction"), record.reproduction?.requested ? frag(t("reproduction_requested"), " · task sha256 ", sha(record.reproduction.task_sha256)) : t("reproduction_not_requested")],
        [t("exit_code_equiv"), h("code", {}, String(outcome.exit_code))],
        [t("record_schema"), h("code", {}, record.record_schema ?? "—")],
        [t("cli_equivalent"), h("code", { class: "wrap-any" }, `node src/cli.ts verify ${run.summary.path} --contract ${record.contract.path} --repo ${repoFlag}${flags}`)],
      ]),
      record.verifier.dirty ? frag(h("div", { class: "spacer" }), notice("warn", t("verifier_dirty_title"), t("verifier_dirty_body"))) : null)),

    required.length > 0 ? section(t("capabilities_title"), null,
      notice("warn", t("capabilities_note_title"), t("capabilities_note_body"),
        h("div", { class: "row" }, required.map((c) => h("span", { class: "row" }, h("code", {}, c), established.has(c) ? badge("established", "pass") : badge("not established", "neutral")))))) : null,
  );
}

// ------------------------------------------------------- evidence and claims

const CHECK_SCOPE = {
  "output-integrity": ["outputs"], "metric-traceability": ["metrics"], "finding-references": ["findings"], "human-review": ["findings", "limitations"],
  "execution-succeeded": ["execution"], "source-pinned": ["source"], "numeric-reproduction": ["metrics", "outputs"],
};

function records(artifact) {
  const out = [];
  const push = (label, section, value) => out.push({ label, section, value, provenance: value && typeof value === "object" && !Array.isArray(value) ? value.provenance : undefined });
  for (const [key, value] of Object.entries(artifact)) {
    if (["ir_version", "artifact_type", "volatile_fields"].includes(key)) continue;
    if (Array.isArray(value) && value.length > 0 && value.every((entry) => entry && typeof entry === "object")) {
      value.forEach((entry, index) => push(`${key}[${index}]`, key, entry));
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      const { producer_claims: claims, ...rest } = value;
      push(key, key, rest);
      if (claims) push(`${key}.producer_claims`, key, claims);
    } else {
      push(key, key, value);
    }
  }
  return out;
}

function recordCard(record, touching) {
  const { provenance: _omit, ...fields } = record.value && typeof record.value === "object" && !Array.isArray(record.value) ? record.value : { value: record.value };
  return h("div", { class: "record" },
    h("div", { class: "rh" }, h("b", {}, record.label), record.provenance ? badge(record.provenance) : h("span", { class: "badge none plain" }, t("undeclared"))),
    kv(Object.entries(fields).map(([k, v]) => [k, typeof v === "object" && v !== null ? h("code", { class: "wrap-any" }, JSON.stringify(v)) : h("span", { class: /sha256|revision/.test(k) ? "mono" : "" }, show(v))])),
    touching.length > 0 ? h("div", { class: "checkline" }, `${t("checked_by")}: `, touching.map((r) => h("span", { class: `badge ${r.status}` }, r.requirement))) : h("div", { class: "checkline" }, t("checked_by_nothing")));
}

function evidencePanel(run, outcome) {
  const artifact = run.artifact;
  if (!artifact) return notice("bad", t("artifact_unreadable"), run.artifact_error);
  const results = outcome.issued ? outcome.record.results : [];
  const params = new Map((outcome.issued ? outcome.requirements : []).map((r) => [r.id, r.check?.params]));
  const touching = (section) => results.filter((r) => (CHECK_SCOPE[r.kind] ?? []).includes(section)
    || (r.kind === "collector-provenance" && (params.get(r.requirement)?.sections ?? []).includes(section)));
  const all = records(artifact);
  const evidence = all.filter((r) => r.provenance === "collector");
  const claims = all.filter((r) => r.provenance !== "collector");
  const lane = (cls, title, sub, list) => h("section", { class: `lane ${cls}` },
    h("header", {}, h("div", { class: "glyph" }, icon(cls === "evidence" ? "shield" : "pen", 16)), h("div", {}, h("h3", {}, title), h("div", { class: "hint" }, sub)), h("div", { class: "count" }, list.length)),
    // A nested claims block is not what a section-level check reads, so it is not credited with that check.
    list.length === 0 ? empty(null, t("nothing_here"), null, { compact: true }) : list.map((r) => recordCard(r, r.label.includes(".") ? [] : touching(r.section))));
  return frag(
    notice("warn", t("declared_provenance_title"), t("declared_provenance_body")),
    h("div", { class: "lanes" },
      lane("evidence", t("lane_evidence"), t("lane_evidence_sub"), evidence),
      lane("claims", t("lane_claims"), t("lane_claims_sub"), claims)),
    Array.isArray(artifact.volatile_fields) && artifact.volatile_fields.length > 0
      ? frag(h("h3", {}, t("volatile_fields")), h("p", { class: "hint" }, t("volatile_hint")), h("div", {}, artifact.volatile_fields.map((p) => frag(h("code", {}, p), " "))))
      : null,
  );
}

// ------------------------------------------------------------------ outputs

function outputsPanel(run) {
  if (run.summary.origin === "fixture") return notice("na", t("fixture_no_files"), t("fixture_no_files_body"));
  const preview = h("div", {});
  const open = async (file) => {
    const url = api.fileUrl(run.summary.id, file.path);
    const head = h("h3", {}, h("code", {}, file.path), " ", h("a", { href: url, target: "_blank", rel: "noopener", class: "hint" }, t("open_raw")));
    if (/\.(png|jpe?g)$/i.test(file.path)) preview.replaceChildren(head, h("img", { class: "figure-preview", src: url, alt: file.path }));
    else if ((file.bytes ?? 0) > 512 * 1024) preview.replaceChildren(head, h("p", { class: "hint" }, t("too_large")));
    else {
      const text = await api.fileText(run.summary.id, file.path);
      preview.replaceChildren(head, file.path.endsWith(".md") ? h("div", { class: "panel" }, markdown(text)) : h("pre", {}, text));
    }
  };
  const state = (file) => {
    if (file.path === "artifact.json") return h("span", { class: "badge none plain" }, "artifact record");
    if (file.path.startsWith("tenric/")) return h("span", { class: "badge runtime plain" }, "runtime record");
    if (file.path.startsWith("workspace/")) return h("span", { class: "badge producer plain" }, "workspace");
    if (!file.listed) return h("span", { class: "badge none plain", title: t("unlisted_hint") }, t("unlisted"));
    if (!file.present) return badge("missing", "fail");
    if (file.escapes) return badge("escapes run dir", "fail");
    return badge(file.matches ? "match" : "mismatch");
  };
  const figures = run.files.filter((f) => f.present && !f.escapes && /\.(png|jpe?g)$/i.test(f.path));
  return frag(
    h("p", { class: "hint" }, t("outputs_hint")),
    table([t("file"), t("role"), t("determinism"), t("declared_provenance"), `${t("size")}#`, t("recorded_sha"), t("disk_sha"), t("integrity")],
      run.files.map((file) => h("tr", { class: file.present && !file.escapes ? "clickable" : "", onclick: () => file.present && !file.escapes && open(file) },
        td(h("code", {}, file.path)),
        td(file.recorded?.role ? tag(file.recorded.role) : "—"),
        td(file.recorded?.determinism ? tag(file.recorded.determinism) : "—"),
        td(file.recorded?.provenance ? badge(file.recorded.provenance) : "—"),
        td(bytes(file.bytes), "num"),
        td(sha(file.recorded?.sha256)),
        td(sha(file.sha256)),
        td(state(file))))),
    h("div", { class: "spacer" }),
    preview,
    figures.length > 0 ? frag(h("h3", {}, t("figures")), figures.map((f) => h("figure", {}, h("img", { class: "figure-preview", src: api.fileUrl(run.summary.id, f.path), alt: f.path, loading: "lazy" }), h("figcaption", { class: "hint" }, f.path)))) : null,
  );
}

// ------------------------------------------------------------------ runtime

export function eventList(events) {
  return h("ul", { class: "timeline" }, events.map((e) => {
    const { ts, type, source, seq: _seq, ...rest } = e;
    return h("li", {}, h("span", { class: "muted mono", title: ts ?? "" }, /T(\d\d:\d\d:\d\d(?:\.\d+)?)/.exec(ts ?? "")?.[1] ?? ts ?? ""), h("span", {}, badge(source ?? "unknown", "plain")), h("div", {}, h("code", {}, type ?? ""), Object.keys(rest).length > 0 ? h("div", { class: "hint mono wrap-any" }, JSON.stringify(rest)) : null));
  }));
}

function runtimePanel(run) {
  const { runtime, events } = run;
  if (!runtime.run && !runtime.plan && !events.available) return notAvailable(t("runtime_records"), t("runtime_records_missing"));
  const r = runtime.run;
  const plan = runtime.plan;
  return frag(
    r ? frag(h("h2", { class: "sub" }, t("runtime_summary")), h("div", { class: "panel" }, kv([
      [t("lifecycle_status"), frag(badge(r.status ?? "unknown", "plain"), r.status_detail ? ` ${r.status_detail}` : "")],
      [t("task"), r.task ? frag(h("code", {}, r.task.id), " ", r.task.title ?? "") : "—"],
      [t("backend"), r.backend ? frag(h("code", {}, r.backend.name), " ", tag(r.backend.kind), r.backend.outcome ? frag(" ", badge(r.backend.outcome, "plain"), ` ${num(r.backend.seconds)} s`) : null) : "—"],
      [t("contract"), r.contract ? frag(h("code", {}, `${r.contract.id} ${r.contract.version}`), " ", sha(r.contract.sha256)) : "—"],
      [t("backend_self_report"), r.backend?.self_report && Object.keys(r.backend.self_report).length > 0 ? frag(badge("backend"), " ", h("code", { class: "wrap-any" }, JSON.stringify(r.backend.self_report)), h("div", { class: "hint" }, t("self_report_hint"))) : "—"],
      [t("created"), time(r.created_at)], [t("finished"), time(r.finished_at)],
    ])),
    Array.isArray(r.phases) ? table([t("phase"), t("status"), t("started"), `${t("seconds")}#`], r.phases.map((p) => h("tr", {}, td(h("code", {}, p.name)), td(badge(p.status ?? "unknown", "plain")), td(time(p.started_at)), td(num(p.seconds), "num")))) : null) : null,

    plan ? frag(h("h2", { class: "sub" }, t("compiled_plan")),
      plan.predicted ? notice("info", t("predicted"), frag(badge(plan.predicted.best_verdict ?? "unknown"), " ", (plan.predicted.blocking_unavailable ?? []).length > 0 ? `${t("blocking_unavailable")}: ${plan.predicted.blocking_unavailable.join(", ")}` : "")) : null,
      (plan.warnings ?? []).length > 0 ? notice("warn", t("plan_warnings"), h("ul", {}, plan.warnings.map((w) => h("li", {}, typeof w === "string" ? w : JSON.stringify(w))))) : null,
      (plan.predicted?.known_failures ?? []).length > 0 ? notice("bad", t("known_failures"), h("ul", {}, plan.predicted.known_failures.map((w) => h("li", {}, typeof w === "string" ? w : JSON.stringify(w))))) : null,
      plan.applicability ? h("div", { class: "panel" }, kv([
        [t("required_capabilities"), (plan.applicability.required ?? []).map((c) => frag(tag(c), " "))],
        [t("provided_by"), h("code", { class: "wrap-any" }, JSON.stringify(plan.applicability.provided ?? {}))],
        [t("missing_capabilities"), (plan.applicability.missing ?? []).length === 0 ? "—" : plan.applicability.missing.map((c) => frag(badge(c, "fail"), " "))],
      ])) : null,
      Array.isArray(plan.requirements) ? table(["id", t("requirement"), t("supplied_by"), t("producer_obligations"), t("validator")], plan.requirements.map((q) => h("tr", {},
        td(h("code", {}, q.id)), td(q.title), td(badge(q.supplied_by ?? "unknown", "plain")),
        td((q.producer_obligations ?? []).map((o) => h("div", {}, o))),
        td(q.validator ? frag(badge(q.validator.available ? "available" : "not_available", "plain"), ` #${q.validator.order ?? ""}`) : "—")))) : null,
      plan.instructions ? h("details", {}, h("summary", {}, t("instructions_sent")), h("pre", { class: "wrap" }, plan.instructions)) : null,
      h("details", {}, h("summary", {}, "tenric/plan.json"), json(plan))) : null,

    runtime.verification ? frag(h("h2", { class: "sub" }, t("recorded_verdict")),
      notice("info", t("recorded_verdict_title"), t("recorded_verdict_body")),
      h("div", { class: "panel" }, kv([
        [t("verdict"), runtime.verification.verdict ? badge(runtime.verification.verdict) : "—"],
        [t("statement"), h("code", { class: "wrap-any" }, runtime.verification.statement ?? "—")],
        [t("issued_at"), time(runtime.verification.issued_at)],
        [t("artifact_digest"), sha(runtime.verification.artifact?.sha256, true)],
        [t("reproduction"), runtime.verification.reproduction?.requested ? t("reproduction_requested") : t("reproduction_not_requested")],
      ])),
      h("details", {}, h("summary", {}, "tenric/verification.json"), json(runtime.verification))) : null,

    runtime.reexecution ? frag(h("h2", { class: "sub" }, t("reexecution_record")),
      Array.isArray(runtime.reexecution.outputs) ? table([t("file"), t("determinism"), "first sha256", "second sha256", ""], runtime.reexecution.outputs.map((o) => h("tr", {},
        td(h("code", {}, o.path)), td(o.determinism ? tag(o.determinism) : "—"), td(sha(o.first_sha256)), td(sha(o.second_sha256)),
        td(badge(o.identical ? "identical" : "differs", o.identical ? "pass" : o.determinism === "volatile" ? "neutral" : "fail"))))) : null,
      Array.isArray(runtime.reexecution.metrics) ? frag(h("div", { class: "spacer" }), table([t("metric"), "first#", "second#", "|Δ|#"], runtime.reexecution.metrics.map((m) => h("tr", {},
        td(h("code", {}, m.name)), td(num(m.first), "num"), td(num(m.second), "num"), td(num(m.abs_diff), "num"))))) : null) : null,

    Array.isArray(r?.review_notes) && r.review_notes.length > 0 ? frag(h("h2", { class: "sub" }, t("review_notes")), h("ul", {}, r.review_notes.map((n) => h("li", {}, n)))) : null,

    h("h2", { class: "sub" }, t("event_log")),
    events.available ? frag(
      h("p", { class: "hint" }, t("event_log_hint")),
      events.malformed > 0 ? notice("warn", t("malformed_events"), String(events.malformed)) : null,
      eventList(events.events)) : notAvailable(t("event_log"), t("event_log_missing")),
  );
}

// --------------------------------------------------------------------- page

export async function runDetail({ args: [id, tab] }) {
  const run = await api.run(id);
  let outcome = await api.verify(id);
  const s = run.summary;
  const container = h("div", {});
  setCrumbs([t("nav_runs"), "#/runs"], id);

  const draw = (active) => {
    container.replaceChildren(tabs([
      { id: "verdict", label: t("tab_verdict"), render: () => verdictPanel(run, outcome, async (body) => {
        try { outcome = await api.reverify(id, body); } catch (error) { outcome = { issued: false, no_verdict: `${t("verifier_fault")}: ${error.message}` }; }
        draw("verdict"); headVerdict();
      }) },
      { id: "evidence", label: t("tab_evidence"), render: () => evidencePanel(run, outcome) },
      { id: "outputs", label: `${t("tab_outputs")} · ${run.files.length}`, render: () => outputsPanel(run) },
      { id: "report", label: t("tab_report"), render: () => (run.report === null ? empty(t("no_report"), t("no_report_body"), null, { icon: "docs" }) : frag(h("p", { class: "hint" }, t("report_hint")), h("article", { class: "panel" }, markdown(run.report)))) },
      { id: "runtime", label: t("tab_runtime"), render: () => runtimePanel(run) },
      { id: "raw", label: "artifact.json", render: () => json(run.artifact_text) },
    ], active, (next) => history.replaceState(null, "", `#/runs/${encodeURIComponent(id)}/${next}`)));
  };
  const verdictFact = h("div", {});
  const headVerdict = () => verdictFact.replaceChildren(
    h("div", { class: "label" }, t("verdict")),
    h("div", { class: "v" }, outcome.issued ? badge(outcome.record.verdict) : h("span", { class: "badge none plain" }, t("no_verdict"))),
    h("div", { class: "l" }, outcome.issued ? `${outcome.record.summary.passed} / ${outcome.record.summary.mandatory} ${t("mandatory_passed_l")} · ${outcome.record.contract.version}` : "—"));
  headVerdict();
  draw(tab ?? "verdict");

  const failure = run.artifact?.failure;
  return frag(
    pageHead(s.title ?? id, frag(h("code", {}, s.path), s.experiment_id ? frag(" · ", t("experiment"), " ", h("code", {}, s.experiment_id)) : null,
      s.runtime ? frag(" · ", t("backend"), " ", h("code", {}, s.runtime.backend ?? "?"), " · ", t("task"), " ", h("code", {}, s.runtime.task ?? "?")) : null),
      h("a", { class: "btn", href: `#/compare?a=${encodeURIComponent(id)}` }, icon("compare", 14), t("compare_with_another"))),
    s.origin === "fixture" ? notice("warn", t("fixture_title"), t("fixture_body"))
      : s.data_class === "fixture" ? notice("warn", t("fixture_run_title"), t("fixture_run_body")) : null,
    s.readable ? null : notice("bad", t("artifact_unreadable"), s.error),
    h("div", { class: "facts" },
      verdictFact,
      fact(t("execution"), frag(s.status ? badge(s.status) : "—", s.exit_code !== undefined ? h("span", { class: "muted mono" }, `exit ${s.exit_code}`) : null), frag(num(s.runtime_seconds), " s · ", time(s.started_at))),
      fact(t("source_revision"), revision(s.source), s.runtime ? frag(t("lifecycle_status"), " ", s.runtime.status ?? "unknown") : s.source?.kind ?? "—"),
      fact(t("data_class"), dataClass(s.data_class), frag("artifact ", sha(s.artifact_sha256)))),
    failure ? frag(h("div", { class: "spacer" }), notice("bad", `${t("failure_record")}: ${failure.reason}`, h("pre", { class: "wrap term" }, failure.stderr_tail ?? ""))) : null,
    (s.metrics ?? []).length > 0 ? h("div", { class: "metrics" }, s.metrics.map((m) => h("div", { class: "metric" }, h("div", { class: "n" }, num(m.value)), h("div", { class: "l" }, m.name)))) : null,
    container,
  );
}
