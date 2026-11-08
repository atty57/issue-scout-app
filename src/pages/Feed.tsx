import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Compass,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { api } from "../api";
import { ApiError, errorMessage } from "../errors";
import { dateTime } from "../utils";
import {
  ErrorState,
  JobProgress,
  Loading,
  useResource,
} from "../components/ui";
import { SuggestionCard } from "../components/SuggestionCard";
import { useEffect } from "react";

export default function Feed() {
  const resource = useResource(() => api.suggestions());
  const [refreshJob, setRefreshJob] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  const [feedbackDelta, setFeedbackDelta] = useState(0);
  useEffect(() => {
    if (!retryAt) return;
    const update = () => {
      const left = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setRemaining(left);
      if (!left) clearInterval(timer);
    };
    const timer = setInterval(update, 1000);
    update();
    return () => clearInterval(timer);
  }, [retryAt]);
  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      setRefreshJob((await api.refresh()).job_id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        const seconds = Math.max(1, Math.ceil(error.retryAfter || 30));
        setRemaining(seconds);
        setRetryAt(Date.now() + seconds * 1000);
      } else setError(errorMessage(error));
    } finally {
      setRefreshing(false);
    }
  }
  const count = Math.max(0, (resource.data?.items.length || 0) + feedbackDelta);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span className="status-dot" /> YOUR DAILY SHORTLIST
          </div>
          <h1>
            Your next contribution
            <br className="mobile-break" /> starts here
            <span className="green-text">.</span>
          </h1>
          <p>Good issues. Your skills. A little less searching.</p>
        </div>
        <button
          className="button secondary refresh-button"
          onClick={() => void refresh()}
          disabled={refreshing || !!refreshJob || remaining > 0}
        >
          <RefreshCw size={15} className={refreshing ? "spin" : ""} />
          {remaining > 0
            ? `Try again in ${remaining}s`
            : refreshing
              ? "Starting…"
              : "Refresh suggestions"}
        </button>
      </div>
      {remaining > 0 && (
        <div className="notice" role="status">
          You’ve scouted recently. Refresh will be available in {remaining}{" "}
          seconds.
        </div>
      )}
      {error && <ErrorState message={error} retry={() => void refresh()} />}
      {refreshJob && (
        <JobProgress
          id={refreshJob}
          compact
          onComplete={() => {
            setRefreshJob("");
            setFeedbackDelta(0);
            resource.reload();
          }}
          onRetry={() => {
            setRefreshJob("");
            void refresh();
          }}
        />
      )}
      <div className="workspace-grid">
        <div className="feed-column">
          <div className="section-heading">
            <h2>
              Picked for you{" "}
              <span className="count-badge">
                {resource.loading ? "…" : count}
              </span>
            </h2>
            <a className="subtle-link" href="#/profile">
              <SlidersHorizontal size={14} />
              Your preferences
            </a>
          </div>
          {resource.loading ? (
            <div
              className="skeleton-group"
              aria-label="Loading suggestions"
              role="status"
            >
              {[0, 1].map((item) => (
                <div className="skeleton-card panel" key={item}>
                  <div />
                  <div />
                  <div />
                  <div />
                </div>
              ))}
            </div>
          ) : resource.error ? (
            <ErrorState message={resource.error} retry={resource.reload} />
          ) : resource.data?.last_error ? (
            <ErrorState
              message={resource.data.last_error}
              retry={() => void refresh()}
            />
          ) : resource.data?.items.length ? (
            <div className="suggestion-list">
              {resource.data.items.map((suggestion, index) => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  index={index}
                  onFeedback={(delta) =>
                    setFeedbackDelta((value) => value + delta)
                  }
                />
              ))}
            </div>
          ) : (
            <div className="panel empty-state">
              <span className="empty-icon">
                <Compass size={34} />
              </span>
              <h2>
                {resource.data?.setup_required?.length
                  ? "Connect your scout to get started."
                  : "A thoughtful shortlist can be empty."}
              </h2>
              <p>
                {resource.data?.setup_required?.length
                  ? `Set up ${resource.data.setup_required.join(" and ")} in Scout settings to discover real issues matched to your experience.`
                  : "Nothing met your fit and quality checks this time. We’ll keep looking; there’s no need to settle for a poor match."}
              </p>
              {resource.data?.next_run_at && (
                <span className="next-run">
                  Next scout: {dateTime(resource.data.next_run_at)}
                </span>
              )}
              {resource.data && !resource.data.next_run_at && (
                <span className="next-run">
                  Automatic scouting is off. Refresh when you’re ready.
                </span>
              )}
              <a
                href={
                  resource.data?.setup_required?.length
                    ? "#/scout-settings"
                    : "#/profile"
                }
                className="button secondary"
              >
                {resource.data?.setup_required?.length
                  ? "Connect services"
                  : "Review your preferences"}{" "}
                <ArrowUpRight size={14} />
              </a>
            </div>
          )}
          {!resource.loading && !!resource.data?.items.length && (
            <p className="feed-end">
              <Check size={14} />
              That’s your shortlist. Quality over an endless scroll.
            </p>
          )}
        </div>
        <aside className="context-column">
          <section className="panel profile-glance">
            <div className="aside-heading">
              <span className="small-icon">
                <Sparkles size={16} />
              </span>
              <h2>A shortlist with context</h2>
            </div>
            <p>
              Picked for your experience.
              <br />
              Checked for a realistic next step.
            </p>
            <div className="mini-divider" />
            <span className="small-caps">YOUR SCOUTING PROFILE</span>
            <ProfileGlance />
            <a href="#/profile" className="aside-link">
              View your profile <ArrowUpRight size={15} />
            </a>
          </section>
          <section className="how-it-works">
            <span className="small-caps">
              LESS GUESSWORK, MORE CONTRIBUTING
            </span>
            <h3>Why these issues?</h3>
            <p>
              Each suggestion clears checks for fit, scope, and project
              activity. You get the reasoning, too.
            </p>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <strong>Fits your experience</strong>
                  <p>Matched to skills you can review and edit.</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Has a clear next step</strong>
                  <p>Enough context to understand the work.</p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>Gets better with feedback</strong>
                  <p>
                    A quick thumbs up or down helps tune your next shortlist.
                  </p>
                </div>
              </li>
            </ol>
          </section>
          <div className="next-scout">
            <span className="status-dot" />
            <div>
              <strong>Your next scout</strong>
              <p>
                {resource.data?.next_run_at
                  ? dateTime(resource.data.next_run_at)
                  : "Automatic scouting is off"}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
function ProfileGlance() {
  const { data, loading, error, reload } = useResource(() => api.profile());
  if (loading) return <Loading label="Reading your profile…" />;
  if (error) return <ErrorState message={error} retry={reload} />;
  return (
    <>
      <div className="glance-tags">
        {data?.languages.map((item) => (
          <span className={`badge language ${item.value}`} key={item.value}>
            <span className="language-dot" />
            {item.value === "typescript"
              ? "TypeScript"
              : item.value === "python"
                ? "Python"
                : item.value}
          </span>
        ))}
      </div>
      <p className="glance-summary">
        {data?.skills
          .slice(0, 3)
          .map((item) => item.value)
          .join(" · ")}
      </p>
      <div className="glance-stat">
        <span>Watching</span>
        <strong>{data?.watchlist.length} repositories</strong>
      </div>
      <div className="glance-stat">
        <span>Open to</span>
        <strong>
          {data?.work_types
            .map((item) => (item === "code" ? "Code" : "Docs"))
            .join(" + ")}
        </strong>
      </div>
    </>
  );
}
