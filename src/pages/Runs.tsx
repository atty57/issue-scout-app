import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  CircleCheck,
  Clock3,
  Copy,
  Download,
  FileCode2,
  LoaderCircle,
  Mail,
  Play,
  ShieldCheck,
  Square,
} from "lucide-react";
import { api, isMock } from "../api";
import { errorMessage } from "../errors";
import type { Run, RunReport } from "../types";
import { runStages } from "../stages";
import { dateTime } from "../utils";
import {
  ErrorState,
  External,
  Loading,
  Markdown,
  useResource,
} from "../components/ui";

export default function Runs({ id }: { id?: string }) {
  return id ? <RunDetail key={id} id={id} /> : <RunIndex />;
}
function RunIndex() {
  const resource = useResource(() => api.runs());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setBusy(true);
    setError("");
    try {
      const run = await api.startRun();
      window.location.hash = `/runs/${run.id}`;
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">FROM DISCOVERY TO A REVIEWABLE PATCH</span>
          <h1>
            Good intentions. Real contributions
            <span className="green-text">.</span>
          </h1>
          <p>
            Scout an issue, prepare a fix, and review the evidence before your
            next PR.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => void start()}
          disabled={
            busy || resource.data?.some((item) => item.status === "running")
          }
        >
          <Play size={15} />
          {busy ? "Starting scout…" : "Run full scout"}
        </button>
      </div>
      {error && <ErrorState message={error} />}
      <section className="run-intro panel">
        <span className="small-icon">
          <ShieldCheck size={19} />
        </span>
        <div>
          <h2>Your workflow, with you in control.</h2>
          <p>
            Discovery, suitability checks, fix drafting, isolated validation,
            and a saved review brief. You review the result, claim the issue,
            and submit the PR.
          </p>
        </div>
        <a className="subtle-link" href="#/scout-settings">
          Configure your scout <ArrowUpRight size={14} />
        </a>
      </section>
      <div className="run-pipeline-mini">
        {runStages.map((stage, index) => (
          <span key={stage.key}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {stage.title}
            {index !== runStages.length - 1 && <ArrowRight size={12} />}
          </span>
        ))}
      </div>
      <div className="section-heading">
        <h2>Your runs & reports</h2>
        <span className="muted field-hint">One selected issue per run</span>
      </div>
      {resource.loading ? (
        <Loading label="Loading scout runs…" />
      ) : resource.error ? (
        <ErrorState message={resource.error} retry={resource.reload} />
      ) : resource.data?.length ? (
        <div className="run-list">
          {resource.data.map((run) => (
            <a href={`#/runs/${run.id}`} className="run-row panel" key={run.id}>
              <span className={`run-state-icon ${run.status}`}>
                {run.status === "running" ? (
                  <LoaderCircle size={20} className="spin" />
                ) : run.status === "completed" ? (
                  <CircleCheck size={20} />
                ) : (
                  <Clock3 size={20} />
                )}
              </span>
              <div>
                <div className="run-row-top">
                  <strong>
                    {run.issue?.repo || "Your personalized scout"}
                  </strong>
                  <span className={`badge run-status ${run.status}`}>
                    {run.status}
                  </span>
                </div>
                <p>
                  {run.issue?.title ||
                    (run.status === "abstained"
                      ? "No issue met your suitability checks."
                      : run.error || "Finding your next contribution…")}
                </p>
                <span className="run-date">
                  {dateTime(run.started_at)} · {run.id}
                </span>
              </div>
              <ArrowUpRight size={17} />
            </a>
          ))}
        </div>
      ) : (
        <div className="panel empty-state">
          <Play size={30} />
          <h2>Your first scout is ready when you are.</h2>
          <p>Your saved reports and patches will appear here after each run.</p>
          <button className="button primary" onClick={() => void start()}>
            Run your first scout
          </button>
        </div>
      )}
    </>
  );
}
function RunDetail({ id }: { id: string }) {
  const [run, setRun] = useState<Run>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("brief");
  const announced = useRef("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api.run(id);
        if (!active) return;
        setRun(result);
        setError("");
        if (result.status === "running") timer = setTimeout(poll, 2000);
      } catch (error) {
        if (active) setError(errorMessage(error));
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id, revision]);
  async function cancel() {
    setBusy(true);
    try {
      setRun(await api.cancelRun(id));
      setRevision((value) => value + 1);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function retryDelivery() {
    setBusy(true);
    try {
      setRun(await api.retryDelivery(id));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const stageIndex = runStages.findIndex((stage) => stage.key === run?.stage);
  if (run)
    announced.current =
      run.status === "running"
        ? `${runStages[stageIndex]?.title}: ${run.events.at(-1)?.message || "Starting"}`
        : `Scout ${run.status}`;
  return (
    <>
      <a className="back-link" href="#/runs">
        <ArrowLeft size={14} />
        All runs & reports
      </a>
      {error && (
        <ErrorState
          message={error}
          retry={() => setRevision((value) => value + 1)}
        />
      )}
      {!run ? (
        !error && <Loading label="Opening your scout…" />
      ) : (
        <>
          <div className="page-heading run-heading">
            <div>
              <span className="eyebrow">
                {run.id} · {dateTime(run.started_at)}
              </span>
              <h1>
                {run.status === "running"
                  ? "Your scout is on the trail."
                  : run.status === "completed"
                    ? "A draft worth a closer look."
                    : run.status === "abstained"
                      ? "A good scout knows when to wait."
                      : run.status === "cancelled"
                        ? "Scout stopped."
                        : "This scout needs another look."}
              </h1>
              <p>
                {run.issue?.title ||
                  "Personalized to your resume, GitHub activity, and projects."}
              </p>
            </div>
            {run.status === "running" && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void cancel()}
              >
                <Square size={13} />
                Stop scout
              </button>
            )}
          </div>
          <div className="sr-only" role="status" aria-live="polite">
            {announced.current}
          </div>
          {isMock && (
            <div className="notice">
              Example run · no real code, tests, emails, or paid model calls are
              executed in this demo.
            </div>
          )}
          {run.error && <ErrorState message={run.error} />}
          {run.status === "abstained" && (
            <div className="panel empty-state">
              <ShieldCheck size={35} />
              <h2>No issue cleared your quality checks.</h2>
              <p>
                No fix was drafted. Your scout will try again on the next
                scheduled run, or you can adjust your preferences.
              </p>
              <a href="#/profile" className="button secondary">
                Review your preferences
              </a>
            </div>
          )}
          <div className="run-detail-layout">
            <div className="run-detail-main">
              {run.issue && (
                <div className="panel run-issue">
                  <span className="repo-line">
                    <FileCode2 size={15} />
                    {run.issue.repo} #{run.issue.number}
                  </span>
                  <h2>{run.issue.title}</h2>
                  <External href={run.issue.url} className="text-button">
                    Open issue on GitHub <ArrowUpRight size={14} />
                  </External>
                </div>
              )}
              {run.report ? (
                <>
                  <div className="report-metrics">
                    <div className="panel">
                      <ShieldCheck size={19} />
                      <strong>
                        {run.report.tests_passed ? "Passed" : "Not verified"}
                      </strong>
                      <span>Validation</span>
                    </div>
                    <div className="panel">
                      <CheckCheck size={19} />
                      <strong>
                        {run.report.regression_reproduced === null
                          ? "Not applicable"
                          : run.report.regression_reproduced
                            ? "Reproduced"
                            : "Not shown"}
                      </strong>
                      <span>Unfixed code regression</span>
                    </div>
                    <div className="panel">
                      <Clock3 size={19} />
                      <strong>${run.report.cost_estimate.toFixed(2)}</strong>
                      <span>Estimated Claude usage</span>
                    </div>
                  </div>
                  <div
                    className="filter-tabs"
                    role="group"
                    aria-label="Report section"
                  >
                    {[
                      ["brief", "Review brief"],
                      ["patch", "Patch"],
                      ["validation", "Validation"],
                      ["pr", "PR preparation"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        aria-pressed={tab === value}
                        className={tab === value ? "active" : ""}
                        onClick={() => setTab(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="panel report-content">
                    {tab === "brief" ? (
                      <ReviewBrief report={run.report} />
                    ) : tab === "patch" ? (
                      <>
                        <h2>Draft patch</h2>
                        <p className="section-description">
                          Inspect this change and reproduce the checks before
                          using it.
                        </p>
                        {run.report.patch ? (
                          <pre className="code-view patch-view">
                            {run.report.patch}
                          </pre>
                        ) : (
                          <ErrorState
                            message={
                              run.report.patch_withheld_reason ||
                              "No safe patch is available for this run."
                            }
                          />
                        )}
                      </>
                    ) : tab === "validation" ? (
                      <>
                        <h2>Validation evidence</h2>
                        <div className="validation-facts">
                          <span className="badge">{run.report.runtime}</span>
                          <span className="badge">
                            {run.report.attempts} drafting attempt(s)
                          </span>
                          <span className="badge">
                            {run.report.regression_reproduced === null
                              ? "Documentation checks"
                              : "Code + regression checks"}
                          </span>
                        </div>
                        <h3>Targeted commands</h3>
                        <pre className="code-view">
                          {run.report.test_commands
                            .map((command) => command.join(" "))
                            .join("\n")}
                        </pre>
                        <h3>Validation log</h3>
                        <pre className="code-view">
                          {run.report.validation_log}
                        </pre>
                        <h3>Unfixed-code regression</h3>
                        <pre className="code-view">
                          {run.report.regression_log}
                        </pre>
                      </>
                    ) : (
                      <>
                        <h2>Prepare your contribution</h2>
                        <CopyBlock
                          title="Claim comment"
                          value={run.report.claim_comment}
                        />
                        <CopyBlock
                          title="Commit message"
                          value={run.report.commit_message}
                        />
                        <CopyBlock
                          title="PR title"
                          value={run.report.pr_title}
                        />
                        <CopyBlock title="PR body" value={run.report.pr_body} />
                        <h3>Before you open the PR</h3>
                        <div className="report-checklist">
                          {run.report.checklist.map((item) => (
                            <label key={item}>
                              <input type="checkbox" />
                              <span>{item}</span>
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </>
              ) : run.status === "running" ? (
                <div className="panel run-working">
                  <LoaderCircle className="spin" size={26} />
                  <h2>{runStages[stageIndex]?.title}</h2>
                  <p>{runStages[stageIndex]?.detail}</p>
                  <span>
                    The report and patch will appear here when the scout
                    finishes.
                  </span>
                </div>
              ) : run.status === "completed" ? (
                <div className="panel empty-state">
                  <CircleCheck size={30} />
                  <h2>Discovery complete.</h2>
                  <p>
                    Fix drafting is disabled for this scout. You can review the
                    selected issue and prepare your own contribution.
                  </p>
                  <a href="#/scout-settings" className="button secondary">
                    Configure fix drafting
                  </a>
                </div>
              ) : (
                <div className="panel empty-state">
                  <Clock3 size={30} />
                  <h2>
                    {run.status === "cancelled"
                      ? "Stopped before completion."
                      : "No completed review brief."}
                  </h2>
                  <p>
                    The run log is preserved below. A new scout can try again
                    when you’re ready.
                  </p>
                  <a href="#/runs" className="button secondary">
                    Back to runs
                  </a>
                </div>
              )}
              <details className="panel run-log">
                <summary>
                  Run activity <Chevron />
                </summary>
                <ol>
                  {run.events.map((event, index) => (
                    <li key={index}>
                      <time dateTime={event.at}>{dateTime(event.at)}</time>
                      <strong>{event.stage}</strong>
                      <span>{event.message}</span>
                    </li>
                  ))}
                </ol>
              </details>
            </div>
            <aside className="run-detail-aside">
              <section className="panel run-stage-panel">
                <h2>Scout progress</h2>
                <ol>
                  {runStages.map((stage, index) => {
                    const seen = run.events.some(
                      (event) => event.stage === stage.key,
                    );
                    const complete =
                      seen &&
                      (index < stageIndex || run.status === "completed");
                    return (
                      <li
                        key={stage.key}
                        className={`${complete ? "complete" : ""} ${stage.key === run.stage ? "current" : ""}`}
                      >
                        <span className="run-step">
                          {complete ? <Check size={12} /> : index + 1}
                        </span>
                        <span>{stage.title}</span>
                        {stage.key === run.stage &&
                          run.status === "running" && (
                            <LoaderCircle size={12} className="spin" />
                          )}
                      </li>
                    );
                  })}
                </ol>
              </section>
              {run.report && (
                <>
                  <section className="panel downloads">
                    <h2>Saved artifacts</h2>
                    <p>
                      Your recovery files stay available independently of email
                      delivery.
                    </p>
                    <DownloadButton
                      filename="report.txt"
                      runId={run.id}
                      kind="report"
                      content={run.report.report_text}
                    >
                      Review brief
                    </DownloadButton>
                    {run.report.patch && (
                      <DownloadButton
                        filename="change.patch"
                        runId={run.id}
                        kind="patch"
                        content={run.report.patch}
                      >
                        Draft patch
                      </DownloadButton>
                    )}
                    <DownloadButton
                      filename="notification.json"
                      content={JSON.stringify(run.report.notification, null, 2)}
                    >
                      Delivery status
                    </DownloadButton>
                  </section>
                  <section className="panel delivery-panel">
                    <div className="aside-heading">
                      <Mail size={16} />
                      <h2>Email delivery</h2>
                    </div>
                    <span
                      className={`badge ${run.report.notification.status === "sent" ? "success" : ""}`}
                    >
                      {run.report.notification.status}
                    </span>
                    <p>
                      {run.report.notification.error ||
                        (run.report.notification.status === "disabled"
                          ? "Email is off. Your report and patch are saved here."
                          : "Your review brief was delivered.")}
                    </p>
                    {run.report.notification.status === "failed" && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void retryDelivery()}
                      >
                        {busy ? "Retrying…" : "Retry delivery only"}
                      </button>
                    )}
                  </section>
                </>
              )}
            </aside>
          </div>
        </>
      )}
    </>
  );
}
function Chevron() {
  return <ArrowRight size={12} />;
}
function ReviewBrief({ report }: { report: RunReport }) {
  return (
    <>
      {[
        ["Root cause", report.root_cause],
        ["Approach", report.approach],
        ["Risks to review", report.risks],
        ["Not verified", report.not_verified],
      ].map(([title, text]) => (
        <section className="brief-section" key={title}>
          <h2>{title}</h2>
          <Markdown>{text}</Markdown>
        </section>
      ))}
      <section className="brief-section">
        <h2>Questions a maintainer may ask</h2>
        <ul>
          {report.maintainer_questions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
function DownloadButton({
  content,
  filename,
  runId,
  kind,
  children,
}: {
  content?: string;
  filename: string;
  runId?: string;
  kind?: "report" | "patch" | "log";
  children: React.ReactNode;
}) {
  const inner = (
    <>
      <Download size={14} />
      <span>
        {children}
        <small>{filename}</small>
      </span>
      <ArrowUpRight size={12} />
    </>
  );
  // Live: stream from the artifact store. Mock (tests/demo) has no such endpoint,
  // so fall back to a client-side blob of the data already in the Run JSON.
  if (!isMock && runId && kind) {
    return (
      <a className="download-button" href={api.artifactUrl(runId, kind)} download={filename}>
        {inner}
      </a>
    );
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([content ?? ""], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <button className="download-button" onClick={download}>
      {inner}
    </button>
  );
}
function CopyBlock({ title, value }: { title: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        "Clipboard unavailable. You can select and copy the text below.",
      );
    }
  }
  return (
    <section className="copy-block">
      <div className="section-heading">
        <h3>{title}</h3>
        <button
          className="text-button"
          onClick={() => void copy()}
          aria-label={`Copy ${title}`}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="code-view">{value}</pre>
      {error && (
        <p className="field-hint" role="status">
          {error}
        </p>
      )}
    </section>
  );
}
