import { useState } from "react";
import { Check, Save } from "lucide-react";
import { api } from "../api";
import { ApiError, errorMessage } from "../errors";
import type { ModelAuth, ModelProvider, ModelSettings as Models, ModelStageUpdate } from "../types";
import { ErrorState, Loading, fieldErrors, useResource } from "../components/ui";

type Role = "picker" | "solver";
const STAGES: [Role, string, string][] = [
  ["picker", "Issue picking", "Reads the shortlist and picks the strongest issue for you, or none."],
  ["solver", "Fix drafting", "Drafts a fix for the picked issue and validates it."],
];
const AUTH_LABELS: Record<ModelAuth, string> = { "api-key": "API key", subscription: "Subscription (OAuth token)" };

// Same rule as credentialName in electron/models.js: a stage's own SCOUT_<ROLE>_API_KEY wins for API keys.
function credentialName(role: Role, stage: ModelStageUpdate, provider: ModelProvider, secrets: string[]) {
  const own = `SCOUT_${role.toUpperCase()}_API_KEY`;
  return stage.auth === "api-key" && secrets.includes(own) ? own : provider.credentials[stage.auth] ?? "";
}
const editable = (models: Models) => ({
  picker: { ...models.picker, key: "" },
  solver: { ...models.solver, key: "" },
});

// Desktop only: models live in the Scout repository as Actions variables, keys as encrypted secrets.
export default function ModelSettings() {
  const resource = useResource(() => api.models());
  return resource.loading ? (
    <Loading label="Loading models…" />
  ) : resource.error ? (
    <ErrorState message={resource.error} retry={resource.reload} />
  ) : resource.data ? (
    <Editor initial={resource.data} />
  ) : null;
}

function Editor({ initial }: { initial: Models }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => editable(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const update = (role: Role, change: Partial<ModelStageUpdate>) => {
    setDraft((previous) => ({ ...previous, [role]: { ...previous[role], ...change } }));
    setNotice("");
  };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setFields({});
    setNotice("");
    try {
      const result = await api.saveModels(draft);
      setSaved(result);
      setDraft(editable(result));
      setNotice("Models saved. Your keys are stored as encrypted secrets in your Scout repository.");
    } catch (error) {
      setError(errorMessage(error));
      if (error instanceof ApiError) setFields(error.fields);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel profile-section">
      <h2>Models</h2>
      <p className="section-description">
        Choose a model for each stage. Runs use your own API keys or subscription. Keys are saved as
        encrypted secrets in your Scout repository and can’t be read back, even by this app.
      </p>
      {notice && (
        <div className="notice" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      <form onSubmit={save} noValidate>
        <fieldset disabled={busy}>
          {STAGES.map(([role, title, hint]) => {
            const stage = draft[role];
            const provider = saved.providers.find((item) => item.id === stage.provider) ?? saved.providers[0];
            const auths = Object.keys(provider.credentials) as ModelAuth[];
            const credential = credentialName(role, stage, provider, saved.secrets);
            const hasKey = saved.secrets.includes(credential);
            const keyLabel = stage.auth === "subscription" ? `${provider.label} OAuth token` : `${provider.label} API key`;
            return (
              <div key={role}>
                <h3>{title}</h3>
                <p className="field-hint">{hint}</p>
                <div className="preferences-grid">
                  <label className="field">
                    <span>{title} provider</span>
                    <select
                      value={provider.id}
                      onChange={(event) => {
                        const next = saved.providers.find((item) => item.id === event.target.value) ?? provider;
                        update(role, { provider: next.id, auth: Object.keys(next.credentials)[0] as ModelAuth, model: "", base_url: "" });
                      }}
                    >
                      {saved.providers.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    {fieldErrors(fields, `${role}.provider`)}
                  </label>
                  {auths.length > 1 && (
                    <label className="field">
                      <span>{title} sign-in</span>
                      <select value={stage.auth} onChange={(event) => update(role, { auth: event.target.value as ModelAuth })}>
                        {auths.map((auth) => (
                          <option key={auth} value={auth}>
                            {AUTH_LABELS[auth]}
                          </option>
                        ))}
                      </select>
                      {fieldErrors(fields, `${role}.auth`)}
                    </label>
                  )}
                  <label className="field">
                    <span>{title} model{provider.model === "optional" ? " · optional" : ""}</span>
                    <input value={stage.model} placeholder={provider.model_hint} onChange={(event) => update(role, { model: event.target.value })} />
                    {fieldErrors(fields, `${role}.model`)}
                  </label>
                  {provider.base_url && (
                    <label className="field">
                      <span>{title} endpoint URL</span>
                      <input type="url" value={stage.base_url} placeholder="https://api.example.com/v1" onChange={(event) => update(role, { base_url: event.target.value })} />
                      {fieldErrors(fields, `${role}.base_url`)}
                    </label>
                  )}
                  <label className="field">
                    <span>{keyLabel}</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={stage.key}
                      placeholder={hasKey ? "Saved · leave blank to keep it" : ""}
                      onChange={(event) => update(role, { key: event.target.value })}
                    />
                    <span className="field-hint">
                      {hasKey ? `Saved as ${credential}.` : stage.auth === "subscription" ? "Run claude setup-token to create one." : `Will be saved as ${credential}.`}
                    </span>
                    {fieldErrors(fields, `${role}.key`)}
                  </label>
                </div>
              </div>
            );
          })}
          <div className="save-bar">
            {error && <ErrorState message={error} />}
            <span>Two stages on the same provider share one key.</span>
            <div>
              <button className="button primary" type="submit">
                <Save size={15} />
                {busy ? "Saving…" : "Save models"}
              </button>
            </div>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
