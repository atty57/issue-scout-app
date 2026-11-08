import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Clock3,
  Link2,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { api, isMock } from "../api";
import { ApiError, errorMessage } from "../errors";
import type { Connection, ScoutSettings as ScoutSettingsType } from "../types";
import { ErrorState, ListField, Loading, fieldErrors, joinList, parseList, useResource } from "../components/ui";
import ModelSettings from "./ModelSettings";

const countFields: [keyof ScoutSettingsType, string, string][] = [
  [
    "days",
    "Fresh issue window (days)",
    "How far back to search for new issues.",
  ],
  [
    "updated_days",
    "Updated issue window (days)",
    "Watchlist, documentation, and help-wanted backlog.",
  ],
  [
    "search_pages",
    "Pages per search",
    "Limits discovery requests per category.",
  ],
  [
    "candidate_limit",
    "Candidate pool limit",
    "Maximum number of ranked issues to consider.",
  ],
  [
    "max_comment_pages",
    "Comment pages",
    "Budget for checking discussions and active claims.",
  ],
  [
    "max_timeline_pages",
    "Timeline pages",
    "Budget for checking PR references and resolution.",
  ],
  [
    "claim_days",
    "Claim expiry (days)",
    "Treat unrenewed claims as expired after this period.",
  ],
  [
    "retry_days",
    "Retry cooldown (days)",
    "Wait before attempting a failed issue again.",
  ],
  [
    "max_attempts",
    "Maximum issue attempts",
    "Total attempts per issue, including retries.",
  ],
];
export default function ScoutSettings() {
  const resource = useResource(() => api.scoutSettings());
  return resource.loading ? (
    <Loading label="Loading scout settings…" />
  ) : resource.error ? (
    <ErrorState message={resource.error} retry={resource.reload} />
  ) : resource.data ? (
    <Editor initial={resource.data} onReload={resource.reload} />
  ) : null;
}
function Editor({ initial, onReload }: { initial: ScoutSettingsType; onReload: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [aliases, setAliases] = useState(
    JSON.stringify(initial.skill_aliases, null, 2),
  );
  const [labels, setLabels] = useState(joinList(initial.labels));
  const [docsLabels, setDocsLabels] = useState(
    joinList(initial.documentation_labels),
  );
  const connections = useResource(() => isMock ? api.connections() : Promise.resolve<Connection[]>([]));
  const update = (key: keyof ScoutSettingsType, value: unknown) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setNotice("");
  };
  const fieldError = (key: string) => fieldErrors(fields, key);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setConflict(false);
    setNotice("");
    const invalid: Record<string, string> = {};
    let skillAliases: Record<string, string[]> = {};
    try {
      const parsed = JSON.parse(aliases);
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.values(parsed).some(
          (value) =>
            !Array.isArray(value) ||
            value.some((item) => typeof item !== "string"),
        )
      )
        throw new Error();
      skillAliases = parsed;
    } catch {
      invalid.skill_aliases =
        "Use a JSON object whose values are lists of words.";
    }
    countFields.forEach(([key]) => {
      if (!Number.isInteger(draft[key]) || Number(draft[key]) < 1)
        invalid[key] = "Enter a positive whole number.";
    });
    if (!Number.isFinite(draft.min_score) || draft.min_score < 0)
      invalid.min_score = "Use a non-negative score.";
    if (
      !Number.isFinite(draft.min_confidence) ||
      draft.min_confidence < 0 ||
      draft.min_confidence > 1
    )
      invalid.min_confidence = "Use a number from 0 to 1.";
    if (draft.email_enabled && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email))
      invalid.email = "Enter a valid delivery email.";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.schedule_time))
      invalid.schedule_time = "Choose a valid time.";
    try {
      Intl.DateTimeFormat(undefined, { timeZone: draft.timezone });
    } catch {
      invalid.timezone = "Use an IANA timezone such as America/New_York.";
    }
    setFields(invalid);
    if (Object.keys(invalid).length) {
      setError("Check the highlighted fields before saving.");
      return;
    }
    setBusy(true);
    try {
      const result = await api.saveScoutSettings({
        ...draft,
        skill_aliases: skillAliases,
        labels: parseList(labels),
        documentation_labels: parseList(docsLabels),
      });
      setDraft(result);
      setNotice(
        isMock
          ? "Scout settings saved for this demo session. Scheduled and email runs are simulated."
          : "Scout settings saved. They will apply to your next run.",
      );
    } catch (error) {
      setError(errorMessage(error));
      setConflict(error instanceof ApiError && error.status === 409);
      if (error instanceof ApiError) setFields(error.fields);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(connection: Connection) {
    setBusy(true);
    setError("");
    try {
      await api.demoToggleConnection(connection.id);
      connections.reload();
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
          <span className="eyebrow">MAKE THE WHOLE WORKFLOW YOURS</span>
          <h1>
            A scout that works your way<span className="green-text">.</span>
          </h1>
          <p>
            {isMock ? "Personal discovery, draft fixes, validation, scheduling, and delivery." : "Tune issue discovery, matching, and search budgets."}
          </p>
        </div>
        <a className="button secondary" href="#/profile">
          <SlidersHorizontal size={15} />
          Skills & matching
        </a>
      </div>
      {notice && (
        <div className="notice" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {isMock && <section className="panel profile-section connections-panel">
        <div className="section-heading">
          <h2>Connections</h2>
          <span className="badge">Demo connections</span>
        </div>
        <p className="section-description">
          Your account’s services power your scouts. Credentials are managed by
          the backend.
        </p>
        {connections.loading ? (
          <Loading label="Reading connections…" />
        ) : connections.error ? (
          <ErrorState message={connections.error} retry={connections.reload} />
        ) : (
          connections.data?.map((connection) => (
            <div className="connection-row" key={connection.id}>
              <span className="small-icon">
                <Link2 size={17} />
              </span>
              <div>
                <strong>{connection.name}</strong>
                <p>{connection.detail}</p>
              </div>
              <span
                className={`badge ${connection.connected ? "success" : ""}`}
              >
                {connection.connected ? "Connected" : "Not connected"}
              </span>
              {connection.id !== "github" && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void toggle(connection)}
                >
                  {connection.connected ? "Disconnect demo" : "Connect demo"}
                </button>
              )}
            </div>
          ))
        )}
      </section>}
      {!isMock && <ModelSettings />}
      <form onSubmit={save} noValidate>
        <fieldset disabled={busy}>
          <div className="scout-settings-layout">
            <div className="profile-main">
              {isMock && <section className="panel profile-section">
                <h2>Your daily scout</h2>
                <p className="section-description">
                  Choose when to run and how far the workflow should go.
                </p>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={draft.schedule_enabled}
                    onChange={(event) =>
                      update("schedule_enabled", event.target.checked)
                    }
                  />
                  <span>Run my scout automatically every day</span>
                </label>
                <div className="preferences-grid">
                  <label className="field">
                    <span>Daily run time</span>
                    <input
                      type="time"
                      value={draft.schedule_time}
                      aria-invalid={!!fields.schedule_time}
                      onChange={(event) =>
                        update("schedule_time", event.target.value)
                      }
                    />
                    {fieldError("schedule_time")}
                  </label>
                  <label className="field">
                    <span>Timezone</span>
                    <input
                      value={draft.timezone}
                      aria-invalid={!!fields.timezone}
                      placeholder="America/New_York"
                      onChange={(event) =>
                        update("timezone", event.target.value)
                      }
                    />
                    {fieldError("timezone")}
                  </label>
                </div>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={draft.draft_fixes}
                    onChange={(event) =>
                      update("draft_fixes", event.target.checked)
                    }
                  />
                  <span>
                    Draft a fix and run validation after choosing an issue
                  </span>
                </label>
                {fieldError("draft_fixes")}
                {draft.draft_fixes &&
                  connections.data &&
                  !connections.data.some(
                    (connection) =>
                      connection.id === "solver" && connection.connected,
                  ) && (
                    <p className="field-error" role="alert">
                      Connect Claude Code (Fix drafting) above before you run or
                      schedule drafting.
                    </p>
                  )}
                <p className="field-hint">
                  When off, your scout finishes after discovering and checking
                  an issue. Every drafted contribution still needs your review.
                </p>
              </section>}
              {isMock && <section className="panel profile-section">
                <h2>Delivery & tracing</h2>
                <p className="section-description">
                  Reports are always saved in your workspace. Email is optional.
                </p>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={draft.email_enabled}
                    onChange={(event) =>
                      update("email_enabled", event.target.checked)
                    }
                  />
                  <span>Email my review brief and safe patch</span>
                </label>
                <label className="field">
                  <span>Delivery email</span>
                  <input
                    type="email"
                    value={draft.email}
                    placeholder="you@example.com"
                    aria-invalid={!!fields.email}
                    onChange={(event) => update("email", event.target.value)}
                  />
                  {fieldError("email")}
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={draft.tracing_enabled}
                    onChange={(event) =>
                      update("tracing_enabled", event.target.checked)
                    }
                  />
                  <span>Enable detailed run tracing with LangSmith</span>
                </label>
                {fieldError("tracing_enabled")}
                <p className="field-hint">
                  Connect email or tracing above before enabling it. A delivery
                  failure keeps your saved report and does not rerun the fix.
                </p>
              </section>}
              <section className="panel profile-section">
                <h2>Discovery signals</h2>
                <p className="section-description">
                  Help your scout recognize relevant issues and related skill
                  names.
                </p>
                <ListField label="Code issue labels" value={labels} onChange={(value) => { setLabels(value); setNotice(""); }}>
                  {fieldError("labels")}
                </ListField>
                <ListField label="Documentation labels" value={docsLabels} onChange={(value) => { setDocsLabels(value); setNotice(""); }}>
                  {fieldError("documentation_labels")}
                </ListField>
                <label className="field">
                  <span>Skill aliases · JSON</span>
                  <textarea
                    rows={5}
                    className="monospace"
                    value={aliases}
                    aria-invalid={!!fields.skill_aliases}
                    onChange={(event) => {
                      setAliases(event.target.value);
                      setNotice("");
                    }}
                  />
                  {fieldError("skill_aliases")}
                  <span className="field-hint">
                    Example:{" "}
                    {JSON.stringify({
                      observability: ["tracing", "instrumentation"],
                    })}
                  </span>
                </label>
              </section>
              <details className="panel profile-section advanced-settings">
                <summary>
                  <SlidersHorizontal size={15} />
                  <strong>Advanced engine settings</strong>
                  <span>Search budgets, thresholds & retries</span>
                </summary>
                <div className="preferences-grid">
                  {countFields.map(([key, label, hint]) => (
                    <label className="field" key={key}>
                      <span>{label}</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={
                          Number.isNaN(draft[key]) ? "" : Number(draft[key])
                        }
                        aria-invalid={!!fields[key]}
                        onChange={(event) =>
                          update(key, event.target.valueAsNumber)
                        }
                      />
                      {fieldError(key)}
                      <span className="field-hint">{hint}</span>
                    </label>
                  ))}
                  <label className="field">
                    <span>Minimum score</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={
                        Number.isNaN(draft.min_score) ? "" : draft.min_score
                      }
                      aria-invalid={!!fields.min_score}
                      onChange={(event) =>
                        update("min_score", event.target.valueAsNumber)
                      }
                    />
                    {fieldError("min_score")}
                  </label>
                  <label className="field">
                    <span>Minimum confidence (0–1)</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={
                        Number.isNaN(draft.min_confidence)
                          ? ""
                          : draft.min_confidence
                      }
                      aria-invalid={!!fields.min_confidence}
                      onChange={(event) =>
                        update("min_confidence", event.target.valueAsNumber)
                      }
                    />
                    {fieldError("min_confidence")}
                  </label>
                </div>
                <a className="text-button" href="#/profile">
                  Edit repository stars, shortlist size, and excluded labels in
                  your profile <ArrowUpRight size={13} />
                </a>
              </details>
            </div>
            <aside className="profile-help">
              <ShieldCheck size={22} />
              <h3>Personal to your account.</h3>
              <p>
                {isMock ? "Your resume, GitHub projects, profile, run history, and delivery settings belong to your workspace." : "Your profile and scouting preferences are saved in your private GitHub repository."}
              </p>
              <h3>Supported contributions</h3>
              <p>
                Python, JavaScript, TypeScript, C#, C, and documentation. Your
                scout checks whether each repository can be validated in an
                available runtime.
              </p>
              <Clock3 size={21} />
              <h3>Retries with context.</h3>
              <p>
                Failed issues follow your cooldown and attempt limits. Email
                delivery can be retried separately from drafting.
              </p>
              {isMock && (
                <p className="field-hint">
                  This preview uses sample connections and runs. Real
                  scheduling, email, and model execution require the backend
                  integration described in the README.
                </p>
              )}
            </aside>
          </div>
          <div className="save-bar">
            {error && <ErrorState message={error} />}
            {conflict && <button type="button" className="button secondary" onClick={onReload}>Reload latest settings</button>}
            <span>Applies to your account’s future scouts.</span>
            <div>
              <button className="button primary" type="submit">
                <Save size={15} />
                {busy ? "Saving…" : "Save scout settings"}
              </button>
            </div>
          </div>
        </fieldset>
      </form>
    </>
  );
}
