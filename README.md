# Hearth

A simple, open-source hosting dashboard built around HestiaCP. A home for your websites, without the busywork.

**Version 0.2 is a local alpha:** a four-step demo wizard, Hestia website/backup listing, and an experimental real WordPress installation flow. Live installation is opt-in and has not yet been verified against a real Hestia server. Hearth is an independent project, not an official HestiaCP product.

## Try it

Install Node.js 22.9 or newer, then run:

```sh
npm start
```

Open **http://localhost:4317**. There are no dependencies to install and no account required. Without Hestia settings, Hearth opens in demo mode. Demo progress is explicitly labeled and never changes a server.

## Keep it simple

- Websites, Backups, Server, and Settings.
- Four steps: check server, name website, create login, launch.
- Sensible defaults, input validation, password generation, and resumable drafts.
- Clearly explained DNS waiting and progress that survives a browser reload.
- Visit website and WordPress admin links after installation verification.

## Connect Hestia and install WordPress

Copy `.env.example` to `.env` and complete the panel URL, hosting username, access key, and secret key. Configure limited API permissions and allow Hearth’s IP in Hestia. The read-only features work without enabling installation.

For live installs, also configure the server’s website IPv4 and installed PHP version and set `HEARTH_INSTALL_ENABLED=true`. Restart Hearth and check Server → Check connection. Use a test server and spare domain for the first installation.

**[Read the real installation setup and recovery guide](docs/real-installs.md)** before enabling this experimental feature. It covers permissions, DNS, certificates, compatibility, checkpoints, and how to inspect a partial installation.

Hearth uses Hestia’s own WordPress Quick Install CLI for software and database setup. It waits for direct IPv4 DNS, refuses existing domains, establishes HTTPS, installs WordPress, and verifies the site before reporting success. If the outcome of a write is uncertain, Hearth stops for inspection instead of replaying installation or deleting resources.

## Current boundaries

This is a local, single-operator alpha. It listens on `127.0.0.1`, restricts Host/Origin, protects installation requests with a startup token, and keeps API keys in the local server environment. **Do not expose it through a public proxy.** Remote authentication and multi-user authorization are not implemented. Keep one running instance per data folder.

Live installation currently requires direct IPv4 DNS without a DNS proxy or AAAA record. It creates a single root-domain site without a `www` alias. Backups, migrations, staging, email configuration, and automatic recovery of partial installs are outside this release.

Passwords stay in memory and are sent only for an installation. Non-secret progress, including administrator email and username, is stored in the local `.hearth` folder. Preserve it to retain duplicate-install protection. Browser demo sites and drafts can be cleared in Settings. Real job records and sites are unaffected by clearing demo data.

The backend and failure paths are covered by automated tests with simulated Hestia responses. Browser QA covers DNS waiting, reload, retry, completion, and dashboard actions using a simulated server. A real Hestia end-to-end test remains outstanding.

## Development

```sh
npm run check
npm test
```

Uses native Node.js HTTP/fetch and browser JavaScript; no build step or package installation. `public/` contains the UI, `server.mjs` serves the local app, `hestia.mjs` handles Hestia requests, and `install.mjs` handles installation jobs and verification.

See [the wizard plan](docs/wizard.md) and [real install guide](docs/real-installs.md).

## License

Hearth’s original code is **GPL-3.0-or-later**; see [LICENSE](LICENSE). HestiaCP is a separate GPLv3 project. No Hestia source code is bundled here.
