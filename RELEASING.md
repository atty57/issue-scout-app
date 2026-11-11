# Releasing Issue Scout for Windows

## Build

```bash
npm ci
npm test
npm run dist:win   # production renderer build, then the installer
```

Output goes to `release/` (ignored by git):

- `Issue-Scout-Setup-<version>-x64.exe`: the installer. One click, installed for the current Windows user under
  `%LOCALAPPDATA%\Programs\issue-scout-app`, with no administrator rights needed.
- `Issue-Scout-Setup-<version>-x64.exe.blockmap`: lets a later updater download only changed blocks.
- `win-unpacked/`: the packaged app without the installer, for quick checks.

Packaging uses `electron-builder` 26.18.0 (configured in `package.json`, `build`). It reuses the installed, pinned
Electron (`node_modules/electron/dist`, 44.9.3), so the Electron version always matches `package.json`.

## What the package contains

An allow-list in `build.files` puts exactly these into `app.asar`:

- `dist/`: the production renderer from `npm run build`.
- `electron/*.js` and `electron/preload.cjs`: main process and preload, without `*.test.js` or `zip-fixture.js`.
- `package.json`. electron-builder writes a trimmed copy without `devDependencies` or the build config.
- `electron/icon.png` and `THIRD_PARTY_NOTICES.md`, including Beautiful UI's MIT attribution.
- Runtime dependencies of the main process only: `libsodium-wrappers` (with `libsodium`) and `yaml`. Renderer
  libraries are dev dependencies because Vite bundles them into `dist/`.

Never included: tests and fixtures, `AGENTS.md`, `CLAUDE.md`, `plan.md`, `bugs.md`, `src/`, `out/`, `.env` files and
source maps. Check every build before sharing it:

```bash
node -e 'const a=require("@electron/asar");console.log(a.listPackage("release/win-unpacked/resources/app.asar").filter(f=>!/node_modules|assets/.test(f)).join("\n"))'
```

The app has no credentials in the package. `electron/config.js` holds only the public OAuth client ID and the relay URL.

## Security settings in the build

These Electron fuses are written into the executable at packaging time:

| Fuse | Setting | Why |
|---|---|---|
| `RunAsNode` | off | The app can't be started as a plain Node.js process |
| `EnableNodeOptionsEnvironmentVariable` | off | `NODE_OPTIONS` can't inject code into main |
| `EnableNodeCliInspectArguments` | off | `--inspect` can't attach a debugger to main, where the GitHub token lives |
| `EnableEmbeddedAsarIntegrityValidation` | on | A modified `app.asar` won't load |
| `OnlyLoadAppFromAsar` | on | Only the packaged app runs |
| `EnableCookieEncryption` | on | Cookies on disk are encrypted |

To read them back: `npx @electron/fuses read --app "release/win-unpacked/Issue Scout.exe"`.

The renderer stays sandboxed with context isolation and the single `scout:request` IPC channel (`electron/main.js`).
The GitHub token is stored only by main, encrypted with Windows DPAPI through `safeStorage`, in
`%APPDATA%\Issue Scout\github-token.bin`.

## Smoke test before sharing a build

Run the packaged app (`release/win-unpacked/Issue Scout.exe`, then the installer) and check:

1. It launches to the sign-in page. The page has only `window.scout.request`, with no `require` or `process`.
2. GitHub sign-in with the device code works, and the page never receives the token.
3. Connecting an existing Scout repository (a test account's, never the maintainer's personal one) opens the profile.
4. Scout settings load (profile, models, schedule, email), and saving unchanged settings commits nothing.
5. Runs and a run's detail load, including its saved report.
6. "Review brief" opens a save dialog and writes the report to the chosen file.
7. The installer installs silently (`Issue-Scout-Setup-<version>-x64.exe /S`), the installed app starts already signed
   in, and `Uninstall Issue Scout.exe /currentuser /S` removes the program, the shortcut and the uninstall entry.
   The app's data in `%APPDATA%\Issue Scout` is kept on uninstall. Sign out first to remove the stored token.

The 0.1.0 build passed all seven checks on 2026-11-09 with the second test account.

### Redesigned Windows UI

