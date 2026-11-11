import { GitHubError, githubRequest, validRepository } from "./github.js";

// Keep in sync with the engine's settings.py; UI metadata never goes into profile.json.
const DEFAULTS = {
  updated_days: 30, search_pages: 2, candidate_limit: 30, shortlist_size: 5,
  max_comment_pages: 5, max_timeline_pages: 5, claim_days: 14, retry_days: 7,
  max_attempts: 2, min_score: 6, min_confidence: 0.7, general_issues: false,
  min_stars: 200, exclude_labels: ["good first issue"],
};
const COUNTS = ["updated_days", "search_pages", "candidate_limit", "max_comment_pages", "max_timeline_pages", "claim_days", "retry_days", "max_attempts"];
const PROFILE_FIELDS = new Set(["setup_required", "email", "email_enabled", "summary", "skills", "skill_aliases", "languages", "work_types", "labels", "documentation_labels", "watchlist", "merged_in", "days", "scouting"]);
const MAX_PROFILE_BYTES = 250000;
// Every language the app knows, as the template's workloads.py names them. Each Scout repository's own engine
// lists the ones it runs in scout.json; repositories created before that manifest run the first five.
const LANGUAGES = new Set(["python", "javascript", "typescript", "csharp", "c", "go", "rust", "java", "cpp"]);
const LANGUAGES_BEFORE_MANIFEST = ["python", "javascript", "typescript", "csharp", "c"];
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const validSha = (value) => typeof value === "string" && /^[a-f\d]{40,64}$/i.test(value);
const canonicalLanguage = (value) => ({ "c#": "csharp", "c sharp": "csharp", js: "javascript", ts: "typescript", "c++": "cpp", "c plus plus": "cpp", golang: "go" })[value.toLowerCase().trim()] || value.toLowerCase().trim();

