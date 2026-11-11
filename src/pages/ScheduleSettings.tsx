import { useMemo, useState } from "react";
import { Check, Save } from "lucide-react";
import { api } from "../api";
import { ApiError, errorMessage } from "../errors";
import { daylightSavingNotes } from "../schedule";
import type { Schedule } from "../types";
import { ErrorState, Loading, fieldErrors, useResource } from "../components/ui";

// Desktop only: the daily run lives in the Scout repository's daily.yml, so GitHub starts it even when this app is closed.
export default function ScheduleSettings({ setupFinished = false }: { setupFinished?: boolean }) {
  const resource = useResource(() => api.schedule());
  return resource.loading ? (
    <Loading label="Loading your schedule…" />
  ) : resource.error ? (
    <ErrorState message={resource.error} retry={resource.reload} />
  ) : resource.data ? (
    <Editor initial={resource.data} reload={resource.reload} setupFinished={setupFinished} />
  ) : null;
}

function Editor({ initial, reload, setupFinished }: { initial: Schedule; reload: () => void; setupFinished: boolean }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; reload: boolean }>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  // This machine's IANA zones; keep a saved zone that isn't among them visible, so the select shows what's set.
  const zones = useMemo(() => {
    const known = ["UTC", ...Intl.supportedValuesOf("timeZone")];
    return known.includes(saved.timezone) ? known : [saved.timezone, ...known];
  }, [saved.timezone]);
  const notes = useMemo(
    () => (draft.enabled ? daylightSavingNotes(draft.time, draft.timezone) : []),
    [draft.enabled, draft.time, draft.timezone],
  );
  const update = (change: Partial<Schedule>) => {
    setDraft((previous) => ({ ...previous, ...change }));
    setNotice("");
  };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setFields({});
    setNotice("");
    try {
      const result = await api.saveSchedule({ revision: saved.revision, enabled: draft.enabled, time: draft.time, timezone: draft.timezone });
      setSaved(result);
      setDraft(result);
      setNotice(
        result.enabled
          ? `Saved. GitHub starts your scout at ${result.time} (${result.timezone}) every day, even when this app is closed.`
          : "Saved. Daily runs are off. You can still start a scout from Runs.",
      );
    } catch (error) {
      // A 409 means daily.yml or setup changed elsewhere; reloading shows the current state.
      setError({ message: errorMessage(error), reload: error instanceof ApiError && error.status === 409 });
      if (error instanceof ApiError) setFields(error.fields);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel profile-section">
      <h2>Your daily scout</h2>
      <p className="section-description">
        GitHub runs Scout in your repository at this time every day, and keeps it at this local time when
        clocks change for daylight saving. You can still start a scout yourself from Runs.
      </p>
      {notice && (
        <div className="notice" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      <form onSubmit={save} noValidate>
        <fieldset disabled={busy}>
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.enabled} onChange={(event) => update({ enabled: event.target.checked })} />
            <span>Run my scout automatically every day</span>
          </label>
          {saved.setup_required && !setupFinished && (
            <p className={saved.enabled ? "field-error" : "field-hint"} role={saved.enabled ? "alert" : undefined}>
              {saved.enabled
                ? "Setup isn't finished, so each scheduled run stops at once. Save a model and key for both stages in Models, or turn daily runs off."
                : "Finish setup first: save a model and key for both stages in Models. Until then, Scout runs only when you start it."}
            </p>
          )}
          {saved.custom && (
            <p className="field-hint">
              Your daily.yml has a schedule this app can’t show, such as several times or only some weekdays. Saving here replaces it.
            </p>
          )}
          <div className="preferences-grid">
            <label className="field">
              <span>Daily run time</span>
              <input type="time" value={draft.time} disabled={!draft.enabled} aria-invalid={!!fields.time} onChange={(event) => update({ time: event.target.value })} />
              {fieldErrors(fields, "time")}
            </label>
            <label className="field">
              <span>Time zone</span>
              <select value={draft.timezone} disabled={!draft.enabled} aria-invalid={!!fields.timezone} onChange={(event) => update({ timezone: event.target.value })}>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              {fieldErrors(fields, "timezone")}
            </label>
          </div>
          {notes.map((note) => (
            <p className="field-hint" key={note}>
              Daylight saving: {note}
            </p>
          ))}
          {draft.enabled && (
            <p className="field-hint">GitHub can start scheduled runs late when it’s busy, most often on the hour.</p>
          )}
          <div className="save-bar">
            {error && <ErrorState message={error.message} retry={error.reload ? reload : undefined} />}
            <span>Saved to .github/workflows/daily.yml in your Scout repository.</span>
            <div>
              <button className="button primary" type="submit">
                <Save size={15} />
                {busy ? "Saving…" : "Save schedule"}
              </button>
            </div>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
