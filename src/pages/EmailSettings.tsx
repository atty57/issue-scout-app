import { useId, useState } from "react";
import { Check, Save } from "lucide-react";
import { api } from "../api";
import { ApiError, errorMessage } from "../errors";
import type { EmailSettings as Email } from "../types";
import { ErrorState, Loading, fieldErrors, useResource } from "../components/ui";

type Settings = Extract<Email, { available: true }>;
type Action = "save" | "code" | "confirm";

// Desktop only, and only in builds with an email relay (electron/config.js). Reports are emailed by Issue
// Scout's own email service; an address gets nothing until it's confirmed with an emailed code.
export default function EmailSettings() {
  const resource = useResource(() => api.email());
  if (resource.loading) return <Loading label="Loading email settings…" />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.reload} />;
  return resource.data?.available ? <Editor initial={resource.data} reload={resource.reload} /> : null;
}

function Editor({ initial, reload }: { initial: Settings; reload: () => void }) {
  const [saved, setSaved] = useState(initial);
  const [email, setEmail] = useState(initial.email);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<Action>();
  const [error, setError] = useState<{ action: Action; message: string; reload: boolean }>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const address = email.trim();
  const changed = address !== saved.email;
  const confirmed = saved.confirmed && !changed;
  const codeSent = saved.code_sent && !changed;
  const codeReady = /^\d{6}$/.test(code.replace(/\s+/g, ""));
  const hintId = useId();
  // Why the switch can't be turned on yet, in step order. Turning it off is always allowed.
  const blocker = enabled || confirmed ? "" : !address
    ? "Enter your email address first, then confirm it with the code Issue Scout emails you."
    : codeSent
      ? "Enter the 6-digit code from the email and confirm your address to turn this on."
      : "Send a confirmation code to this address and confirm it to turn this on.";
  const toggleHint = blocker
    || (enabled !== saved.enabled
      ? enabled ? "Save email settings to start getting each run’s report." : "Save email settings to stop email reports."
      : confirmed && !enabled ? "Your address is confirmed. Turn this on and save to get each run’s report." : "");

  async function act(action: Action, work: () => Promise<Email>, done: (result: Settings) => string) {
    setPending(action);
    setError(undefined);
    setFields({});
    setNotice("");
    try {
      const result = await work();
      if (!result.available) return;
      setSaved(result);
      setEmail(result.email);
      setEnabled(result.enabled);
      setCode("");
      setNotice(done(result));
    } catch (error) {
      // A changed profile.json can be reloaded; other answers explain themselves.
      setError({ action, message: errorMessage(error), reload: error instanceof ApiError && error.status === 409 && /changed on GitHub/.test(error.message) });
      if (error instanceof ApiError) setFields(error.fields);
    } finally {
      setPending(undefined);
    }
  }
  // Each action's error shows next to the control that failed.
  const failure = (action: Action) =>
    error?.action === action && <ErrorState message={error.message} retry={error.reload ? reload : undefined} />;
  const save = (event: React.FormEvent) => {
    event.preventDefault();
    void act(
      "save",
      () => api.saveEmail({ revision: saved.revision, email: address, enabled }),
      (result) => result.enabled
        ? `Email reports are on. Each run's report goes to ${result.email}.`
        : "Email reports are off. Reports and patches stay saved with each run on GitHub.",
    );
  };
  // A new address is saved (with email off, since it isn't confirmed) before the code is requested.
  const sendCode = () =>
    void act("code", async () => {
      if (changed) {
        const result = await api.saveEmail({ revision: saved.revision, email: address, enabled: false });
        if (result.available) setSaved(result);
      }
      return api.requestEmailCode();
    }, (result) => `Issue Scout is emailing a 6-digit code to ${result.email}. It usually arrives within a couple of minutes.`);
  const confirm = () =>
    void act("confirm", () => api.confirmEmail(code), () => "Address confirmed. Turn on email reports and save to start getting them.");

  return (
    <section className="panel profile-section">
      <h2>Email reports</h2>
      <p className="section-description">
        Get each run’s report and patch by email, sent by Issue Scout at no cost to you. Reports and patches are always
        saved with each run on GitHub as well.
      </p>
      {notice && (
        <div className="notice" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {!saved.ready ? (
        <p className="field-hint">
          Your Scout repository was created before email reports existed. Create a new Scout repository from the latest
          template to use them.
        </p>
      ) : (
        <form onSubmit={save} noValidate>
          <fieldset disabled={!!pending}>
            <div className="preferences-grid">
              <label className="field">
                <span>Email address</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  aria-invalid={!!fields.email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setNotice("");
                    if (event.target.value.trim() !== saved.email) setEnabled(false); // a new address needs confirming
                  }}
                />
                <span className="field-hint">
                  {confirmed ? "Confirmed." : address ? "Not confirmed yet. Issue Scout only emails reports to a confirmed address." : "Where to send your reports."}
                </span>
                {fieldErrors(fields, "email")}
              </label>
              {codeSent && (
                <label className="field">
                  <span>Confirmation code</span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    value={code}
                    aria-invalid={!!fields.code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                  <span className="field-hint">The 6-digit code from the email. It can take a couple of minutes to arrive.</span>
                  {fieldErrors(fields, "code")}
                </label>
              )}
            </div>
            {!confirmed && address && (
              <div className="card-actions">
                {codeSent && (
                  <button type="button" className="button primary" disabled={!codeReady} onClick={confirm}>
                    {pending === "confirm" ? "Confirming…" : "Confirm address"}
                  </button>
                )}
                <button type="button" className="button secondary" onClick={sendCode}>
                  {pending === "code" ? "Sending…" : codeSent ? "Send a new code" : changed ? "Save address and send a code" : "Send a confirmation code"}
                </button>
              </div>
            )}
            {failure("code")}
            {failure("confirm")}
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={enabled}
                disabled={!!blocker}
                aria-describedby={toggleHint ? hintId : undefined}
                onChange={(event) => {
                  setEnabled(event.target.checked);
                  setNotice("");
                }}
              />
              <span>Email me each run’s report</span>
            </label>
            {toggleHint && (
              <p className="field-hint checkbox-hint" id={hintId}>
                {toggleHint}
              </p>
            )}
            <div className="save-bar">
              {failure("save")}
              <span>Saved in profile.json in your Scout repository.</span>
              <div>
                <button className="button primary" type="submit">
                  <Save size={15} />
                  {pending === "save" ? "Saving…" : "Save email settings"}
                </button>
              </div>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
