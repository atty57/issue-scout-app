import { useState } from "react";
import { History as HistoryIcon } from "lucide-react";
import { api } from "../api";
import { ErrorState, Loading, useResource } from "../components/ui";
import { SuggestionCard } from "../components/SuggestionCard";

export default function History() {
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
