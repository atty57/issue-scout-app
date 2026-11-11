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
import { ApiError, errorMessage } from "../errors";
import type { Run, RunOutcome, RunReport } from "../types";
import { runStages } from "../stages";
import { CodeBlock, PageHeader, RecordsTable, TaskRows } from "../components/beautiful";
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
// How long to wait for GitHub to list a run it accepted. electron/runs.js refuses new starts for as long.
const LISTING_GRACE_MS = 2 * 60e3;
const REFRESH_MS = 5000;
function pollingRetryDelay(error: unknown, rateLimitFailures: number) {
  if (rateLimitFailures > 3) return 0; // manual retry remains available
  const limited = error instanceof ApiError && error.status === 429;
  const retryAfter = error instanceof ApiError ? error.retryAfter * 1000 : 0;
  const pause = Math.max(REFRESH_MS, retryAfter || (limited ? 60000 : 0));
  return pause * 2 ** Math.max(0, rateLimitFailures - 1);
}
const DELIVERY_LABELS = { sent: "sent", disabled: "email off", failed: "not sent", resending: "sending again" };
// The engine's outcome from the run's result.json (desktop). A successful workflow alone proves no fix.
const OUTCOME_LABELS = { fix_verified: "verified fix", fix_not_verified: "fix not verified", no_fix: "no fix", no_pick: "abstained" };
// How far a finished run got, from its result.json. GitHub steps only show discover and notify.
const OUTCOME_REACHED: Record<RunOutcome, string> = { fix_verified: "notify", fix_not_verified: "notify", no_fix: "revalidate", no_pick: "gate" };
const runLabel = (run: Run) => (run.status === "completed" && run.outcome ? OUTCOME_LABELS[run.outcome] : run.status);
const desktopRunTitle = (run: Run) => run.outcome ? {
  fix_verified: "Verified fix", fix_not_verified: "Fix not verified", no_fix: "Issue picked, no fix", no_pick: "No suitable issue",
}[run.outcome] : { running: "Scout running", completed: "Scout completed", failed: "Scout failed", cancelled: "Scout stopped", abstained: "No suitable issue" }[run.status];
const ARTIFACT_HEADINGS = {
  available: "Saved report",
  older: "Saved report",
  missing: "No saved report.",
  expired: "Saved report expired.",
  unreadable: "Saved report can’t be read.",
  unavailable: "Saved report not downloaded.",
};

