import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Github,
  LogOut,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";
import { errorMessage } from "../errors";
import type { Me } from "../types";
import { ErrorState } from "../components/ui";
import { ResumeUpload } from "./Onboarding";

export default function Settings({
  me,
  onSignedOut,
  onUploaded,
}: {
  me: Me;
  onSignedOut: () => void;
  onUploaded: (id: string, file?: File) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (deleting) dialog.current?.showModal();
    else dialog.current?.close();
  }, [deleting]);
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api.logout();
      onSignedOut();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function deleteAccount() {
    if (confirmation !== "DELETE") return;
    setBusy(true);
    setError("");
    try {
      await api.deleteAccount();
      onSignedOut();
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
          <span className="eyebrow">YOUR ACCOUNT</span>
          <h1>
            Keep things up to date<span className="green-text">.</span>
          </h1>
          <p>Your experience changes. Your scout can change with it.</p>
        </div>
      </div>
      <div className="settings-layout">
        <div>
          <section className="panel profile-section">
            <h2>Connected account</h2>
            <div className="account-row">
              <span className="github-avatar">
                <Github size={25} />
              </span>
              <div>
                <strong>@{me.login}</strong>
                <p className="muted">Connected with GitHub</p>
              </div>
              <span className="badge success">Connected</span>
            </div>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void logout()}
            >
              <LogOut size={15} />
              Sign out
            </button>
          </section>
          <section className="panel profile-section">
            <h2>Update your resume</h2>
            <p className="section-description">
              Upload a newer resume to refresh your profile. Skills and
              languages you’ve locked will stay in place.
            </p>
            <ResumeUpload compact onUploaded={onUploaded} />
          </section>
          <section className="panel profile-section danger-zone">
            <h2>Delete account and data</h2>
            <p className="section-description">
              Permanently delete your account, resume, profile, and suggestion
              history.
            </p>
            <button
              className="button danger"
              onClick={() => {
                setDeleting(true);
                setConfirmation("");
                setError("");
              }}
            >
              <Trash2 size={15} />
              Delete my account and data
            </button>
          </section>
          {error && !deleting && <ErrorState message={error} />}
        </div>
        <aside className="profile-help">
          <ShieldCheck size={22} />
          <h3>Your data. Your control.</h3>
          <p>
            Your profile exists to help you find meaningful contributions. You
            can inspect its sources, edit it, or delete it at any time.
          </p>
        </aside>
      </div>
      <dialog
        ref={dialog}
        className="delete-dialog"
        aria-labelledby="delete-title"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setDeleting(false);
        }}
      >
        <div className="dialog-heading">
          <span className="danger-icon">
            <AlertTriangle size={22} />
          </span>
          <button
            className="icon-button"
            disabled={busy}
            aria-label="Close delete confirmation"
            onClick={() => setDeleting(false)}
          >
            <X size={19} />
          </button>
        </div>
        <h2 id="delete-title">Delete your account and data?</h2>
        <p>
          This permanently removes your resume, profile, feedback, and
          suggestion history. This action cannot be undone.
        </p>
        <label className="field">
          <span>
            Type <strong>DELETE</strong> to confirm
          </span>
          <input
            autoComplete="off"
            value={confirmation}
            disabled={busy}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        {error && <ErrorState message={error} />}
        <div className="dialog-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => setDeleting(false)}
          >
            Keep my account
          </button>
          <button
            className="button danger"
            disabled={confirmation !== "DELETE" || busy}
            onClick={() => void deleteAccount()}
          >
            {busy ? "Deleting…" : "Delete everything"}
          </button>
        </div>
      </dialog>
    </>
  );
}
