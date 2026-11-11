# Hearth

A simple, open-source hosting dashboard built around HestiaCP. A home for your websites, without the busywork.

**Version 0.1 is a local alpha:** a working demo wizard and a read-only Hestia connector. It does not install WordPress or modify a server yet. Hearth is an independent project, not an official HestiaCP product.

## Try it

Install Node.js 22.9 or newer, then run:

```sh
npm start
```

Open **http://localhost:4317**. There are no dependencies to install and no account required. Without Hestia settings, Hearth opens in demo mode.

## What works

- Websites, Backups, Server, and Settings screens, responsive on mobile.
- Four-step demo wizard: check server, name website, create login, launch.
- Domain and login validation, password generation, and duplicate-domain checks.
- Resumable non-secret drafts and demo websites in browser storage. Passwords stay in memory and are never saved or sent to the backend.
- Clearly labeled simulated progress and completion. Demo sites do not open nonexistent websites or admin pages.
- Optional real Hestia connection checks, website listing, and account backup listing.
- Links to manage real hosted websites in Hestia. Hosted domains are not assumed to be WordPress installations.

## Connect an existing Hestia server

1. Copy `.env.example` to `.env`.
2. Enter the HTTPS panel URL, Hestia username, access key, and secret key.
3. Grant the key only `v-list-web-domains` and `v-list-user-backups` for the intended account. Allow Hearth's server IP in Hestia's API settings.
4. Run `npm start` again, then open **Server → Check connection**.

Secrets remain in the local server environment; `.env` is ignored by Git. Use a trusted HTTPS certificate, or configure Node's trusted CA mechanism for your own CA. Certificate validation remains enabled. API requests have a ten-second timeout and do not follow redirects.

The connector follows Hestia's [access-key API](https://hestiacp.com/docs/server-administration/rest-api) and [API request format](https://hestiacp.com/docs/reference/api). Backup listing uses the documented [CLI commands](https://hestiacp.com/docs/reference/cli). Protocol behavior is tested with simulated responses; a real Hestia server has not yet been tested.

## Scope and safety

This alpha listens only on `127.0.0.1`. Host and origin checks restrict access to its local URL. It has no remote authentication layer: do not expose it through a public proxy or change it to listen on the network. Hestia access is read-only. No arbitrary command or server-address endpoint is exposed to the browser.

Live installation is intentionally disabled until provisioning, retries, DNS, HTTPS, and WordPress verification can be tested together on a disposable Hestia server. Demo progress is not evidence of installation. Reported backup files are not verified restore points.

Demo site metadata and drafts belong to one browser. Use **Settings → Clear demo data** to remove them. This is not a multi-user or production panel yet.

## Development

```sh
npm run check
npm test
```

Uses native Node.js HTTP and fetch APIs and browser JavaScript. No build step or package installation is needed. `public/` contains the UI; `server.mjs` serves it and limits API routes; `hestia.mjs` contains the read-only adapter.

## Next milestone

Verify the connector on a test Hestia server, then implement one real journey: create a WordPress site, verify DNS and HTTPS, and open its working admin page. See [the wizard plan](docs/wizard.md).

## License

Hearth's original code is licensed under **GPL-3.0-or-later**; see [LICENSE](LICENSE). HestiaCP is a separate GPLv3 project. No Hestia source code is bundled here.
