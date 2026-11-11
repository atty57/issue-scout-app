// Adapted from Beautiful UI's Task Rows and code/table presentation patterns.
// Copyright (c) 2026 Shane Levine. MIT; see THIRD_PARTY_NOTICES.md.
// Demo timers and sample data are deliberately omitted: callers supply recorded state.
import { useState } from "react";
import { AlertCircle, Check, ChevronDown, Copy } from "lucide-react";

export function PageHeader({ title, description, eyebrow, children }: {
  title: string; description?: string; eyebrow?: string; children?: React.ReactNode;
}) {
  return <div className="page-heading">
    <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>
      {description && <p>{description}</p>}</div>
    {children && <div className="page-actions">{children}</div>}
  </div>;
}

export function SpinnerRing({ active, children }: { active?: boolean; children?: React.ReactNode }) {
  const radius = 11, circumference = 2 * Math.PI * radius;
  return <span className="task-ring" aria-hidden="true">
    <svg width="26" height="26" viewBox="0 0 26 26" className={active ? "spin" : undefined}>
      <circle cx="13" cy="13" r={radius} fill="none" stroke="var(--line)" strokeWidth="2" />
      {active && <circle cx="13" cy="13" r={radius} fill="none" stroke="var(--green)" strokeWidth="2"
        strokeLinecap="round" strokeDasharray={`${circumference * 0.28} ${circumference * 0.72}`} />}
    </svg><span>{children}</span>
  </span>;
}

export type TaskRow = {
  // "unverified": the step ran but its checks didn't pass, so it never gets the success tick.
  key: string; label: string; status: "pending" | "running" | "complete" | "unverified";
  details?: string[];
};
export function TaskRows({ rows }: { rows: TaskRow[] }) {
  return <ol className="task-rows">{rows.map((row, index) => <li key={row.key} className={`task-row ${row.status}`}>
    <details>
      <summary>
        {row.status === "complete" ? <span className="task-check"><Check size={15} /></span>
          : row.status === "unverified" ? <span className="task-check unverified"><AlertCircle size={15} /></span>
            : <SpinnerRing active={row.status === "running"}>{index + 1}</SpinnerRing>}
        <span className="task-label">{row.label}</span>
        <span className="task-state">{row.status === "complete" ? "Complete" : row.status === "running" ? "Running" : row.status === "unverified" ? "Ran, not verified" : "Not recorded"}</span>
        {!!row.details?.length && <ChevronDown size={14} />}
      </summary>
      <div className="task-details">{row.details?.length ? row.details.map((text, i) => <p key={i}>{text}</p>)
        : <p>No activity recorded for this step.</p>}</div>
    </details>
  </li>)}</ol>;
}

export function RecordsTable({ label, columns, children }: {
  label: string; columns: string[]; children: React.ReactNode;
}) {
  return <div className="records-frame" role="region" aria-label={label} tabIndex={0}>
    <table className="records-table"><caption className="sr-only">{label}</caption>
      <thead><tr>{columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}

export function CodeBlock({ children, title = "Output", diff = false }: { children: string; title?: string; diff?: boolean }) {
  const [copy, setCopy] = useState("");
  const lines = children.replace(/\n$/, "").split("\n");
  return <div className="code-block">
    <div className="code-toolbar"><span>{title}</span><button type="button" className="text-button" aria-label={`Copy ${title}`} onClick={async () => {
      try { await navigator.clipboard.writeText(children); setCopy("Copied"); }
      catch { setCopy("Copy failed. Select the text to copy it."); }
    }}><Copy size={14} />Copy</button></div>
    {copy && <span className="code-copy-status" role="status">{copy}</span>}
    <pre className="code-view" aria-label={title}><code>{lines.map((line, index) => {
      const tone = !diff ? "" : line.startsWith("@@") ? "hunk" : line.startsWith("+") && !line.startsWith("+++") ? "added"
        : line.startsWith("-") && !line.startsWith("---") ? "removed" : "";
      return <span className={`code-line ${tone}`} key={index}><span className="line-number" aria-hidden="true">{index + 1}</span><span>{line}</span></span>;
    })}</code></pre>
  </div>;
}
