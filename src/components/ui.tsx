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
import { api, isMock } from "../api";
import { errorMessage } from "../errors";
import type { Job } from "../types";
import { safeHttps } from "../utils";
import { SpinnerRing } from "./beautiful";

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
      <SpinnerRing active />
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
// GitHub profile picture. Shows children instead when there is no URL or the image fails to load
// (the page's content policy only allows avatars.githubusercontent.com).
export function Avatar({
  url,
  alt = "",
  children,
}: {
  url?: string;
  alt?: string;
  children: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <>{children}</>;
  return <img className="avatar-img" src={url} alt={alt} onError={() => setFailed(true)} />;
}

// Label lists: comma separated in the demo (as on the web), one per line on desktop so a label may
// contain a comma. Always trimmed, because the engine matches labels exactly.
export const joinList = (items: string[]) => items.join(isMock ? ", " : "\n");
export const parseList = (text: string) =>
  text.split(isMock ? "," : "\n").map((item) => item.trim()).filter(Boolean);

export function ListField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label} · {isMock ? "comma separated" : "one per line"}</span>
      {isMock ? (
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
      {children}
    </label>
  );
}

// Errors from a 422 response for one field and anything nested under it.
export const fieldErrors = (fields: Record<string, string>, path: string) =>
  Object.entries(fields)
    .filter(([key]) => key === path || key.startsWith(`${path}.`))
    .map(([key, message]) => (
      <span className="field-error" role="alert" key={key}>
        {message}
      </span>
    ));

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
