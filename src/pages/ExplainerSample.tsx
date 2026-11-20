// Prototype of the visual bug explainer on hand-written samples (docs/evidence-walkthrough.md, stage 2).
// Nothing here comes from a run, and the page says so. Real runs don't get a diagram until the engine saves a
// checked explanation.
import { useMemo, useState } from "react";
import { BugDiagram } from "../components/BugDiagram";
import { PageHeader } from "../components/beautiful";
import { buildDiagram, reasoningFor } from "../diagram";
import { SAMPLES } from "../samples/explanations";

export default function ExplainerSample() {
  const [index, setIndex] = useState(0);
  const sample = SAMPLES[index];
  const built = useMemo(() => buildDiagram(sample.explanation, {
    patch: sample.run.report?.patch ?? null, withheld: !!sample.run.report?.patch_withheld_reason, issue: sample.issue,
  }), [sample]);
  const reasoning = useMemo(() => reasoningFor(sample.run, built.ok ? built.diagram : undefined), [sample, built]);
  return (
    <>
      <PageHeader eyebrow="Preview" title="Bug explanation" description="How the bug happens, where the fix steps in, and why that change was chosen." />
      <p className="notice warning diagram-sample-note" role="note">
        <strong>Sample explanation, written by hand.</strong> No run produced it: the repository, files, issue and check
        results below don’t exist. Scout doesn’t draw these diagrams for your runs yet.
      </p>
      <div className="filter-tabs" role="group" aria-label="Sample">
        {SAMPLES.map((item, at) => (
          <button key={item.name} aria-pressed={index === at} className={index === at ? "active" : ""} onClick={() => setIndex(at)}>
            {item.name}
          </button>
        ))}
      </div>
      <h2 className="diagram-issue">{sample.issue.title}</h2>
      {built.ok && reasoning
        ? <BugDiagram key={index} diagram={built.diagram} reasoning={reasoning} />
        : <p className="notice warning">No diagram is shown. {built.ok ? "This sample has no report." : built.reason}</p>}
    </>
  );
}
