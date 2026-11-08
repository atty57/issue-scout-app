import { useState } from "react";
import {
  ArrowUpRight,
  FolderGit2,
  Github,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import { errorMessage } from "../errors";
import type { Project } from "../types";
import { languageNames } from "../utils";
import { ErrorState, External, Loading, useResource } from "../components/ui";

export default function Projects() {
  const resource = useResource(() => api.projects());
  return resource.loading ? (
    <Loading label="Reading your projects…" />
  ) : resource.error ? (
    <ErrorState message={resource.error} retry={resource.reload} />
  ) : resource.data ? (
    <ProjectEditor initial={resource.data} />
  ) : null;
}
function ProjectEditor({ initial }: { initial: Project[] }) {
  const [projects, setProjects] = useState(initial);
  const [repo, setRepo] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function add(event: React.FormEvent) {
    event.preventDefault();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo.trim())) {
      setError("Use owner/repository, for example octocat/my-project.");
      return;
    }
    if (
      projects.some(
        (project) => project.repo.toLowerCase() === repo.trim().toLowerCase(),
      )
    ) {
      setError("This project is already in your profile.");
      return;
    }
    setProjects((previous) => [
      ...previous,
      {
        id: `project_${Date.now()}`,
        repo: repo.trim(),
        description,
        language: "none",
        topics: [],
        use_as_evidence: true,
      },
    ]);
    setRepo("");
    setDescription("");
    setError("");
    setDirty(true);
    setNotice("");
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      setProjects(await api.saveProjects(projects));
      setDirty(false);
      setNotice(
        "Projects saved. Your selected projects will inform future profile builds and scouts.",
      );
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
          <span className="eyebrow">MORE THAN A LIST OF LANGUAGES</span>
          <h1>
            Your projects tell a story<span className="green-text">.</span>
          </h1>
          <p>
            Choose the work that should shape your profile and issue matches.
          </p>
        </div>
        <button
          className="button primary"
          disabled={!dirty || busy}
          onClick={() => void save()}
        >
          <Save size={15} />
          {busy ? "Saving…" : "Save projects"}
        </button>
      </div>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      {error && <ErrorState message={error} />}
      <div className="project-layout">
        <div className="project-list">
          {projects.length ? (
            projects.map((project) => (
              <section className="panel project-card" key={project.id}>
                <div className="project-heading">
                  <FolderGit2 size={22} />
                  <div>
                    <h2>
                      <External href={`https://github.com/${project.repo}`}>
                        {project.repo}
                        <ArrowUpRight size={13} />
                      </External>
                    </h2>
                    <p>
                      {project.description ||
                        "Your scout can use this project as evidence of your experience."}
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${project.repo}`}
                    disabled={busy}
                    onClick={() => {
                      setProjects((previous) =>
                        previous.filter((item) => item.id !== project.id),
                      );
                      setDirty(true);
                      setNotice("");
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="badges">
                  <span className={`badge language ${project.language}`}>
                    <span className="language-dot" />
                    {languageNames[project.language]}
                  </span>
                  {project.topics.map((topic) => (
                    <span className="badge" key={topic}>
                      {topic}
                    </span>
                  ))}
                </div>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={project.use_as_evidence}
                    disabled={busy}
                    onChange={(event) => {
                      setProjects((previous) =>
                        previous.map((item) =>
                          item.id === project.id
                            ? { ...item, use_as_evidence: event.target.checked }
                            : item,
                        ),
                      );
                      setDirty(true);
                      setNotice("");
                    }}
                  />
                  <span>Use this project to understand my experience</span>
                </label>
              </section>
            ))
          ) : (
            <div className="panel empty-state">
              <FolderGit2 size={30} />
              <h2>Bring your work into the picture.</h2>
              <p>
                Add a GitHub project to help your scout understand what you
                enjoy building.
              </p>
            </div>
          )}
        </div>
        <aside>
          <form className="panel profile-section" onSubmit={add}>
            <span className="small-icon">
              <Github size={18} />
            </span>
            <h2 className="add-project-title">Add a project</h2>
            <p className="section-description">
              A repository you built or contributed to. This is separate from
              the projects you want to watch for new issues.
            </p>
            <label className="field">
              <span>GitHub repository</span>
              <input
                value={repo}
                required
                disabled={busy}
                placeholder="owner/repository"
                onChange={(event) => setRepo(event.target.value)}
              />
            </label>
            <label className="field">
              <span>
                What did you work on? <span className="muted">(optional)</span>
              </span>
              <textarea
                value={description}
                maxLength={1000}
                disabled={busy}
                rows={3}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Built an async API, wrote guides…"
              />
            </label>
            <button
              type="submit"
              className="button secondary full-width"
              disabled={busy}
            >
              <Plus size={14} />
              Add to projects
            </button>
          </form>
          <div className="profile-help">
            <h3>What’s the difference?</h3>
            <p>
              <strong>Your projects</strong> help us understand your experience.
              Your <strong>watchlist</strong> tells us which repositories you
              want to contribute to next.
            </p>
            <a className="text-button" href="#/profile">
              Edit your watchlist <ArrowUpRight size={13} />
            </a>
          </div>
        </aside>
      </div>
    </>
  );
}