function strings(value, key, fields, { search = false, repositories = false } = {}) {
  if (!Array.isArray(value) || value.length > 1000) { fields[key] = "Use a list of at most 1,000 values."; return; }
  value.forEach((item, index) => {
    if (typeof item !== "string" || !item.trim() || /[\x00-\x1f\x7f]/.test(item) || (search && /["\\]/.test(item)) ||
        (repositories && (!validRepository(item) || !/^[a-z\d]/i.test(item))))
      fields[`${key}.${index}`] = repositories ? "Use owner/repository without paths or URLs." : "Use nonempty text without control characters, quotes or backslashes in search labels.";
  });
}
function positive(value, key, fields, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fields[key] = `Use a whole number from 1 to ${max}.`;
}
function invalid(fields) {
  if (Object.keys(fields).length) throw new GitHubError(422, "Check the highlighted fields before saving.", fields);
}
function validateProfile(value) {
  const fields = {};
  if (!object(value)) throw new GitHubError(422, "Use a profile object.", { profile: "Reload your profile and try again." });
  if (typeof value.summary !== "string" || value.summary.length > 10000) fields.summary = "Use a summary of up to 10,000 characters.";
  for (const key of ["skills", "languages"]) {
    if (!Array.isArray(value[key]) || value[key].length > 1000) { fields[key] = "Use a list of skills or languages."; continue; }
    value[key].forEach((row, index) => {
      if (!object(row) || typeof row.value !== "string" || !row.value.trim() || /[\x00-\x1f\x7f]/.test(row.value)) fields[`${key}.${index}.value`] = "Enter a value or remove this row.";
      else if (key === "languages" && !LANGUAGES.has(row.value)) fields[`languages.${index}.value`] = "Choose a supported language.";
    });
  }
  if (!Array.isArray(value.work_types) || !value.work_types.length || value.work_types.some((item) => !["code", "documentation"].includes(item))) fields.work_types = "Choose code, documentation, or both.";
  strings(value.watchlist, "watchlist", fields, { repositories: true });
  if (!object(value.scouting)) fields.scouting = "Use scouting preferences.";
  else {
    positive(value.scouting.min_stars, "scouting.min_stars", fields);
    positive(value.scouting.shortlist_size, "scouting.shortlist_size", fields, 8);
    if (typeof value.scouting.general_issues !== "boolean") fields["scouting.general_issues"] = "Choose whether to search beyond the watchlist.";
    strings(value.scouting.exclude_labels, "scouting.exclude_labels", fields, { search: true });
  }
  invalid(fields);
}
function validateSettings(value) {
  const fields = {};
  if (!object(value)) throw new GitHubError(422, "Use a settings object.", { settings: "Reload your settings and try again." });
  positive(value.days, "days", fields, 999999999);
  for (const key of COUNTS) positive(value[key], key, fields, key === "search_pages" ? 10 : key === "updated_days" ? 999999999 : undefined);
  if (!Number.isFinite(value.min_score) || value.min_score < 0) fields.min_score = "Use a non-negative score.";
  if (!Number.isFinite(value.min_confidence) || value.min_confidence < 0 || value.min_confidence > 1) fields.min_confidence = "Use a confidence from 0 to 1.";
  strings(value.labels, "labels", fields, { search: true });
  strings(value.documentation_labels, "documentation_labels", fields, { search: true });
  if (!object(value.skill_aliases)) fields.skill_aliases = "Use an object of alias lists.";
  else for (const [key, aliases] of Object.entries(value.skill_aliases)) {
    if (!key.trim() || /[\x00-\x1f\x7f]/.test(key)) fields.skill_aliases = "Use nonempty alias names without control characters.";
    strings(aliases, "skill_aliases", fields);
  }
  for (const key of ["schedule_enabled", "draft_fixes", "email_enabled", "tracing_enabled"])
    if (value[key] !== undefined && value[key] !== false) fields[key] = "This option is not available in the desktop app yet.";
  invalid(fields);
}
function asProfile(raw, revision, updatedAt) {
  const scouting = { ...DEFAULTS, ...raw.scouting };
  return {
    summary: raw.summary ?? "",
    skills: raw.skills.map((value) => ({ value, sources: ["profile.json"], locked: true })),
    languages: raw.languages.map((value) => ({ value: canonicalLanguage(value), sources: ["profile.json"], locked: true })),
    work_types: raw.work_types ?? ["code"], watchlist: raw.watchlist, merged_in: raw.merged_in,
    scouting: Object.fromEntries(["general_issues", "min_stars", "shortlist_size", "exclude_labels"].map((key) => [key, scouting[key]])),
    updated_at: updatedAt, revision,
  };
}
function asSettings(raw, revision) {
  const scouting = { ...DEFAULTS, ...raw.scouting };
  return {
    ...Object.fromEntries([...COUNTS, "min_score", "min_confidence"].map((key) => [key, scouting[key]])),
    days: raw.days, labels: raw.labels, documentation_labels: raw.documentation_labels ?? ["documentation", "docs"],
    skill_aliases: raw.skill_aliases ?? {}, revision,
    schedule_enabled: false, schedule_time: "09:00", timezone: "UTC",
    draft_fixes: false, email_enabled: false, email: raw.email ?? "", tracing_enabled: false,
  };
}
function commitDate(commit) {
  const date = commit?.committer?.date || commit?.author?.date;
  if (typeof date !== "string" || !Number.isFinite(Date.parse(date))) throw new GitHubError(502, "GitHub returned an invalid profile commit date.");
  return date;
}

export function createProfileRoutes({ repositoryContext, fetchImpl }) {
  // Bind edits to both the selected repository/branch and the GitHub blob revision.
  const editRevision = (context, sha) => `${context.repo.id}:${encodeURIComponent(context.repo.default_branch)}:${sha}`;
  const request = (context, route, options = {}) => githubRequest(context.token, `/repos/${context.repo.full_name}${route}`, { ...options, fetchImpl });
  const commits = (context, limit) => request(context, `/commits?path=profile.json&sha=${encodeURIComponent(context.repo.default_branch)}&per_page=${limit}`);
  // The last profile.json this app wrote, keyed by its edit revision (repository, branch and blob).
  let written;
  // Revisions this app itself replaced, each pointing at the one it wrote next. Discovery, Email and Models stay
  // open together and all write profile.json, so one section's save must not make the next look like a conflict
  // from elsewhere. Each save only sets its own fields on the latest file, so nothing another section saved is lost.
  const superseded = new Map();
  function current(revision) {
    for (let hops = 0; superseded.has(revision) && hops < 100; hops++) revision = superseded.get(revision);
    return revision;
  }

  // The languages this repository's own engine runs, from its scout.json. Without a readable manifest, only the
  // languages every engine has run are offered, so a profile can't name one the engine rejects at startup.
  async function engineLanguages(context) {
    let file;
    try {
      file = await request(context, `/contents/scout.json?ref=${encodeURIComponent(context.repo.default_branch)}`);
    } catch (error) {
      if (error.status === 404) return LANGUAGES_BEFORE_MANIFEST;
      throw error;
    }
    try {
      const languages = JSON.parse(Buffer.from(file.content, "base64").toString("utf8")).languages;
      if (!Array.isArray(languages)) throw new Error();
      return [...LANGUAGES].filter((language) => languages.includes(language));
    } catch {
      return LANGUAGES_BEFORE_MANIFEST;
    }
  }

  async function read(context) {
    // Read an immutable revision so its content and last-updated date agree.
    const latest = await commits(context, 1);
    if (!Array.isArray(latest) || !validSha(latest[0]?.sha)) throw new GitHubError(502, "GitHub returned incomplete profile history.");
    const file = await request(context, `/contents/profile.json?ref=${latest[0].sha}`);
    let raw;
    try {
      if (file.type !== "file" || file.encoding !== "base64" || !validSha(file.sha) || typeof file.content !== "string" || file.content.length > 400000) throw new Error();
      const contents = Buffer.from(file.content, "base64");
      if (contents.length > MAX_PROFILE_BYTES) throw new Error();
      raw = JSON.parse(contents.toString("utf8"));
      if (!object(raw) || Object.keys(raw).some((key) => !PROFILE_FIELDS.has(key)) || (raw.scouting !== undefined && !object(raw.scouting))) throw new Error();
      for (const key of ["skills", "languages", "watchlist", "merged_in", "labels"])
        if (!Array.isArray(raw[key]) || raw[key].some((value) => typeof value !== "string")) throw new Error();
      if ((raw.email !== undefined && typeof raw.email !== "string") || (raw.email_enabled !== undefined && typeof raw.email_enabled !== "boolean")) throw new Error();
      validateProfile(asProfile(raw, file.sha, commitDate(latest[0].commit)));
      validateSettings(asSettings(raw, file.sha));
    } catch {
      throw new GitHubError(502, "Your repository's profile.json is invalid or unsupported. Review it on GitHub before saving from the app.");
    }
    context.assertCurrent();
    return { raw, revision: file.sha, updatedAt: commitDate(latest[0].commit) };
  }

  async function save(context, value, kind) {
    if (!object(value) || typeof value.revision !== "string") throw new GitHubError(409, "Reload the latest profile or settings before saving.");
    if (JSON.stringify(value).length > 250000) throw new GitHubError(422, "Your profile or settings are too large.", { profile: "Use less than 250 KB of profile data." });
    (kind === "profile" ? validateProfile : validateSettings)(value);
    const supported = kind === "profile" ? await engineLanguages(context) : undefined;
    if (supported) {
      const fields = {};
      value.languages.forEach((row, index) => {
        if (!supported.includes(row.value))
          fields[`languages.${index}.value`] = "Your Scout repository's engine doesn't run this language yet. Create a new Scout repository from the latest template to use it.";
      });
      invalid(fields);
    }
    // GitHub can serve the older file for a few seconds after this app's own write, which would make
    // a quick second save look like a conflict. Reuse that write; GitHub's sha check on PUT still
    // rejects any newer change made elsewhere.
    const basis = current(value.revision);
    const previous = written?.key === basis ? written : await read(context);
    if (editRevision(context, previous.revision) !== basis) throw new GitHubError(409, "Your profile or repository selection changed on GitHub. Reload the latest version before saving.");
    const raw = structuredClone(previous.raw);
    if (kind === "profile") {
      raw.summary = value.summary;
      raw.skills = value.skills.map((row) => row.value.trim());
      raw.languages = [...new Set(value.languages.map((row) => row.value))];
      raw.work_types = [...new Set(value.work_types)];
      raw.watchlist = [...new Set(value.watchlist)];
      raw.scouting = { ...raw.scouting, ...Object.fromEntries(["general_issues", "min_stars", "shortlist_size", "exclude_labels"].map((key) => [key, value.scouting[key]])) };
      // The engine matches labels exactly, so stray spaces would silently stop them matching.
      raw.scouting.exclude_labels = raw.scouting.exclude_labels.map((label) => label.trim());
    } else {
      for (const key of ["days", "skill_aliases"]) raw[key] = value[key];
      for (const key of ["labels", "documentation_labels"]) raw[key] = value[key].map((label) => label.trim());
      raw.scouting = { ...raw.scouting, ...Object.fromEntries([...COUNTS, "min_score", "min_confidence"].map((key) => [key, value[key]])) };
    }
    let { revision, updatedAt } = previous;
    if (JSON.stringify(raw) !== JSON.stringify(previous.raw))
      ({ revision, updatedAt } = await write(context, previous, raw, kind === "profile" ? "Issue Scout: update profile" : "Issue Scout: update scouting settings"));
    return [200, kind === "profile"
      ? { ...asProfile(raw, editRevision(context, revision), updatedAt), supported_languages: supported }
      : asSettings(raw, editRevision(context, revision))];
  }

  // Commits `raw` as profile.json on top of `previous`, which must be the file GitHub has now.
  async function write(context, previous, raw, message) {
    const contents = Buffer.from(`${JSON.stringify(raw, null, 2)}\n`, "utf8");
    if (contents.length > MAX_PROFILE_BYTES) throw new GitHubError(422, "The saved profile would exceed 250 KB. Shorten your profile or settings before saving.", { profile: "Keep the full profile file below 250 KB." });
    context.assertCurrent();
    let result;
    try {
      result = await request(context, "/contents/profile.json", {
        method: "PUT", body: { message, branch: context.repo.default_branch, sha: previous.revision, content: contents.toString("base64") },
      });
    } catch (error) {
      if (![409, 422].includes(error.status)) throw error;
      // GitHub answers 409 both for a newer file and for branch rules; only a newer file is fixed by reloading.
      const latest = error.status === 409 ? await read(context).catch(() => undefined) : undefined;
      if (latest && latest.revision !== previous.revision) throw new GitHubError(409, "Your profile changed on GitHub. Reload the latest version before saving again.");
      throw new GitHubError(422, `GitHub refused to save profile.json${error.detail ? `: ${error.detail}` : ""}. Check this repository's branch rules and your permissions.`);
    }
    context.assertCurrent();
    if (!validSha(result.content?.sha)) throw new GitHubError(502, "GitHub saved the file but returned incomplete information. Reload before saving again.");
    written = { key: editRevision(context, result.content.sha), raw, revision: result.content.sha, updatedAt: commitDate(result.commit) };
    if (superseded.size >= 100) superseded.clear(); // ponytail: forgetting only brings back the reload prompt
    superseded.set(editRevision(context, previous.revision), written.key);
    return written;
  }

  // The engine refuses every run while profile.json has `setup_required`; models being saved finishes setup.
  async function finishSetup(context) {
    const previous = await read(context);
    if (!previous.raw.setup_required) return;
    const raw = structuredClone(previous.raw);
    delete raw.setup_required;
    await write(context, previous, raw, "Issue Scout: finish setup");
  }

  // The engine's view of the profile, for checks before starting a run.
  const readProfile = async (context) => (await read(context)).raw;

  // For electron/email.js: the raw profile with an edit revision, and a revision-checked change to top-level fields
  // that keeps everything else. `message` gets the previous profile.
  async function readFields(context) {
    const value = await read(context);
    return { raw: value.raw, revision: editRevision(context, value.revision) };
  }
  async function updateFields(context, revision, change, message) {
    revision = current(revision);
    const previous = written?.key === revision ? written : await read(context);
    if (typeof revision !== "string" || editRevision(context, previous.revision) !== revision)
      throw new GitHubError(409, "Your profile changed on GitHub. Reload the latest version before saving.");
    const raw = { ...structuredClone(previous.raw), ...change };
    if (JSON.stringify(raw) === JSON.stringify(previous.raw)) return { raw, revision };
    const saved = await write(context, previous, raw, message(previous.raw));
    return { raw, revision: editRevision(context, saved.revision) };
  }

  return { finishSetup, readProfile, readFields, updateFields, routes: {
    "GET /api/profile": async () => {
      const context = await repositoryContext();
      const [value, supported] = await Promise.all([read(context), engineLanguages(context)]);
      return [200, { ...asProfile(value.raw, editRevision(context, value.revision), value.updatedAt), supported_languages: supported }];
    },
    "PUT /api/profile": async (body) => save(await repositoryContext(), body, "profile"),
    "GET /api/scout/settings": async () => {
      const context = await repositoryContext();
      const value = await read(context);
      return [200, asSettings(value.raw, editRevision(context, value.revision))];
    },
    "PUT /api/scout/settings": async (body) => save(await repositoryContext(), body, "settings"),
    "GET /api/profile/history": async () => {
      const context = await repositoryContext();
      const history = await commits(context, 30);
      context.assertCurrent();
      if (!Array.isArray(history)) throw new GitHubError(502, "GitHub returned invalid profile history.");
      return [200, history.map((entry) => {
        if (!validSha(entry.sha) || typeof entry.commit?.message !== "string") throw new GitHubError(502, "GitHub returned incomplete profile history.");
        return {
          at: commitDate(entry.commit), source: entry.author?.login === context.user.login ? "user" : "github",
          field: entry.commit.message.startsWith("Issue Scout: update scouting settings") ? "scout_settings" : "profile",
          note: entry.commit.message, commit_url: `https://github.com/${context.repo.full_name}/commit/${entry.sha}`,
        };
      })];
    },
  } };
}
