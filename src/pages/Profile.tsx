import { useState } from "react";
import {
  Check,
  Clock3,
  Github,
  LockKeyhole,
  Pencil,
  Plus,
  Save,
  UnlockKeyhole,
  X,
} from "lucide-react";
import { api } from "../api";
import { ApiError, errorMessage } from "../errors";
import type { Language, Profile as ProfileType, ProfileChange } from "../types";
import { dateTime, languageNames } from "../utils";
import { profileErrors } from "../validation";
import { ErrorState, External, Loading, useResource } from "../components/ui";

export default function Profile() {
  const resource = useResource(() => api.profile());
  return resource.loading ? (
    <Loading label="Reading your profile…" />
  ) : resource.error ? (
    <ErrorState message={resource.error} retry={resource.reload} />
  ) : resource.data ? (
    <ProfileEditor initial={resource.data} />
  ) : null;
}
function ProfileEditor({ initial }: { initial: ProfileType }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<ProfileType>(structuredClone(initial));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [watchText, setWatchText] = useState(initial.watchlist.join("\n"));
  const [excludedText, setExcludedText] = useState(
    initial.scouting.exclude_labels.join(", "),
  );
  const history = useResource(() => api.profileHistory());
  const value = editing ? draft : saved;
  function begin() {
    setDraft(structuredClone(saved));
    setWatchText(saved.watchlist.join("\n"));
    setExcludedText(saved.scouting.exclude_labels.join(", "));
    setEditing(true);
    setNotice("");
    setFields({});
    setError("");
  }
  function updateScouting(key: keyof ProfileType["scouting"], value: unknown) {
    setDraft((previous) => ({
      ...previous,
      scouting: { ...previous.scouting, [key]: value },
    }));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const outgoing = {
      ...draft,
      watchlist: watchText
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
      scouting: {
        ...draft.scouting,
        exclude_labels: excludedText
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      },
    };
    const invalid = profileErrors(outgoing);
    setFields(invalid);
    setError("");
    if (Object.keys(invalid).length) {
      setError("Check the highlighted fields before saving.");
      return;
    }
    setBusy(true);
    try {
      const result = await api.saveProfile(outgoing);
      setSaved(result);
      setDraft(structuredClone(result));
      setEditing(false);
      setNotice(
        "Profile saved. Your updated preferences will guide the next scout.",
      );
      history.reload();
    } catch (error) {
      setError(errorMessage(error));
      if (error instanceof ApiError) setFields(error.fields);
    } finally {
      setBusy(false);
    }
  }
  const fieldError = (path: string) =>
    Object.entries(fields)
      .filter(([key]) => key === path || key.startsWith(`${path}.`))
      .map(([key, message]) => (
        <span className="field-error" role="alert" key={key}>
          {message}
        </span>
      ));
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE EXPERIENCE BEHIND YOUR SHORTLIST</span>
          <h1>
            Your profile, in your hands<span className="green-text">.</span>
          </h1>
          <p>See what we know, where it came from, and make it your own.</p>
        </div>
        {!editing && (
          <button className="button secondary" onClick={begin}>
            <Pencil size={15} />
            Edit profile
          </button>
        )}
      </div>
      {notice && (
        <div className="notice success-notice" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      <form onSubmit={save} noValidate>
        <fieldset disabled={busy} className="profile-fieldset">
          <div className="profile-layout">
            <div className="profile-main">
              <section className="panel profile-section">
                <div className="section-heading">
                  <h2>A little about you</h2>
                  <span className="badge">Summary</span>
                </div>
                {editing ? (
                  <label className="field">
                    <span className="sr-only">Profile summary</span>
                    <textarea
                      rows={4}
                      value={draft.summary}
                      aria-invalid={!!fields.summary}
                      onChange={(event) =>
                        setDraft({ ...draft, summary: event.target.value })
                      }
                    />
                    {fieldError("summary")}
                  </label>
                ) : (
                  <p className="profile-summary">
                    {value.summary ||
                      "Add a summary to tell your scout about your experience."}
                  </p>
                )}
              </section>
              <section className="panel profile-section">
                <h2>Skills & experience</h2>
                <p className="section-description">
                  A source for every skill. A lock for the ones you want to
                  keep.
                </p>
                <div className="sourced-list">
                  {value.skills.map((skill, index) => (
                    <div className="sourced-row" key={index}>
                      <div className="sourced-value">
                        {editing ? (
                          <label className="field">
                            <span className="sr-only">Skill {index + 1}</span>
                            <input
                              value={skill.value}
                              aria-invalid={!!fields[`skills.${index}.value`]}
                              onChange={(event) =>
                                setDraft((previous) => ({
                                  ...previous,
                                  skills: previous.skills.map((item, i) =>
                                    i === index
                                      ? {
                                          ...item,
                                          value: event.target.value,
                                          sources: [
                                            ...new Set([
                                              ...item.sources,
                                              "user",
                                            ]),
                                          ],
                                          locked: true,
                                        }
                                      : item,
                                  ),
                                }))
                              }
                            />
                            {fieldError(`skills.${index}`)}
                          </label>
                        ) : (
                          <strong>{skill.value}</strong>
                        )}
                        <Sources values={skill.sources} />
                      </div>
                      <div className="source-actions">
                        {skill.locked && (
                          <span className="locked-label">
                            <LockKeyhole size={12} />
                            Locked
                          </span>
                        )}
                        {editing && (
                          <>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`${skill.locked ? "Allow automatic updates for" : "Lock"} skill ${index + 1}`}
                              title={
                                skill.locked
                                  ? "Allow automatic updates"
                                  : "Keep this skill"
                              }
                              onClick={() =>
                                setDraft((previous) => ({
                                  ...previous,
                                  skills: previous.skills.map((item, i) =>
                                    i === index
                                      ? { ...item, locked: !item.locked }
                                      : item,
                                  ),
                                }))
                              }
                            >
                              {skill.locked ? (
                                <UnlockKeyhole size={15} />
                              ) : (
                                <LockKeyhole size={15} />
                              )}
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`Remove skill ${index + 1}`}
                              onClick={() =>
                                setDraft((previous) => ({
                                  ...previous,
                                  skills: previous.skills.filter(
                                    (_, i) => i !== index,
                                  ),
                                }))
                              }
                            >
                              <X size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {editing && (
                  <button
                    type="button"
                    className="text-button add-row"
                    onClick={() =>
                      setDraft((previous) => ({
                        ...previous,
                        skills: [
                          ...previous.skills,
                          { value: "", sources: ["user"], locked: true },
                        ],
                      }))
                    }
                  >
                    <Plus size={14} />
                    Add skill
                  </button>
                )}
                {fieldError("skills")}
              </section>
              <section className="panel profile-section">
                <h2>Languages</h2>
                <p className="section-description">
                  The ecosystems you feel comfortable contributing to.
                </p>
                <div className="sourced-list">
                  {value.languages.map((language, index) => (
                    <div className="sourced-row" key={index}>
                      <div className="sourced-value">
                        {editing ? (
                          <label className="field">
                            <span className="sr-only">
                              Language {index + 1}
                            </span>
                            <select
                              value={language.value}
                              aria-invalid={
                                !!fields[`languages.${index}.value`]
                              }
                              onChange={(event) =>
                                setDraft((previous) => ({
                                  ...previous,
                                  languages: previous.languages.map(
                                    (item, i) =>
                                      i === index
                                        ? {
                                            ...item,
                                            value: event.target
                                              .value as Language,
                                            sources: [
                                              ...new Set([
                                                ...item.sources,
                                                "user",
                                              ]),
                                            ],
                                            locked: true,
                                          }
                                        : item,
                                  ),
                                }))
                              }
                            >
                              {Object.entries(languageNames)
                                .filter(([key]) => key !== "none")
                                .map(([key, label]) => (
                                  <option key={key} value={key}>
                                    {label}
                                  </option>
                                ))}
                            </select>
                          </label>
                        ) : (
                          <strong>{languageNames[language.value]}</strong>
                        )}
                        <Sources values={language.sources} />
                      </div>
                      <div className="source-actions">
                        {language.locked && (
                          <span className="locked-label">
                            <LockKeyhole size={12} />
                            Locked
                          </span>
                        )}
                        {editing && (
                          <>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`${language.locked ? "Allow automatic updates for" : "Lock"} language ${index + 1}`}
                              onClick={() =>
                                setDraft((previous) => ({
                                  ...previous,
                                  languages: previous.languages.map(
                                    (item, i) =>
                                      i === index
                                        ? { ...item, locked: !item.locked }
                                        : item,
                                  ),
                                }))
                              }
                            >
                              {language.locked ? (
                                <UnlockKeyhole size={15} />
                              ) : (
                                <LockKeyhole size={15} />
                              )}
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`Remove language ${index + 1}`}
                              onClick={() =>
                                setDraft((previous) => ({
                                  ...previous,
                                  languages: previous.languages.filter(
                                    (_, i) => i !== index,
                                  ),
                                }))
                              }
                            >
                              <X size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {editing && (
                  <button
                    type="button"
                    className="text-button add-row"
                    onClick={() =>
                      setDraft((previous) => ({
                        ...previous,
                        languages: [
                          ...previous.languages,
                          { value: "python", sources: ["user"], locked: true },
                        ],
                      }))
                    }
                  >
                    <Plus size={14} />
                    Add language
                  </button>
                )}
                {fieldError("languages")}
              </section>
              <section className="panel profile-section">
                <h2>Your kind of contribution</h2>
                <p className="section-description">
                  Choose the work you’d like to see in your shortlist.
                </p>
                {editing ? (
                  <div className="check-options">
                    {(["code", "documentation"] as const).map((type) => (
                      <label key={type}>
                        <input
                          type="checkbox"
                          checked={draft.work_types.includes(type)}
                          aria-invalid={!!fields.work_types}
                          onChange={(event) =>
                            setDraft((previous) => ({
                              ...previous,
                              work_types: event.target.checked
                                ? [...previous.work_types, type]
                                : previous.work_types.filter(
                                    (item) => item !== type,
                                  ),
                            }))
                          }
                        />
                        <span>
                          {type === "code" ? "Code" : "Documentation"}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="badges">
                    {value.work_types.map((type) => (
                      <span className="badge" key={type}>
                        {type === "code" ? "Code" : "Documentation"}
                      </span>
                    ))}
                  </div>
                )}
                {fieldError("work_types")}
              </section>
              <section className="panel profile-section">
                <h2>Repositories on your radar</h2>
                <p className="section-description">
                  We give your watchlist extra attention.
                </p>
                {editing ? (
                  <label className="field">
                    <span>Watchlist · one owner/repository per line</span>
                    <textarea
                      rows={4}
                      value={watchText}
                      aria-invalid={Object.keys(fields).some((key) =>
                        key.startsWith("watchlist"),
                      )}
                      onChange={(event) => setWatchText(event.target.value)}
                    />
                    {fieldError("watchlist")}
                  </label>
                ) : (
                  <ul className="repo-list">
                    {value.watchlist.map((repo) => (
                      <li key={repo}>
                        <Github size={15} />
                        <External href={`https://github.com/${repo}`}>
                          {repo}
                        </External>
                      </li>
                    ))}
                    {!value.watchlist.length && (
                      <li className="muted">No watchlist repositories yet.</li>
                    )}
                  </ul>
                )}
                <div className="mini-divider" />
                <h3>
                  Already contributed to{" "}
                  <span className="badge">From GitHub · read only</span>
                </h3>
                <ul className="repo-list">
                  {value.merged_in.map((repo) => (
                    <li key={repo}>
                      <Check size={15} />
                      <External href={`https://github.com/${repo}`}>
                        {repo}
                      </External>
                    </li>
                  ))}
                  {!value.merged_in.length && (
                    <li className="muted">
                      Your merged contributions will appear here.
                    </li>
                  )}
                </ul>
              </section>
              <section className="panel profile-section">
                <h2>Scouting preferences</h2>
                <p className="section-description">
                  A few boundaries help us find better matches.
                </p>
                <div className="preferences-grid">
                  <label className="field">
                    <span>Minimum repository stars</span>
                    {editing ? (
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={
                          Number.isNaN(draft.scouting.min_stars)
                            ? ""
                            : draft.scouting.min_stars
                        }
                        aria-invalid={!!fields["scouting.min_stars"]}
                        onChange={(event) =>
                          updateScouting(
                            "min_stars",
                            event.target.valueAsNumber,
                          )
                        }
                      />
                    ) : (
                      <strong>{value.scouting.min_stars}</strong>
                    )}
                    {fieldError("scouting.min_stars")}
                  </label>
                  <label className="field">
                    <span>Shortlist size</span>
                    {editing ? (
                      <input
                        type="number"
                        min={1}
                        max={8}
                        step={1}
                        value={
                          Number.isNaN(draft.scouting.shortlist_size)
                            ? ""
                            : draft.scouting.shortlist_size
                        }
                        aria-invalid={!!fields["scouting.shortlist_size"]}
                        onChange={(event) =>
                          updateScouting(
                            "shortlist_size",
                            event.target.valueAsNumber,
                          )
                        }
                      />
                    ) : (
                      <strong>
                        Up to {value.scouting.shortlist_size} issues
                      </strong>
                    )}
                    {fieldError("scouting.shortlist_size")}
                  </label>
                </div>
                <label className="checkbox-field">
                  <input
                    disabled={!editing}
                    type="checkbox"
                    checked={value.scouting.general_issues}
                    onChange={(event) =>
                      updateScouting("general_issues", event.target.checked)
                    }
                  />
                  <span>Look beyond my watchlist</span>
                </label>
                {editing ? (
                  <label className="field">
                    <span>Exclude labels · separated by commas</span>
                    <input
                      value={excludedText}
                      onChange={(event) => setExcludedText(event.target.value)}
                    />
                    {fieldError("scouting.exclude_labels")}
                  </label>
                ) : (
                  <div className="field">
                    <span>Excluded labels</span>
                    <div className="badges">
                      {value.scouting.exclude_labels.map((label) => (
                        <span className="badge" key={label}>
                          {label}
                        </span>
                      ))}
                      {!value.scouting.exclude_labels.length && (
                        <span className="muted">None</span>
                      )}
                    </div>
                  </div>
                )}
                {fieldError("scouting")}
              </section>
            </div>
            <aside className="profile-aside">
              <div className="profile-help">
                <LockKeyhole size={20} />
                <h3>You have the final say.</h3>
                <p>
                  Editing a skill or language locks it. Automatic updates won’t
                  overwrite locked items. You can allow updates again at any
                  time.
                </p>
                <p className="field-hint">
                  Last updated {dateTime(saved.updated_at)}
                </p>
              </div>
              <section className="panel change-history">
                <div className="aside-heading">
                  <Clock3 size={17} />
                  <h2>Profile change history</h2>
                </div>
                <p className="section-description">
                  What changed, when, and why.
                </p>
                {history.loading ? (
                  <Loading label="Loading changes…" />
                ) : history.error ? (
                  <ErrorState message={history.error} retry={history.reload} />
                ) : history.data?.length ? (
                  <ol className="timeline">
                    {history.data.map((change, index) => (
                      <Change key={`${change.at}-${index}`} change={change} />
                    ))}
                  </ol>
                ) : (
                  <p className="muted">
                    Changes will appear as your profile evolves.
                  </p>
                )}
              </section>
            </aside>
          </div>
          {editing && (
            <div className="save-bar">
              {error && <ErrorState message={error} />}
              <span>Changes are saved only when you’re ready.</span>
              <div>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setEditing(false);
                    setError("");
                    setFields({});
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="button primary">
                  <Save size={15} />
                  {busy ? "Saving…" : "Save profile"}
                </button>
              </div>
            </div>
          )}
        </fieldset>
      </form>
    </>
  );
}
function Sources({ values }: { values: string[] }) {
  return (
    <div className="source-chips">
      <span>From</span>
      {values.map((source) => (
        <span key={source} className="source-chip">
          {source === "github" ? "GitHub" : source}
        </span>
      ))}
    </div>
  );
}
function Change({ change }: { change: ProfileChange }) {
  return (
    <li>
      <div className="timeline-top">
        <span className="badge">{change.source}</span>
        <time dateTime={change.at}>{dateTime(change.at)}</time>
      </div>
      <strong>{change.field.replaceAll("_", " ")} updated</strong>
      {change.note && <p>{change.note}</p>}
      <details>
        <summary>See change</summary>
        <div className="change-values">
          <span>Before</span>
          <pre>{JSON.stringify(change.before, null, 2)}</pre>
          <span>After</span>
          <pre>{JSON.stringify(change.after, null, 2)}</pre>
        </div>
      </details>
    </li>
  );
}
