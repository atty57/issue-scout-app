import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Compass,
  ExternalLink,
  LoaderCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { api } from "../api";
import { errorMessage } from "../errors";
import type { Job } from "../types";
import { safeHttps } from "../utils";

export function Logo() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Compass size={22} strokeWidth={1.8} />
      </span>
      <span>
        issue<span className="brand-light">scout</span>
        <span className="brand-dot">.</span>
      </span>
    </span>
  );
}
export function Loading({
  label = "Loading your workspace…",
}: {
  label?: string;
}) {
  return (
    <div role="status" className="loading-state">
      <LoaderCircle className="spin" size={24} />
      <span>{label}</span>
    </div>
  );
}
export function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={19} />
      <div>
        <p>{message}</p>
        {retry && (
          <button className="text-button" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
export function External({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const safe = safeHttps(href);
  return safe ? (
    <a
      href={safe}
      className={className}
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      {children}
    </a>
  ) : (
    <span className={className}>{children}</span>
  );
}
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        allowedElements={[
          "p",
          "strong",
          "em",
          "ul",
          "ol",
          "li",
          "pre",
          "code",
          "a",
          "blockquote",
          "h3",
          "h4",
          "br",
        ]}
        urlTransform={(value) => safeHttps(value) || ""}
        components={{
          a: ({ href, children }) =>
            href && safeHttps(href) ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                {children}
                <ExternalLink size={11} />
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
export function useResource<T>(
  load: () => Promise<T>,
  dependencies: unknown[] = [],
) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    loading: boolean;
  }>({ loading: true });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    load()
      .then((data) => {
        if (active) setState({ data, loading: false });
      })
      .catch((error) => {
        if (active) setState({ error: errorMessage(error), loading: false });
      });
    return () => {
      active = false;
    };
    // Callers declare the values which change the resource.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, revision]);
  return {
    ...state,
    reload: () => setRevision((value) => value + 1),
    setData: (data: T) => setState({ data, loading: false }),
  };
}
const steps = [
  [
    "parsing_resume",
    "Read your resume",
    "Find the experience and skills that make you, you.",
  ],
  [
    "reading_github",
    "Explore your GitHub",
    "Look at the languages and projects you work with.",
  ],
  [
    "extracting_profile",
    "Connect the dots",
    "Build a profile you can review and make your own.",
  ],
  [
    "first_suggestions",
    "Scout your first issues",
    "Look for focused contributions that fit your experience.",
  ],
] as const;
export function JobProgress({
  id,
  onComplete,
  onRetry,
  compact = false,
}: {
  id: string;
  onComplete: () => void;
  onRetry: () => void;
  compact?: boolean;
}) {
  const [job, setJob] = useState<Job>();
  const [error, setError] = useState("");
  const complete = useRef(onComplete);
  complete.current = onComplete;
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setJob(undefined);
    setError("");
    async function poll() {
      try {
        const next = await api.job(id);
        if (!active) return;
        setJob(next);
        if (next.status === "done") complete.current();
        else if (next.status !== "failed") timer = setTimeout(poll, 2000);
      } catch (error) {
        if (active) setError(errorMessage(error));
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);
  const failed = job?.status === "failed";
  const current = steps.findIndex(([key]) => key === job?.step);
  return (
    <section className={`panel progress-panel ${compact ? "compact" : ""}`}>
      <span className="eyebrow">
        {compact ? "SCOUTING IN PROGRESS" : "A LITTLE CONTEXT GOES A LONG WAY"}
      </span>
      <h2>
        {failed
          ? "We hit a small roadblock"
          : compact
            ? "Looking for your next contribution"
            : "Getting to know your strengths"}
      </h2>
      <p className="muted">
        {compact
          ? "We’re checking for open issues that meet your preferences."
          : "We’re turning your experience into a more thoughtful shortlist."}
      </p>
      <div aria-live="polite" className="sr-only">
        {failed
          ? job.error
          : job?.step
            ? steps[current]?.[1]
            : "Preparing your scout"}
      </div>
      {!compact && (
        <ol className="progress-steps">
          {steps.map(([key, title, description], index) => (
            <li
              key={key}
              className={
                index < current || job?.status === "done"
                  ? "complete"
                  : index === current
                    ? "current"
                    : ""
              }
            >
              <span className="step-icon">
                {index < current ? (
                  <Check size={17} />
                ) : index === current && !failed ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  index + 1
                )}
              </span>
              <div>
                <strong>{title}</strong>
                <p>{description}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {compact && !failed && !error && (
        <Loading label={steps[current]?.[1] || "Preparing your scout…"} />
      )}
      {(failed || error) && (
        <ErrorState
          message={error || job?.error || "The job could not finish."}
        />
      )}
      {(failed || error) && (
        <button className="button primary" onClick={onRetry}>
          Retry
        </button>
      )}
    </section>
  );
}
