import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Compass,
  FolderGit2,
  Github,
  History,
  LayoutGrid,
  LogOut,
  Moon,
  Play,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sparkles,
  Sun,
  UserRound,
} from "lucide-react";
import { api, isMock } from "./api";
import { ApiError, errorMessage } from "./errors";
import type { DemoScenario, Me } from "./types";
import { Avatar, ErrorState, JobProgress, Loading, Logo } from "./components/ui";
import Feed from "./pages/Feed";
import HistoryPage from "./pages/History";
import Onboarding from "./pages/Onboarding";
import RepositoryOnboarding from "./pages/RepositoryOnboarding";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import Runs from "./pages/Runs";
import Projects from "./pages/Projects";
import ScoutSettings, { scoutSections, type ScoutSection } from "./pages/ScoutSettings";

const navigation = [
  { route: "/", label: "Your shortlist", icon: LayoutGrid },
  { route: "/runs", label: "Runs & reports", icon: Play },
  { route: "/profile", label: "Your profile", icon: UserRound },
  { route: "/projects", label: "Your projects", icon: FolderGit2 },
  { route: "/history", label: "History", icon: History },
  {
    route: "/scout-settings",
    label: "Scout settings",
    icon: SlidersHorizontal,
  },
  { route: "/settings", label: "Account", icon: SettingsIcon },
];
// Desktop: the engine keeps no shortlist, suggestion feedback or project evidence, so those pages are demo-only.
// The desktop home is Runs & reports.
const DEMO_ONLY_ROUTES = ["/", "/projects"];
const pages = isMock ? navigation : navigation.filter((item) => !DEMO_ONLY_ROUTES.includes(item.route));
const scenarios: [DemoScenario, string][] = [
  ["ready", "Ready · daily shortlist"],
  ["signed_out", "Landing · signed out"],
  ["onboarding", "Onboarding · resume upload"],
  ["building", "Profile · building"],
  ["failure", "Profile · build failure"],
  ["empty", "Feed · no qualifying issues"],
  ["rate_limit", "Feed · refresh rate limit"],
  ["network_error", "Account · network error"],
  ["delivery_failure", "Run · email delivery failure"],
  ["abstained", "Run · no suitable issue"],
  ["run_failure", "Run · validation setup failure"],
];
const currentRoute = () => window.location.hash.replace(/^#/, "") || "/";

export default function App() {
  const [me, setMe] = useState<Me | null>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [route, setRoute] = useState(currentRoute);
  const page = !isMock && route === "/" ? "/runs" : route;
  // A run page (/runs/<id>) belongs to Runs & reports.
  const current = (route: string) => page === route || (route !== "/" && page.startsWith(route + "/"));
  // An unknown settings address opens Discovery instead of a dead end under a selected "Scout settings".
  const settingSection = scoutSections.find(item => item.path === page)
    ?? (!isMock && page.startsWith("/scout-settings/") ? scoutSections[0] : undefined);
  const pageLabel = me?.onboarding === "needs_repository" ? "Repository setup"
    : settingSection ? `Scout settings · ${settingSection.label}` : pages.find((item) => current(item.route))?.label;
  const [scenario, setScenario] = useState<DemoScenario>("ready");
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("issue-scout-theme") === "dark";
    } catch {
      return false;
    }
  });
  const lastUpload = useRef<{ file?: File } | undefined>(undefined);
  const lastRoute = useRef("");
  useEffect(() => {
    const update = () => setRoute(currentRoute());
    const accountChanged = () => setRevision((value) => value + 1);
    window.addEventListener("hashchange", update);
    window.addEventListener("issue-scout:account-changed", accountChanged);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("issue-scout:account-changed", accountChanged);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("issue-scout-theme", dark ? "dark" : "light");
    } catch {
      /* Storage can be unavailable in private browsing. */
    }
    // The window's title bar follows; it keeps its colors if this fails.
    if (!isMock) api.windowTheme(dark ? "dark" : "light").catch(() => {});
  }, [dark]);
  useEffect(() => {
    let active = true;
    setMe(undefined);
    setError("");
    api
      .me()
      .then((value) => {
        if (active) signedIn(value);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) setMe(null);
        else setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    document.title = `${me ? pageLabel || "Welcome" : "Find your next contribution"} · Issue Scout`;
    // Moving between settings sections keeps keyboard focus on the section links and the scroll position.
    const withinSettings = lastRoute.current.startsWith("/scout-settings") && route.startsWith("/scout-settings");
    lastRoute.current = route;
    if (withinSettings) return;
    document.getElementById("main-content")?.focus();
    window.scrollTo?.(0, 0);
    document.getElementById("root")?.scrollTo?.(0, 0); // with the Windows title bar, #root is what scrolls
  }, [route, me?.onboarding]);
  function signedOut() {
    setMe(null);
    lastUpload.current = undefined;
    window.location.hash = "/";
  }
  function signedIn(value: Me) {
    setError("");
    setMe(value);
    if (!isMock && value.repository && currentRoute() === "/") window.location.hash = "/runs";
  }
  function uploaded(id: string, file?: File) {
    lastUpload.current = { file };
    setMe((previous) =>
      previous ? { ...previous, onboarding: "building", job_id: id } : previous,
    );
  }
  async function retryBuild() {
    if (!lastUpload.current) {
      setMe((previous) =>
        previous
          ? { ...previous, onboarding: "needs_resume", job_id: undefined }
          : previous,
      );
      return;
    }
    try {
      uploaded(
        (await api.upload(lastUpload.current.file)).job_id,
        lastUpload.current.file,
      );
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  function demo(value: DemoScenario) {
    api.setDemo(value);
    setScenario(value);
    lastUpload.current = undefined;
    window.location.hash = [
      "delivery_failure",
      "abstained",
      "run_failure",
    ].includes(value)
      ? "/runs/run_example"
      : "/";
    setRevision((value) => value + 1);
  }
  const themeButton = (
    <button
      className="icon-button theme-toggle"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setDark((value) => !value)}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
  const demoControl = isMock && (
    <div className="demo-controls">
      <label htmlFor="demo-state">
        <span className="status-dot" />
        Preview scenarios <ChevronDown size={12} />
      </label>
      <select
        id="demo-state"
        aria-label="Preview scenario"
        value={scenario}
        onChange={(event) => demo(event.target.value as DemoScenario)}
      >
        {scenarios.map(([value, label]) => (
          <option value={value} key={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
  if (me === undefined)
    return (
      <div className="startup">
        <Logo />
        {error ? (
          <>
            <ErrorState
              message={error}
              retry={() => setRevision((value) => value + 1)}
            />
            {/* A persistent startup failure must not trap the user: let them sign out and start over. */}
            <button className="text-button" onClick={() => void api.logout().finally(signedOut)}>
              Sign out
            </button>
          </>
        ) : (
          <Loading />
        )}
        {demoControl}
      </div>
    );
  if (me === null && !isMock) return (
    <div className="desktop-signin">
      <header className="signin-header"><Logo />{themeButton}</header>
      <main id="main-content" tabIndex={-1} className="signin-layout">
        <section className="signin-copy">
          <span className="eyebrow">YOUR OPEN-SOURCE WORKSPACE</span>
          <h1>From the right issue to a reviewable fix.</h1>
          <p>Scout finds issues that fit your skills, prepares a draft and checks it in an isolated runtime. You review the evidence and decide what to contribute.</p>
          <DesktopSignIn onSignedIn={signedIn} onError={error => setError(errorMessage(error))} />
          {error && <ErrorState message={error} />}
        </section>
        <ol className="signin-steps" aria-label="Getting started">
          <li><span>01</span><div><strong>Connect your GitHub</strong><p>Sign in securely in your browser. Your credentials stay out of the interface.</p></div></li>
          <li><span>02</span><div><strong>Make Scout yours</strong><p>Create or connect a private Scout repository, set your profile and choose your models.</p></div></li>
          <li><span>03</span><div><strong>Run, inspect, contribute</strong><p>Your GitHub Actions run Scout. Reports and available patches are saved for your review.</p></div></li>
        </ol>
      </main>
      <footer className="signin-privacy">Scouting uses your GitHub Actions minutes and model credentials. Optional report emails are delivered by Issue Scout.</footer>
    </div>
  );
  if (me === null)
    return (
      <>
        <header className="landing-header">
          <Logo />
          {themeButton}
        </header>
        <main id="main-content" tabIndex={-1} className="landing-main">
          <section className="landing-copy">
            <span className="eyebrow">
              <span className="status-dot" /> BUILT FOR YOUR NEXT CONTRIBUTION
            </span>
            <h1>
              You have the skills.
              <br />
              Find where they
              <br />
              can make a <em>difference.</em>
            </h1>
            <p>
              {isMock
                ? "Find open-source issues that fit your resume, GitHub, and projects. Let your scout prepare a fix and validate it, then review the evidence and make the contribution yours."
                : "Find open-source issues that fit your skills and interests. Your scout runs in your own private GitHub repository, prepares a fix and validates it, then you review the evidence and make the contribution yours."}
            </p>
            {isMock ? (
              <button
                className="button primary login-button"
                onClick={() => {
                  void api
                    .demoLogin()
                    .then(setMe)
                    .catch((error) => setError(errorMessage(error)));
                }}
              >
                <Github size={20} />
                Sign in with GitHub
                <ArrowRight size={17} />
              </button>
            ) : (
              <DesktopSignIn
                onSignedIn={signedIn}
                onError={(error) => setError(errorMessage(error))}
              />
            )}
            <span className="landing-note">
              Your experience. A thoughtful shortlist. Your next step.
            </span>
            {error && <ErrorState message={error} />}
            <div className="landing-features">
              <span>
                <Check size={14} />
                Discover, draft & validate
              </span>
              <span>
                <Check size={14} />
                Always in your control
              </span>
            </div>
          </section>
          <div className="landing-visual">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="floating-tag tag-one">
              <span className="language-dot" />
              Python
            </div>
            <div className="floating-tag tag-two">
              <Check size={14} />
              Your kind of issue
            </div>
            <div className="landing-preview panel">
              <div className="preview-top">
                <Compass size={20} />
                <span>
                  A little less searching.
                  <br />
                  <strong>A lot more possibility.</strong>
                </span>
                <Sparkles size={20} />
              </div>
              <span className="small-caps">A MATCH THAT MAKES SENSE</span>
              <h3>Fix an async bug in a project you already know.</h3>
              <div className="fit-block">
                <span className="fit-label">✧ Why this fits you</span>
                <p>
                  Your Python experience. A clear reproducer. One focused
                  function to work on.
                </p>
              </div>
              <div className="preview-bottom">
                <span>
                  <Check size={14} />
                  Realistic scope
                </span>
                <ArrowUpRight size={19} />
              </div>
            </div>
            <span className="visual-caption">
              A few good issues can open a lot of doors.
            </span>
          </div>
        </main>
        <footer className="landing-footer">
          <span>Thoughtful matches for curious developers.</span>
          {isMock && (
            <span className="demo-note">Interactive demo · example data</span>
          )}
        </footer>
        {demoControl}
      </>
    );
  return (
    <div className={`app-shell ${isMock ? "demo-shell" : "desktop-shell"}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand-link" href="#/" aria-label="Issue Scout home">
          <Logo />
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {pages.map(({ route: href, label, icon: Icon }) => (
            <a
              key={href}
              href={`#${href}`}
              aria-label={label}
              title={label}
              className={`nav-link ${current(href) ? "active" : ""}`}
              aria-current={current(href) ? "page" : undefined}
            >
              <Icon size={18} strokeWidth={1.7} />
              <span>{label}</span>
              {current(href) && <span className="nav-active-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-message">
            <span className="little-compass">
              <Compass size={20} />
            </span>
            <p>
              Small contributions.
              <br />
              <strong>Real impact.</strong>
            </p>
          </div>
          <a className="sidebar-preferences" href="#/profile">
            <SlidersHorizontal size={14} />
            Tune your scout
            <ArrowUpRight size={13} />
          </a>
          <div className="sidebar-account">
            <span className="account-avatar">
              <Avatar url={me.avatar_url}>
                <Github size={19} />
              </Avatar>
            </span>
            <div>
              <strong title={me.login}>{me.login}</strong>
              <span title={me.repository?.full_name}>{me.repository?.full_name || "Personal workspace"}</span>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={() => {
                void api
                  .logout()
                  .then(signedOut)
                  .catch((error) => setError(errorMessage(error)));
              }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-content">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="mobile-brand">
              <Compass size={19} />
            </span>
            <span>Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>
              {pageLabel || "Welcome"}
            </strong>
          </div>
          <div className="topbar-right">
            {isMock && (
              <span className="demo-badge">
                <span className="status-dot" />
                Demo workspace
              </span>
            )}
            {themeButton}
            <span className="topbar-divider" />
            <span className="small-avatar" title={`Connected as ${me.login}`}>
              <Avatar url={me.avatar_url} alt={`Connected as ${me.login}`}>
                {me.login.slice(0, 1).toUpperCase()}
              </Avatar>
            </span>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="main-content"
          key={revision}
        >
          {error && <ErrorState message={error} retry={() => setError("")} />}
          {me.onboarding === "needs_repository" ? (
            <RepositoryOnboarding me={me} onConnected={(value) => { setMe(value); window.location.hash = "/profile"; }} />
          ) : me.onboarding === "needs_resume" ? (
            <Onboarding me={me} onUploaded={uploaded} />
          ) : me.onboarding === "building" ? (
            <div className="build-container">
              <JobProgress
                id={me.job_id || ""}
                onComplete={() => {
                  setRevision((value) => value + 1);
                  window.location.hash = "/";
                }}
                onRetry={() => void retryBuild()}
              />
            </div>
          ) : page === "/" ? (
            <Feed />
          ) : page === "/runs" || page.startsWith("/runs/") ? (
            <Runs
              id={page.startsWith("/runs/") ? page.slice(6) : undefined}
            />
          ) : page === "/projects" && isMock ? (
            <Projects />
          ) : page === "/scout-settings" || (!isMock && settingSection) ? (
            <ScoutSettings section={(settingSection?.id || "discovery") as ScoutSection} />
          ) : page === "/profile" ? (
            <Profile />
          ) : page === "/history" ? (
            <HistoryPage />
          ) : page === "/settings" ? (
            <Settings me={me} onSignedOut={signedOut} onUploaded={uploaded} onRepositoryChanged={setMe} />
          ) : (
            <div className="empty-state panel">
              <Compass size={32} />
              <h1>This trail ends here.</h1>
              <p>Let’s get you back to your next contribution.</p>
              <a className="button primary" href={isMock ? "#/" : "#/runs"}>
                {isMock ? "Back to your shortlist" : "Back to your runs"}
              </a>
            </div>
          )}
        </main>
        <footer className="app-footer">
          <span>Built for meaningful contributions.</span>
          {isMock && (
            <span>Demo data · repositories and issues are placeholders</span>
          )}
        </footer>
      </div>
      {demoControl}
    </div>
  );
}

// GitHub device sign-in: show the one-time code, then wait while the user approves in the browser.
function DesktopSignIn({
  onSignedIn,
  onError,
}: {
  onSignedIn: (me: Me) => void;
  onError: (error: unknown) => void;
}) {
  const [code, setCode] = useState<{
    user_code: string;
    verification_uri: string;
  }>();
  const signIn = async () => {
    try {
      setCode(await api.startLogin());
      onSignedIn(await api.finishLogin());
    } catch (error) {
      setCode(undefined);
      onError(error);
    }
  };
  return code ? (
    <p className="landing-note">
      Enter <strong>{code.user_code}</strong> at{" "}
      <a href={code.verification_uri} target="_blank" rel="noreferrer">
        {code.verification_uri}
      </a>
      . Waiting for GitHub…
    </p>
  ) : (
    <button
      className="button primary login-button"
      onClick={() => void signIn()}
    >
      <Github size={20} />
      Sign in with GitHub
      <ArrowRight size={17} />
    </button>
  );
}
