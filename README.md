# Issue Scout desktop

Windows desktop app for managing your private [Issue Scout](https://github.com/atty57/issue-scout-template) repository.
Sign in with GitHub, create or connect a Scout repository, configure models and discovery preferences,
schedule runs, and review reports and patches.

## For users

The intended setup is to install the Windows app, sign in with GitHub, and let it create your private Scout
repository or connect an existing one. Choose your models and supply their credentials before the first run.
You do not need to clone this source repository.

There is no published desktop release yet. Windows x64 builds are currently unsigned and undergoing release
checks. macOS support is deferred.

Runs execute in your own GitHub Actions using your model credentials. You are responsible for those usage
costs. Optional email reports use the maintainer's hosted relay; the Resend API key stays on that relay.

## Development

Use Node.js and npm on Windows, then run:

```sh
npm ci
npm test
npm start
```

`npm run build` type-checks and builds the renderer. `npm run dist:win` builds a local Windows installer in
`release/`; it never publishes. See [RELEASING.md](RELEASING.md) for packaging and release checks.

## Structure

- `src/`: React interface and frontend tests.
- `electron/`: main process, GitHub integration, IPC transport and backend tests.
- `build/`: source icons for Windows packaging.
- [issue-scout-template](https://github.com/atty57/issue-scout-template): the separate engine and workflows
  copied into each user's private repository.

The GitHub token stays in the Electron main process and is stored through Electron's `safeStorage`.
The sandboxed renderer uses a single IPC request channel.

Beautiful UI adaptations and their MIT notice are documented in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
