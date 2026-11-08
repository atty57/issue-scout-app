import { useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  Github,
  LoaderCircle,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { api } from "../api";
import { errorMessage } from "../errors";
import type { Me } from "../types";
import { fileError } from "../utils";
import { ErrorState } from "../components/ui";

export function ResumeUpload({
  onUploaded,
  compact = false,
}: {
  onUploaded: (id: string, file?: File) => void;
  compact?: boolean;
}) {
  const [file, setFile] = useState<File>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  function choose(value?: File) {
    if (!value) return;
    const issue = fileError(value);
    setError(issue || "");
    setFile(issue ? undefined : value);
  }
  async function upload(skip = false) {
    if (!skip && !file) return;
    setBusy(true);
    setError("");
    try {
      onUploaded(
        (await api.upload(skip ? undefined : file)).job_id,
        skip ? undefined : file,
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="resume-upload">
      <input
        className="sr-only"
        type="file"
        id={compact ? "settings-resume" : "resume"}
        aria-label="Choose resume"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ref={input}
        onChange={(event) => choose(event.target.files?.[0])}
        disabled={busy}
      />
      <div
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!busy) choose(event.dataTransfer.files?.[0]);
        }}
      >
        <span className="upload-icon">
          <Upload size={24} />
        </span>
        <strong>{file ? file.name : "Drop your resume here"}</strong>
        <p>
          {file
            ? `${(file.size / 1024).toFixed(0)} KB · Ready to upload`
            : "A little background helps us find a better fit."}
        </p>
        <button
          className="button secondary"
          onClick={() => input.current?.click()}
          disabled={busy}
        >
          {file ? "Choose another file" : "Browse files"}
        </button>
        <span className="field-hint">PDF or DOCX · Up to 5 MB</span>
      </div>
      {file && (
        <button
          className="text-button remove-file"
          disabled={busy}
          onClick={() => {
            setFile(undefined);
            if (input.current) input.current.value = "";
          }}
        >
          <X size={13} />
          Remove file
        </button>
      )}
      {error && <ErrorState message={error} />}
      <button
        className="button primary full-width"
        disabled={!file || busy}
        onClick={() => void upload()}
      >
        {busy ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <FileText size={16} />
        )}
        {busy
          ? "Uploading…"
          : compact
            ? "Upload and update profile"
            : "Build my profile"}
        <ArrowRight size={16} />
      </button>
      {!compact && (
        <button
          className="text-button skip-button"
          disabled={busy}
          onClick={() => void upload(true)}
        >
          Skip for now, use GitHub only <ArrowRight size={14} />
        </button>
      )}
      <p className="privacy-note">
        <ShieldCheck size={14} />
        Your resume is used to understand your experience. You can review your
        profile and delete your data at any time.
      </p>
    </div>
  );
}
export default function Onboarding({
  me,
  onUploaded,
}: {
  me: Me;
  onUploaded: (id: string, file?: File) => void;
}) {
  return (
    <div className="onboarding-layout">
      <div className="onboarding-copy">
        <span className="eyebrow">YOUR NEXT CHAPTER IN OPEN SOURCE</span>
        <h1>
          Great contributions
          <br />
          start with what
          <br />
          you already know<span className="green-text">.</span>
        </h1>
        <p>
          Let’s connect your experience to projects that could use it. No
          keyword hunting. No endless issue lists.
        </p>
        <ul className="benefit-list">
          <li>
            <Check size={17} />A small shortlist, built around your skills
          </li>
          <li>
            <Check size={17} />
            Clear reasoning behind every recommendation
          </li>
          <li>
            <Check size={17} />A profile you can always change
          </li>
        </ul>
        <div className="connected-account">
          <Github size={20} />
          <div>
            <strong>Connected as @{me.login}</strong>
            <p>Your GitHub is ready to go.</p>
          </div>
          <span className="badge success">Connected</span>
        </div>
      </div>
      <section className="panel onboarding-panel">
        <span className="small-caps">ONE SMALL STEP</span>
        <h2>Bring your experience along.</h2>
        <p className="muted">
          Add your resume to help us see beyond your GitHub activity.
        </p>
        <ResumeUpload onUploaded={onUploaded} />
      </section>
    </div>
  );
}
