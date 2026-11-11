                                                                <img src="build/icon.svg" alt="Issue Scout compass logo" width="72" height="72">

# Issue Scout desktop

Windows desktop app for managing your private [Issue Scout](https://github.com/atty57/issue-scout-template) repository.
Sign in with GitHub, create or connect a Scout repository, configure models and discovery preferences,
schedule runs, and review reports and patches.

## For users

The intended setup is to install the Windows app, sign in with GitHub, and let it create your private Scout
repository or connect an existing one. Choose your models and supply their credentials before the first run.
You do not need to clone this source repository.

**[Download the Windows x64 installer (.exe)](https://github.com/atty57/issue-scout-app/releases/download/v0.1.0/Issue-Scout-Setup-0.1.0-x64.exe)**

[Release notes and SHA-256 checksum](https://github.com/atty57/issue-scout-app/releases/tag/v0.1.0).
This beta is unsigned: Windows may warn about an unknown publisher or block installation. macOS support is deferred.

Runs execute in your own GitHub Actions using your model credentials. You are responsible for those usage
costs. Optional email reports use the maintainer's hosted relay; the Resend API key stays on that relay.

Updates are currently manual: download a newer installer and run it over the existing installation.
Your saved account data is preserved. The app does not check for or install updates automatically.

## Future plans

- CI/CD to test, build and publish Windows releases.
- Code signing for Windows installers and update packages.
- In-app update checks and automatic (OTA) updates after code signing is established.
- Updates to the Scout engine in existing user repositories while preserving their settings and data.

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

## License

Issue Scout desktop is licensed under the [MIT License](LICENSE).
Third-party components retain their respective licenses. Beautiful UI adaptations and their MIT notice are
documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
