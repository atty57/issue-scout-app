import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Github, LoaderCircle, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { ErrorState } from "../components/ui";
import { errorMessage } from "../errors";
import type { Me } from "../types";

export default function RepositoryOnboarding({ me, onConnected }: { me: Me; onConnected: (me: Me) => void }) {
  const [mode, setMode] = useState<"create" | "connect">("create");
  const [name, setName] = useState("issue-scout");
  const [repo, setRepo] = useState(`${me.login}/issue-scout`);
  const [error, setError] = useState(me.repository_error || "");
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.setupRepository(mode === "create" ? { mode, name: name.trim() } : { mode, repo: repo.trim() });
      if (active.current) onConnected(result);
    } catch (error) {
      if (active.current) setError(errorMessage(error));
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return (
    <div className="onboarding-layout">
      <div className="onboarding-copy">
        <span className="eyebrow">YOUR SCOUT, IN YOUR GITHUB</span>
        <h1>A private home<br />for your Scout<span className="green-text">.</span></h1>
        <p>Create your own private copy of Issue Scout, or connect one you already have.</p>
        <ul className="benefit-list">
          <li><Check size={17} />Your profile and settings in one place</li>
          <li><Check size={17} />Scouting runs in your GitHub Actions</li>
          <li><Check size={17} />Your results stay in your private repository</li>
        </ul>
        <div className="connected-account">
          <Github size={20} />
          <div><strong>Connected as @{me.login}</strong><p>Your GitHub is ready to go.</p></div>
          <span className="badge success">Connected</span>
        </div>
      </div>
      <section className="panel onboarding-panel">
        <span className="small-caps">YOUR PRIVATE WORKSPACE</span>
        <h2>Set up your Scout repository.</h2>
        <p className="muted">Choose a repository in your personal GitHub account.</p>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset className="repository-choices" disabled={busy}>
            <legend className="sr-only">Repository setup</legend>
            <label><input type="radio" name="repository-mode" checked={mode === "create"} onChange={() => { setMode("create"); setError(""); }} />Create a private repository</label>
            <label><input type="radio" name="repository-mode" checked={mode === "connect"} onChange={() => { setMode("connect"); setError(""); }} />Connect existing repository</label>
          </fieldset>
          {mode === "create" ? (
            <label className="field">
              <span id="repository-label">Repository name</span>
              <input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} autoComplete="off" aria-labelledby="repository-label" aria-describedby="repository-hint" />
              <span id="repository-hint" className="field-hint">A private copy of the Issue Scout template, created under @{me.login}.</span>
            </label>
          ) : (
            <label className="field">
              <span id="repository-label">Existing repository</span>
              <input required maxLength={140} value={repo} onChange={(event) => setRepo(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} aria-labelledby="repository-label" aria-describedby="repository-hint" />
              <span id="repository-hint" className="field-hint">Use {me.login}/repository. Choose a private Scout copy that you own.</span>
            </label>
          )}
          {error && <ErrorState message={error} />}
          <button type="submit" className="button primary full-width" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Github size={16} />}
            {busy ? "Setting up your repository…" : mode === "create" ? "Create private repository" : "Connect repository"}
            <ArrowRight size={16} />
          </button>
        </form>
        <p className="privacy-note"><ShieldCheck size={14} />Connecting an existing repository keeps its files unchanged.</p>
      </section>
    </div>
  );
}
