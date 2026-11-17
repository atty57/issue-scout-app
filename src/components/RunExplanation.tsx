import { useMemo } from "react";
import type { Run } from "../types";
import { buildDiagram, reasoningFor, type Built } from "../diagram";
import { splitPatch } from "../patch";
import { BugDiagram, ReasoningPanel } from "./BugDiagram";

export default function RunExplanation({ run, onPatch }: { run: Run; onPatch: () => void }) {
  const built = useMemo((): Built => {
    const report = run.report;
    if (!report || !run.issue) return { ok: false, reason: "No explanation was recorded for this run." };
    if (report.patch_withheld_reason) return { ok: false, reason: "The patch was withheld, so no diagram or code preview is shown." };
    const candidate = report.explanation;
    if (candidate == null) return { ok: false, reason: report.explanation_unavailable_reason ?? "This run didn’t save a step-by-step diagram. Updated Scout engines can include one in future runs." };
    if (typeof candidate !== "object" || Array.isArray(candidate)) return { ok: false, reason: "This run’s saved diagram could not be read." };
    const raw = candidate as Record<string, unknown>;
    if (raw.sample !== false) return { ok: false, reason: "A sample diagram cannot be shown as a real run’s explanation." };
    if (raw.format_version !== 1 || raw.code_checked !== true) return { ok: false, reason: "This run’s diagram has no supported source checks." };
    if (raw.kind !== (report.work_type === "documentation" ? "documentation" : "behaviour")) return { ok: false, reason: "The saved diagram does not match this run’s work type." };
    return buildDiagram(raw, { patch: report.patch, withheld: false, issue: run.issue });
  }, [run]);
  const reasoning = useMemo(() => reasoningFor(run, built.ok ? built.diagram : undefined), [run, built]);
  const files = useMemo(() => run.report?.patch && !run.report.patch_withheld_reason ? splitPatch(run.report.patch)?.files : undefined, [run.report]);
  if (built.ok && reasoning) return <BugDiagram diagram={built.diagram} reasoning={reasoning} />;
  return <div className="bug-diagram">
    {!built.ok && <p className="notice">{built.reason} Your other report views remain available.</p>}
    {!!run.report?.patch && !run.report.patch_withheld_reason && <section className="diagram-list" aria-label="Saved changes">
      <h3>Saved changes</h3>
      {files && <ul>{files.map((file) => <li key={`${file.start}-${file.path}`}>{file.path} · {file.status}{file.binary ? " · binary, not shown" : ""}</li>)}</ul>}
      <button type="button" className="text-button" onClick={onPatch}>Open saved patch</button>
    </section>}
    {reasoning && <ReasoningPanel reasoning={reasoning} />}
  </div>;
}
