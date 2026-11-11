import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  FolderGit2,
  Github,
  LogOut,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { api, isMock } from "../api";
import { errorMessage } from "../errors";
import type { Me } from "../types";
import { Avatar, ErrorState, External } from "../components/ui";
import { ResumeUpload } from "./Onboarding";

type AccountProps = {
  me: Me;
  onSignedOut: () => void;
  onUploaded: (id: string, file?: File) => void;
  onRepositoryChanged?: (me: Me) => void;
};

// Desktop has no resume and no server-side account to delete: everything Scout keeps is in the user's own
// repository, and the app only remembers the sign-in and which repository to use.
export default function Settings(props: AccountProps) {
  return isMock ? <DemoAccount {...props} /> : <DesktopAccount {...props} />;
}

function DemoAccount({ me, onSignedOut, onUploaded }: AccountProps) {
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
                <Avatar url={me.avatar_url}>
                  <Github size={25} />
                </Avatar>
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

function DesktopAccount({ me, onSignedOut, onRepositoryChanged }: AccountProps) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const repository = me.repository;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
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
            Account
          </h1>
          <p>Your GitHub sign-in and the Scout repository this computer uses.</p>
        </div>
      </div>
      <div className="settings-layout">
        <div>
          <section className="panel profile-section">
            <h2>Connected account</h2>
            <div className="account-row">
              <span className="github-avatar">
                <Avatar url={me.avatar_url}>
                  <Github size={25} />
                </Avatar>
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
              onClick={() => void run(async () => {
                await api.logout();
                onSignedOut();
              })}
            >
              <LogOut size={15} />
              Sign out
            </button>
          </section>
          {repository && (
            <section className="panel profile-section">
              <h2>Your Scout repository</h2>
              <div className="account-row">
                <span className="github-avatar">
                  <FolderGit2 size={22} />
                </span>
                <div>
                  <strong>{repository.full_name}</strong>
                  <p className="muted">Private · your profile, runs and reports live here</p>
                </div>
                <span className="badge success">Connected</span>
              </div>
              <p className="section-description">
                To use a different Scout repository on this computer, disconnect this one. Nothing on GitHub
                changes, and you can connect it again later.
              </p>
              <div className="inline-actions">
                {confirming ? (
                  <div className="dialog-actions">
                    <button className="button secondary" disabled={busy} onClick={() => setConfirming(false)}>
                      Keep {repository.full_name}
                    </button>
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => void run(async () => onRepositoryChanged?.(await api.disconnectRepository()))}
                    >
                      {busy ? "Disconnecting…" : "Disconnect and choose another"}
                    </button>
                  </div>
                ) : (
                  <button className="button secondary" disabled={busy} onClick={() => setConfirming(true)}>
                    Use a different repository
                  </button>
                )}
                <External href={repository.html_url} className="text-button">
                  Open {repository.full_name} on GitHub <ArrowUpRight size={13} />
                </External>
              </div>
            </section>
          )}
          <section className="panel profile-section">
            <h2>Your data</h2>
            {/* Keep in step with electron/main.js, electron/repositories.js and the template's email_relay.py. */}
            <p className="section-description">
              Your profile, runs, reports and history are kept in your private Scout repository on GitHub.
              Deleting that repository removes them.
            </p>
            <p className="section-description">
              On this computer, the app keeps your GitHub sign-in (encrypted by your computer), which Scout
              repository to use and, if you set up email reports, your address and whether it’s confirmed.
              Signing out removes only the sign-in. Using a different repository forgets only the repository
              choice.
            </p>
            <p className="section-description">
              If you use email reports, Issue Scout’s email service keeps the address you confirmed for your
              repository until you confirm a different one, and an address waiting for its code until it’s
              confirmed or replaced. The email service keeps delivery records to prevent duplicates and enforce
              limits. Older records are cleaned up during subsequent sending activity. Emails pass through the operator’s email
              provider, Resend, which keeps its own delivery logs. Turning email off, signing out or deleting your
              repository doesn’t remove any of this. To have it removed, ask the Issue Scout operator.
            </p>
            {repository && (
              <External href={`${repository.html_url}/settings`} className="text-button">
                Repository settings on GitHub <ArrowUpRight size={13} />
              </External>
            )}
          </section>
          {error && <ErrorState message={error} />}
        </div>
        <aside className="profile-help">
          <ShieldCheck size={22} />
          <h3>Your data. Your control.</h3>
          <p>
            Scout runs in your own GitHub Actions, with your own model keys. You can review, edit or delete
            everything it keeps in your repository at any time.
          </p>
        </aside>
      </div>
    </>
  );
}
