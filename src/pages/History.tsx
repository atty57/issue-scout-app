import { useState } from "react";
import { ArrowUpRight, History as HistoryIcon } from "lucide-react";
import { api, isMock } from "../api";
import { ErrorState, External, Loading, useResource } from "../components/ui";
import { SuggestionCard } from "../components/SuggestionCard";
import type { HistoryItem } from "../types";
import { dateTime } from "../utils";
import { PageHeader, RecordsTable } from "../components/beautiful";

export default function History() {
  return isMock ? <SuggestionHistory /> : <EngineHistory />;
}

const verified = (item: HistoryItem) => item.status !== "failed";
function label(item: HistoryItem) {
  if (item.status === "failed") return "no verified fix";
  if (item.status === "completed") return "verified, email not sent";
  if (item.legacy) return "delivered";
  return item.notification?.status === "disabled" ? "verified, saved" : "verified, emailed";
}

// Desktop: every issue the engine attempted, from its own state/seen.json. Only facts it recorded are shown,
// and only the passing ones are listed as checks: a failed attempt's tests may never have run.
function EngineHistory() {
  const { data, loading, error, reload } = useResource(() => api.history());
  const [filter, setFilter] = useState("all");
  const items =
    data?.items.filter(
      (item) => filter === "all" || (filter === "verified") === verified(item),
    ) || [];
  return (
    <>
      <PageHeader title="Contribution history" description="Every issue Scout attempted, with the checks and outcomes it recorded." />
      <div className="filter-tabs" role="group" aria-label="Filter attempted issues">
        {[
          ["all", "All attempts"],
          ["verified", "Verified fixes"],
          ["failed", "Not verified"],
        ].map(([value, text]) => (
          <button
            key={value}
            aria-pressed={value === filter}
            className={value === filter ? "active" : ""}
            onClick={() => setFilter(value)}
          >
            {text}
          </button>
        ))}
      </div>
      {!!data?.skipped && (
        <div className="notice warning" role="status">
          {data.skipped} {data.skipped === 1 ? "record" : "records"} in your
          Scout history couldn’t be read and {data.skipped === 1 ? "isn’t" : "aren’t"} shown.
        </div>
      )}
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} retry={reload} />
      ) : items.length ? (
        <RecordsTable label="Attempted issues" columns={["Issue", "Outcome", "Evidence", "Source"]}>
          {items.map((item) => {
            const facts = [
              item.attempted_at && `Attempted ${dateTime(item.attempted_at)}`,
              item.attempts !== undefined && `${item.attempts} ${item.attempts === 1 ? "attempt" : "attempts"}`,
              item.tests_passed && "tests passed",
              item.reproduces && "regression reproduced",
              item.documentation_verified && "documentation checks passed",
            ].filter(Boolean);
            return (
              <tr key={item.url}>
                <td>
                    <strong className="record-title">
                      {item.repo} #{item.number}
                    </strong>
                  {item.why && <p>Picked because: {item.why}</p>}
                  {item.status === "failed" && item.reason && <p>Result: {item.reason}</p>}
                  {item.notification?.error && <p>Email: {item.notification.error}</p>}
                  {item.legacy && <p>An older record: only the issue’s address was kept.</p>}
                  {item.status === "failed" && item.retry_after && (
                    <p>Scout may try this issue again after {dateTime(item.retry_after)}.</p>
                  )}
                </td>
                <td><span className={`badge run-status ${verified(item) ? "completed" : "failed"}`}>{label(item)}</span></td>
                <td><span className="record-detail">{facts.length > 0 ? facts.join(" · ") : "No additional checks recorded."}</span></td>
                <td>
                <External href={item.url} className="text-button">
                  Open issue <ArrowUpRight size={14} />
                </External>
                </td>
              </tr>
            );
          })}
        </RecordsTable>
      ) : (
        <div className="panel empty-state">
          <HistoryIcon size={32} />
          <h2>
            {filter === "all"
              ? "Your contribution trail starts here."
              : "No attempts like this yet."}
          </h2>
          <p>Issues your scout attempts will appear here after its runs.</p>
          <a className="button secondary" href="#/runs">
            Go to your runs
          </a>
        </div>
      )}
    </>
  );
}

function SuggestionHistory() {
  const { data, loading, error, reload } = useResource(() =>
    api.suggestions("past"),
  );
  const [filter, setFilter] = useState("all");
  const items =
    data?.items.filter(
      (item) => filter === "all" || item.feedback?.verdict === filter,
    ) || [];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR CONTRIBUTION TRAIL</span>
          <h1>A little history. A better fit.</h1>
          <p>Past suggestions and the feedback shaping what comes next.</p>
        </div>
      </div>
      <div
        className="filter-tabs"
        role="group"
        aria-label="Filter past suggestions"
      >
        {[
          ["all", "All suggestions"],
          ["up", "Good fit"],
          ["down", "Not a fit"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={value === filter}
            className={value === filter ? "active" : ""}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} retry={reload} />
      ) : items.length ? (
        <div className="suggestion-list history-list">
          {items.map((item) => (
            <SuggestionCard key={item.id} suggestion={item} historical />
          ))}
        </div>
      ) : (
        <div className="panel empty-state">
          <HistoryIcon size={32} />
          <h2>
            {filter === "all"
              ? "Your contribution trail starts here."
              : "No suggestions with this feedback yet."}
          </h2>
          <p>
            Your past recommendations and feedback will appear here as you use
            Issue Scout.
          </p>
          <a className="button secondary" href="#/">
            Explore your shortlist
          </a>
        </div>
      )}
    </>
  );
}