The Beautiful UI adaptation adds a shared visual system, outcome-first reports, run/history tables,
expandable recorded progress and separate Discovery, Models, Schedule and Email settings routes.
Settings drafts stay in memory while switching sections and are discarded on leaving settings.
No backend, GitHub credential or relay contract changes are required.

After rebuilding, repeat the smoke test above. Also check both themes, title-bar dragging and window
controls, Ctrl +/−/0, Windows display scaling, all settings sections, and shortcut/taskbar icons.
Local offscreen Electron captures in `out/redesign/` use offline fixtures; they do not verify OS window
controls, real account writes, installer integration or display scaling. These need hands-on checks.

Redesign validation (2026-11-10): 303 tests and the production/NSIS builds pass. The local evidence
checker passes with 45 renderer captures, including three screens loaded from the packaged `app.asar`.
All 19 checked packaged source/assets match the current build, the Beautiful UI notice is included,
and the configured security fuses were read back successfully. This does not replace the install/uninstall
and native-window checks above. See `out/redesign/evidence.json` and `package-check.json` for local details.

## Signing (required before public distribution)

The 0.1.0 build is **unsigned**. Windows shows "Windows protected your PC" (SmartScreen) and "Unknown publisher" for
an unsigned installer downloaded from the internet. Before public releases:

- **Certificate.** Use an Authenticode code-signing certificate issued to the publisher, or a managed service such
  as Microsoft's Trusted Signing (now called Artifact Signing), if the publisher is eligible. Since June 2023, publicly
  trusted code-signing keys must live in a hardware module or cloud HSM, so a plain `.pfx` file is no longer issued.
  Plan for a cloud-signing service or a hardware token.
- **What gets signed.** electron-builder signs `Issue Scout.exe`, the uninstaller, `elevate.exe` and the installer.
  Every one must be signed with the same publisher.
- **Configuration.** Use `win.azureSignOptions` for Trusted Signing, or a custom `win.sign` hook for another cloud
  HSM. Supply credentials through environment variables or CI secrets at build time. Never commit certificates, keys
  or passwords, and never put them in `package.json`.
- **Timestamping.** Keep the signing service's timestamp, so signatures stay valid after the certificate expires.
- **Reputation.** SmartScreen trust builds as signed downloads accumulate. Check Microsoft's current guidance on how
  certificate type affects this.

## Updates (initial strategy)

- **Now: manual.** Raise `version` in `package.json`, build, smoke-test, and publish the installer, for example as a
  GitHub Release asset, once it's reviewed. Users run the new installer over the old one. The one-click installer
  upgrades in place (same `appId`, `io.github.atty57.issuescout`) and keeps `%APPDATA%\Issue Scout`, so users stay
  signed in with the same repository. `publish` is `null` and `dist:win` passes `--publish never`, so a build never
  uploads anything.
- **Next: automatic, after signing.** Add `electron-updater` with a GitHub Releases provider (or another HTTPS feed),
  check for updates in main, and publish `latest.yml` and the `.blockmap` with each release. Do this only once builds
  are signed. On Windows, the updater checks that an update is signed by the same publisher as the installed app, and
  unsigned automatic updates would be an easy path for tampering.
- **Engine updates are separate.** The app updates itself. Each user's Scout repository keeps its own copy of the
  engine, which this app doesn't update yet (the open engine update contract).

## Known gaps in 0.1.0

- Icons come from `build/icon.svg` (the sidebar's compass mark). `build/icon.ico` (16–256 px) is the exe, installer
  and shortcut icon, and `electron/icon.png` (256 px) is the window icon; regenerate both when the logo changes. The
  app exe, window and `Issue-Scout-Setup-0.1.0-x64.exe` icons were checked (2026-11-10); the uninstaller, Start menu,
  Apps list and taskbar-pin icons need an install to check.
- x64 only.
- Reusing the local Electron also copies Electron's placeholder `default_app.asar`. It is never loaded, because
  `app.asar` exists and `OnlyLoadAppFromAsar` is on.
- Chromium's `--remote-debugging-port` switch still opens the renderer to local debugging tools. It can't reach main
  or the token, because `--inspect` is disabled.
