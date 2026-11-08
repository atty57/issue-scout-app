import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleCheck,
  ExternalLink,
  FileCode2,
  Play,
  ShieldCheck,
  Star,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { api } from "../api";
import { errorMessage } from "../errors";
import type { Feedback, FeedbackReason, Suggestion } from "../types";
import { languageNames, relativeDate, safeHttps } from "../utils";
import { ErrorState, External, Markdown } from "./ui";

export const feedbackReasons: [FeedbackReason, string][] = [
  ["not_my_skills", "Not my skills"],
  ["too_big", "Too much scope"],
  ["repo_not_interesting", "Not my kind of repo"],
  ["already_taken", "Already taken"],
  ["unclear_issue", "Unclear issue"],
  ["other", "Something else"],
];
export function SuggestionCard({
  suggestion,
  index = 0,
  historical = false,
  onFeedback,
}: {
  suggestion: Suggestion;
  index?: number;
  historical?: boolean;
  onFeedback?: (delta: number) => void;
}) {
  const [feedback, setFeedback] = useState<Feedback | null>(
    suggestion.feedback,
  );
  const [picker, setPicker] = useState(false);
  const [reasons, setReasons] = useState<FeedbackReason[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");
  const [undoUntil, setUndoUntil] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pickerRef = useRef<HTMLDivElement>(null);
  const upRef = useRef<HTMLButtonElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (picker)
      pickerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [picker]);
  async function submit(value: Feedback) {
    setBusy(true);
    setError("");
    try {
      const item = await api.feedback(suggestion.id, value);
      setFeedback(item.feedback);
      setPicker(false);
      setUndoUntil(true);
      onFeedback?.(-1);
      timer.current = setTimeout(() => setUndoUntil(false), 5000);
      setTimeout(() => confirmationRef.current?.focus(), 0);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function undo() {
    setBusy(true);
    setError("");
    try {
      await api.undoFeedback(suggestion.id);
      clearTimeout(timer.current);
      setFeedback(null);
      setUndoUntil(false);
      onFeedback?.(1);
      setTimeout(() => upRef.current?.focus(), 0);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function prepare() {
    setDrafting(true);
    setError("");
    try {
      const run = await api.startRun(suggestion.id);
      window.location.hash = `/runs/${run.id}`;
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setDrafting(false);
    }
  }
  if (feedback && !historical)
    return (
      <div
        className="feedback-confirmation panel"
        ref={confirmationRef}
        tabIndex={-1}
      >
        <CircleCheck size={22} />
        <div role="status">
          <strong>Thanks, tuned your profile</strong>
          <p>We’ll use this to make your next shortlist more useful.</p>
        </div>
        {undoUntil && (
          <button className="text-button" disabled={busy} onClick={undo}>
            Undo
          </button>
        )}
        {error && <ErrorState message={error} />}
      </div>
    );
  return (
    <article
      className="suggestion-card panel"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="card-top">
        <div className="repo-line">
          <span className="repo-icon">
            <FileCode2 size={16} />
          </span>
          <External href={`https://github.com/${suggestion.issue.repo}`}>
            {suggestion.issue.repo}
          </External>
          <span className="issue-number">#{suggestion.issue.number}</span>
        </div>
        <span className="star-count">
          <Star size={13} />
          {Intl.NumberFormat("en", {
            notation: "compact",
            maximumFractionDigits: 1,
          }).format(suggestion.issue.repo_stars)}
        </span>
      </div>
      <h2 className="issue-title">
        <External href={suggestion.issue.url}>
          {suggestion.issue.title}
        </External>
      </h2>
      <div className="badges">
        <span className={`badge language ${suggestion.language}`}>
          <span className="language-dot" />
          {languageNames[suggestion.language]}
        </span>
        <span className="badge">
          {suggestion.work_type === "code" ? "Code" : "Documentation"}
        </span>
        {suggestion.issue.labels.map((label) => (
          <span className="badge label-badge" key={label}>
            {label}
          </span>
        ))}
        <span className="updated">
          Updated {relativeDate(suggestion.issue.updated_at)}
        </span>
      </div>
      <div className="fit-block">
        <span className="fit-label">
          <span className="sparkle">✧</span> Why this fits you
        </span>
        <Markdown>{suggestion.why}</Markdown>
      </div>
      <div className="evidence-grid">
        <div>
          <span className="detail-label">
            <CircleCheck size={14} /> A focused contribution
          </span>
          <Markdown>{suggestion.reason}</Markdown>
        </div>
        <div>
          <span className="detail-label">
            <ShieldCheck size={14} /> How to validate it
          </span>
          <Markdown>{suggestion.validation_plan}</Markdown>
        </div>
      </div>
      <div className="card-details">
        <details>
          <summary>
            Issue context <ChevronDown size={14} />
          </summary>
          <Markdown>{suggestion.issue.body_excerpt}</Markdown>
        </details>
        <details className="score-detail">
          <summary>
            <span>
              Match score <strong>{suggestion.score}</strong>
            </span>
            <ChevronDown size={14} />
          </summary>
          <dl className="score-list">
            {Object.entries(suggestion.score_components).map(([key, value]) => (
              <div key={key}>
                <dt>
                  {key.replaceAll("_", " ")}
                  {value < 0 ? " (penalty)" : ""}
                </dt>
                <dd className={value < 0 ? "penalty" : ""}>
                  {value > 0 ? "+" : ""}
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
      {suggestion.ai_policy.status !== "none" && (
        <div className={`policy ${suggestion.ai_policy.status}`}>
          <ShieldCheck size={14} />
          <span>
            {suggestion.ai_policy.status === "allowed"
              ? "AI assistance allowed"
              : "Disclose AI assistance"}
            {suggestion.ai_policy.status === "disclosure" && (
              <>
                {" "}
                ·{" "}
                <span className="policy-quote">
                  {suggestion.ai_policy.quote}
                </span>
              </>
            )}
          </span>
        </div>
      )}
      <div className="card-footer">
        <div className="confidence">
          <span className="confidence-bars">
            <i />
            <i />
            <i />
            <i className={suggestion.confidence < 0.85 ? "faded" : ""} />
          </span>
          <span>{Math.round(suggestion.confidence * 100)}% confidence</span>
        </div>
        {historical ? (
          <span className={`history-verdict ${feedback?.verdict || ""}`}>
            {feedback?.verdict === "up" ? (
              <ThumbsUp size={15} />
            ) : feedback?.verdict === "down" ? (
              <ThumbsDown size={15} />
            ) : null}
            {feedback?.verdict === "up"
              ? "Good fit"
              : feedback?.verdict === "down"
                ? "Not a fit"
                : "No feedback"}
          </span>
        ) : (
          <div className="card-actions">
            <div className="feedback-actions">
              <span>Good fit?</span>
              <button
                className="icon-button"
                aria-label={`Good fit: ${suggestion.issue.title}`}
                aria-pressed={false}
                ref={upRef}
                disabled={busy}
                onClick={() => void submit({ verdict: "up" })}
              >
                <ThumbsUp size={16} />
              </button>
              <button
                className={`icon-button ${picker ? "selected" : ""}`}
                aria-label={`Not a fit: ${suggestion.issue.title}`}
                aria-pressed={picker}
                aria-expanded={picker}
                disabled={busy}
                onClick={() => setPicker((value) => !value)}
              >
                <ThumbsDown size={16} />
              </button>
            </div>
            {safeHttps(suggestion.issue.url) && (
              <External href={suggestion.issue.url} className="button claim">
                Claim on GitHub <ArrowUpRight size={15} />
              </External>
            )}
            <button
              className="button primary draft-button"
              disabled={drafting || busy}
              onClick={() => void prepare()}
            >
              <Play size={12} />
              {drafting ? "Starting…" : "Draft a fix"}
            </button>
          </div>
        )}
      </div>
      {historical && feedback?.verdict === "down" && (
        <div className="past-reasons">
          {feedback.reasons?.map((reason) => (
            <span className="badge" key={reason}>
              {feedbackReasons.find(([key]) => key === reason)?.[1]}
            </span>
          ))}
          {feedback.note && <p>{feedback.note}</p>}
        </div>
      )}
      {picker && (
        <div
          className="feedback-picker"
          ref={pickerRef}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setPicker(false);
              upRef.current?.focus();
            }
          }}
        >
          <div className="picker-heading">
            <strong>What missed the mark?</strong>
            <button
              className="icon-button"
              onClick={() => setPicker(false)}
              aria-label="Close feedback"
            >
              <X size={16} />
            </button>
          </div>
          <p className="muted">
            A little feedback helps us find a better fit. Select any that apply.
          </p>
          <div className="reason-options">
            {feedbackReasons.map(([value, label]) => (
              <button
                className={`reason-chip ${reasons.includes(value) ? "selected" : ""}`}
                aria-pressed={reasons.includes(value)}
                key={value}
                onClick={() =>
                  setReasons((previous) =>
                    previous.includes(value)
                      ? previous.filter((item) => item !== value)
                      : [...previous, value],
                  )
                }
              >
                {reasons.includes(value) && <Check size={13} />}
                {label}
              </button>
            ))}
          </div>
          <label className="field">
            <span>
              Add a note <span className="muted">(optional)</span>
            </span>
            <textarea
              maxLength={500}
              rows={2}
              value={note}
              placeholder="What would make this more useful?"
              onChange={(event) => setNote(event.target.value)}
            />
            <span className="field-hint">{note.length}/500</span>
          </label>
          <button
            className="button primary"
            disabled={busy}
            onClick={() =>
              void submit({
                verdict: "down",
                reasons,
                ...(note.trim() ? { note: note.trim() } : {}),
              })
            }
          >
            {busy ? "Sending…" : "Send feedback"}
            <ArrowUpRight size={15} />
          </button>
        </div>
      )}
      {error && <ErrorState message={error} />}
      <span className="sr-only">
        <ExternalLink size={1} />
        External issue links open in a new tab.
      </span>
    </article>
  );
}