function RunIndex() {
  const resource = useResource(() => api.runs());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollingRevision, setPollingRevision] = useState(0);
  // The run ids listed before a start GitHub accepted but hadn't listed yet.
  const [accepted, setAccepted] = useState<string[]>();
  const running = resource.data?.some((item) => item.status === "running");
  const listing = !!accepted && !resource.data?.some((item) => !accepted.includes(item.id));
  const watching = running || listing;
  const { setData } = resource;
  // Refresh quietly while a run is active or still being listed, so statuses and the Run button catch up.
  // One request at a time; leaving the page stops it.
  useEffect(() => {
    if (!watching) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    let rateLimitFailures = 0;
    let rateLimitMessage = "";
    const next = (delay = REFRESH_MS) => {
      timer = setTimeout(async () => {
        try {
          const data = await api.runs();
          if (!live) return;
          setData(data);
          if (rateLimitMessage) {
            const recovered = rateLimitMessage;
            setError(previous => previous === recovered ? "" : previous);
            rateLimitMessage = "";
          }
          rateLimitFailures = 0;
          next();
        } catch (error) {
          if (!live) return;
          const limited = error instanceof ApiError && error.status === 429;
          rateLimitFailures = limited ? rateLimitFailures + 1 : 0;
          if (limited) {
            rateLimitMessage = errorMessage(error);
            setError(rateLimitMessage);
          }
          const pause = pollingRetryDelay(error, rateLimitFailures);
          if (pause) next(pause);
        }
      }, delay);
    };
    next();
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // setData only wraps a state setter, so the first one stays valid.
  }, [watching, pollingRevision]);
  useEffect(() => {
    if (!accepted) return;
    const timer = setTimeout(() => setAccepted(undefined), LISTING_GRACE_MS);
    return () => clearTimeout(timer);
  }, [accepted]);
  async function start() {
    setBusy(true);
    setError("");
    const known = resource.data?.map((item) => item.id) ?? [];
    try {
      const run = await api.startRun();
      if ("pending" in run) setAccepted(known);
      else window.location.hash = `/runs/${run.id}`;
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader title="Your runs & reports" description="Find an issue, prepare a fix and review the evidence.">
        <button
          className="button primary"
          onClick={() => void start()}
          disabled={busy || running || listing}
        >
          <Play size={15} />
          {busy ? "Starting scout…" : "Run full scout"}
        </button>
      </PageHeader>
      {error && <ErrorState message={error} retry={() => {
        setError("");
        setPollingRevision(value => value + 1);
        resource.reload();
      }} />}
      {listing && (
        <div className="notice" role="status">
          <LoaderCircle size={16} className="spin" />
          Waiting for GitHub to list your scout. It should appear below in a
          moment. If it doesn’t within 2 minutes, you can start again.
        </div>
      )}
      <section className="workflow-note" aria-label="Scout workflow">
        <p><ShieldCheck size={16} /> Runs use your GitHub Actions and model credentials. You review every draft before submitting a PR.</p>
        <a className="subtle-link" href="#/scout-settings">
          Configure your scout <ArrowUpRight size={14} />
        </a>
      </section>
      {!!resource.data?.some(run => run.status === "running") && <TaskRows rows={resource.data.filter(run => run.status === "running").map(run => ({
        key: run.id, label: `Scout #${run.id} · ${runStages.find(stage => stage.key === run.stage)?.title || run.stage}`,
        status: "running", details: run.events.map(event => event.message),
      }))} />}
      {resource.loading ? (
        <Loading label="Loading scout runs…" />
      ) : resource.error ? (
        <ErrorState message={resource.error} retry={resource.reload} />
      ) : resource.data?.length ? (
        <RecordsTable label="Scout runs" columns={["Issue / scout", "Outcome", "Started", "Report"]}>
          {resource.data.map((run) => (
            <tr key={run.id}>
              <td>
                <a href={`#/runs/${run.id}`} className="record-title">{run.issue?.repo || "Your personalized scout"}{run.issue?.number ? ` #${run.issue.number}` : ""}</a>
                <span className="record-detail">
                  {run.issue?.title ||
                    (run.status === "abstained"
                      ? run.outcome_reason || "No issue met your suitability checks."
                      : run.error || run.artifact?.message || "Finding your next contribution…")}
                </span>
              </td>
              <td><span className={`badge run-status ${run.status} outcome-${run.outcome || "unknown"}`}>{runLabel(run)}</span></td>
              <td className="record-date">{dateTime(run.started_at)}<span className="record-id">#{run.id}</span></td>
              <td><a className="text-button" href={`#/runs/${run.id}`} aria-label={`Open report for scout ${run.id}`}>View report <ArrowUpRight size={14} /></a></td>
            </tr>
          ))}
        </RecordsTable>
      ) : (
        <div className="panel empty-state">
          <Play size={30} />
          <h2>Your first scout is ready when you are.</h2>
          <p>Your saved reports and patches will appear here after each run.</p>
          <button className="button primary" onClick={() => void start()} disabled={busy || listing}>
            {busy ? "Starting scout…" : "Run your first scout"}
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
    let watching = false;
    let rateLimitFailures = 0;
    async function poll() {
      try {
        const result = await api.run(id);
        if (!active) return;
        setRun(result);
        setError("");
        rateLimitFailures = 0;
        // Keep checking while the scout runs or its report is being emailed again.
        const wait = result.status === "running" ? 2000 : result.delivery?.status === "resending" ? 5000 : 0;
        watching = wait > 0;
        if (wait) timer = setTimeout(poll, wait);
      } catch (error) {
        if (!active) return;
        setError(errorMessage(error));
        // Preserve the last result and recover an ongoing watch after temporary failures.
        // Initial loads and permanent errors still offer the manual retry action.
        const temporary = !(error instanceof ApiError) || error.status === 408 || error.status === 429 || error.status >= 500;
        if (watching && temporary) {
          const limited = error instanceof ApiError && error.status === 429;
          rateLimitFailures = limited ? rateLimitFailures + 1 : 0;
          const pause = pollingRetryDelay(error, rateLimitFailures);
          if (pause) timer = setTimeout(poll, pause);
        }
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
      setRevision((value) => value + 1); // restart checking until the email's outcome shows up
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
                {!isMock ? desktopRunTitle(run) : run.status === "running"
                  ? "Your scout is on the trail."
                  : run.status === "completed"
                    ? run.outcome === "fix_not_verified"
                      ? "A draft that isn’t verified yet."
                      : run.outcome === "no_fix"
                        ? "An issue picked, but no fix this time."
                        : run.report
                          ? "A draft worth a closer look."
                          : "Your scout finished."
                    : run.status === "abstained"
                      ? "A good scout knows when to wait."
                      : run.status === "cancelled"
                        ? "Scout stopped."
                        : "This scout needs another look."}
              </h1>
              <p>
                {run.issue?.title ||
                  (isMock
                    ? "Personalized to your resume, GitHub activity, and projects."
                    : "Personalized to your Scout profile.")}
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
          {run.outcome && run.outcome_reason && run.status !== "abstained" && (
            <div className={`notice outcome-${run.outcome}`} role="status">
              <strong>Scout’s result: {OUTCOME_LABELS[run.outcome]}.</strong>{" "}
              {run.outcome_reason}
            </div>
          )}
          {run.status === "abstained" && (
            <div className="panel empty-state">
              <ShieldCheck size={35} />
              <h2>No issue cleared your quality checks.</h2>
              {run.outcome_reason && <p>{run.outcome_reason}.</p>}
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
                  {!isMock && <IssueDetails issue={run.issue} />}
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
                        {/* No verdict means "not run" for code (its tests failed first); only documentation has none by design. */}
                        {run.report.work_type === "documentation"
                          ? "Not applicable"
                          : run.report.regression_reproduced === null
                            ? "Not run"
                            : run.report.regression_reproduced
                              ? "Reproduced"
                              : "Not shown"}
                      </strong>
                      <span>Unfixed code regression</span>
                    </div>
                    <div className="panel">
                      <Clock3 size={19} />
                      <strong>
                        {run.report.cost_estimate === null
                          ? "Not reported"
                          : `$${run.report.cost_estimate.toFixed(2)}`}
                      </strong>
                      <span>Estimated model cost</span>
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
                          <CodeBlock title="change.patch" diff>{run.report.patch}</CodeBlock>
                        ) : (
                          <ErrorState
                            message={
                              run.report.patch_withheld_reason
                                ? `Withheld for safety: ${run.report.patch_withheld_reason} The patch isn’t shown, emailed or saved as change.patch.`
                                : "No safe patch is available for this run."
                            }
                          />
                        )}
                      </>
                    ) : tab === "validation" ? (
                      <>
                        <h2>Validation evidence</h2>
                        <div className="validation-facts">
                          <span className="badge">
                            {run.report.runtime ?? "Runtime not recorded"}
                          </span>
                          {run.report.attempts !== null && (
                            <span className="badge">
                              {run.report.attempts} drafting attempt(s)
                            </span>
                          )}
                          <span className="badge">
                            {run.report.work_type === "documentation"
                              ? "Documentation checks"
                              : "Code + regression checks"}
                          </span>
                        </div>
                        {!!run.report.setup_commands?.length && (
                          <>
                            <h3>Setup commands</h3>
                            <pre className="code-view">
                              {run.report.setup_commands
                                .map((command) => command.join(" "))
                                .join("\n")}
                            </pre>
                          </>
                        )}
                        <h3>Targeted commands</h3>
                        <pre className="code-view">
                          {run.report.test_commands
                            .map((command) => command.join(" "))
                            .join("\n")}
                        </pre>
                        <h3>Validation log</h3>
                        <CodeBlock title="Validation log">{run.report.validation_log}</CodeBlock>
                        <h3>Unfixed-code regression</h3>
                        <CodeBlock title="Regression log">{run.report.regression_log}</CodeBlock>
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
              ) : run.artifact &&
                (run.artifact.status !== "available" ||
                  run.artifact.report_text) ? (
                <SavedArtifact run={run} />
              ) : run.status === "completed" && !isMock ? (
                <div className="panel empty-state">
                  <CircleCheck size={30} />
                  <h2>Run finished.</h2>
                  <p>
                    Its report, and a patch if Scout drafted a fix, are saved
                    with the run on GitHub under Artifacts.
                  </p>
                  {run.html_url && (
                    <External href={run.html_url} className="button secondary">
                      Open the run on GitHub
                    </External>
                  )}
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
                {!isMock && run.html_url && (
                  <External href={run.html_url} className="text-button">
                    Open the full log on GitHub <ArrowUpRight size={14} />
                  </External>
                )}
              </details>
            </div>
            <aside className="run-detail-aside">
              <section className="panel run-stage-panel">
                <h2>Scout progress</h2>
                <TaskRows rows={runStages.map((stage, index) => {
                  const seen = run.events.some(event => event.stage === stage.key);
                  const reached = run.outcome ? runStages.findIndex(item => item.key === OUTCOME_REACHED[run.outcome!]) : -1;
                  const complete = reached >= 0 ? index <= reached || (stage.key === "notify" && seen)
                    : seen && (index < stageIndex || run.status === "completed");
                  // Validation ran for an unverified fix, but it didn't pass: no success tick.
                  const unverified = run.outcome === "fix_not_verified" && stage.key === "validate";
                  return { key: stage.key, label: stage.title,
                    status: unverified ? "unverified" : complete ? "complete" : stage.key === run.stage && run.status === "running" ? "running" : "pending",
                    details: run.events.filter(event => event.stage === stage.key).map(event => event.message) };
                })} />
              </section>
              {!isMock && run.delivery && (
                <section className="panel delivery-panel">
                  <div className="aside-heading">
                    <Mail size={16} />
                    <h2>Email delivery</h2>
                  </div>
                  <span className={`badge ${run.delivery.status === "sent" ? "success" : ""}`}>
                    {DELIVERY_LABELS[run.delivery.status]}
                  </span>
                  <p>{run.delivery.message}</p>
                  {run.delivery.status === "disabled" && (
                    <a className="text-button" href="#/scout-settings/email">Email settings</a>
                  )}
                  {/* Sending again only reads the saved report; it never scouts or calls a model. */}
                  {run.delivery.status === "failed" &&
                    !["rejected", "forbidden", "duplicate", "unconfirmed"].includes(run.delivery.reason ?? "") && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void retryDelivery()}
                      >
                        {busy ? "Sending…" : "Email this report again"}
                      </button>
                    )}
                </section>
              )}
              {(run.report?.report_text || run.artifact?.report_text) && (
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
                    content={run.report?.report_text ?? run.artifact?.report_text}
                  >
                    Review brief
                  </DownloadButton>
                  {(run.report?.patch || run.artifact?.patch) && (
                    <DownloadButton
                      filename="change.patch"
                      runId={run.id}
                      kind="patch"
                      content={run.report?.patch ?? run.artifact?.patch}
                    >
                      Draft patch
                    </DownloadButton>
                  )}
                  {run.report?.patch_withheld_reason && (
                    <p className="field-hint">The patch was withheld for safety, so only the brief is saved.</p>
                  )}
                  {isMock && run.report && (
                    <DownloadButton
                      filename="notification.json"
                      content={JSON.stringify(run.report.notification, null, 2)}
                    >
                      Delivery status
                    </DownloadButton>
                  )}
                </section>
              )}
              {/* Desktop shows the engine's email outcome above, with "Email this report again". */}
              {isMock && run.report && (
                <>
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
// What the engine recorded about the picked issue; anything it didn't record is left out.
function IssueDetails({ issue }: { issue: NonNullable<Run["issue"]> }) {
  const facts = [issue.work_type, issue.language, ...(issue.labels ?? [])].filter(Boolean);
  return (
    <>
      {issue.why && <p>Why this one: {issue.why}</p>}
      {(facts.length > 0 || typeof issue.repo_stars === "number") && (
        <div className="validation-facts">
          {facts.map((fact) => (
            <span className="badge" key={fact}>
              {fact}
            </span>
          ))}
          {typeof issue.repo_stars === "number" && (
            <span className="badge">{issue.repo_stars} stars</span>
          )}
        </div>
      )}
      {issue.ai_policy && (
        <p className="field-hint">
          AI policy: {issue.ai_policy.status}
          {issue.ai_policy.quote && ` — “${issue.ai_policy.quote}”`}
        </p>
      )}
      {issue.feasibility && (
        <p className="field-hint">Validation setup: {issue.feasibility}</p>
      )}
      {issue.body_excerpt && (
        <details>
          <summary>Issue description</summary>
          <pre className="code-view">{issue.body_excerpt}</pre>
        </details>
      )}
    </>
  );
}
// A finished desktop run without a review brief: its saved report (a failed fix step, or an older engine),
// or why there's nothing to show. Nothing missing is filled in.
function SavedArtifact({ run }: { run: Run }) {
  const artifact = run.artifact!;
  if (artifact.report_text || artifact.patch)
    return (
      <div className="panel report-content">
        <h2>{ARTIFACT_HEADINGS[artifact.status]}</h2>
        {artifact.message && (
          <p className="section-description">{artifact.message}</p>
        )}
        {artifact.report_text && (
          <CodeBlock title="Saved report">{artifact.report_text}</CodeBlock>
        )}
        {artifact.patch && (
          <>
            <h3>Draft patch</h3>
            <CodeBlock title="change.patch" diff>{artifact.patch}</CodeBlock>
          </>
        )}
      </div>
    );
  return (
    <div className="panel empty-state">
      <Clock3 size={30} />
      <h2>{ARTIFACT_HEADINGS[artifact.status]}</h2>
      <p>{artifact.message}</p>
      {run.html_url && (
        <External href={run.html_url} className="button secondary">
          Open the run on GitHub
        </External>
      )}
    </div>
  );
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
  kind?: "report" | "patch";
  children: React.ReactNode;
}) {
  const [saving, setSaving] = useState("");
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
  // Desktop: main downloads the run's artifact itself and shows a save dialog, over the app's one IPC channel.
  // Mock (tests/demo): a client-side blob of the data already in the Run JSON.
  if (!isMock && runId && kind) {
    async function save() {
      setSaving("Saving…");
      try {
        const { saved } = await api.saveRunFile(runId!, kind!);
        setSaving(saved ? `Saved ${filename}.` : "");
      } catch (error) {
        setSaving(errorMessage(error));
      }
    }
    return (
      <>
        <button
          className="download-button"
          disabled={saving === "Saving…"}
          onClick={() => void save()}
        >
          {inner}
        </button>
        {saving && (
          <p className="field-hint" role="status">
            {saving}
          </p>
        )}
      </>
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
