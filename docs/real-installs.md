# Real WordPress installations

Version 0.2 adds an experimental live installation path. The implementation follows Hestia’s current Quick Install CLI and access-key API. Automated tests and browser tests use simulated Hestia/DNS/TLS responses. A real Hestia end-to-end installation has not yet been verified.

## Before the first test

Use an existing Hestia test server and a spare domain. Hestia must have its WordPress Quick Install application, a compatible PHP version, a database server, and working outbound downloads. Public ports 80 and 443 must reach the website server. Its panel must have a trusted HTTPS certificate.

Use an ordinary Hestia hosting account for the website. Create a dedicated API key permitting only:

- `v-list-web-domains`
- `v-list-user-backups`
- `v-add-web-domain`
- `v-add-letsencrypt-domain`
- `v-quick-install-app`
- `v-add-web-domain-ssl-force`

Some Hestia versions cannot scope Quick Install to a non-admin key. If your server refuses that command, use a dedicated **admin-owned, command-limited access key** for the test while keeping `HESTIA_USER` set to the intended hosting account. Do not grant unrestricted `*` permissions. Add only the IP of the computer running Hearth to the API allowlist.

## Local configuration

Copy `.env.example` to `.env`. Complete the four connection settings, then set:

```dotenv
HEARTH_INSTALL_ENABLED=true
HESTIA_SITE_IP=your-website-server-ipv4
HESTIA_PHP_VERSION=8.3
```

Use the actual IPv4 address assigned to websites in Hestia and a PHP version installed on that server and supported by its WordPress installer. `8.3` is an example, not a version installed by Hearth. Keep all credentials in `.env`, never in chat, screenshots, or Git.

Run one Hearth instance for this server/data folder:

```sh
npm start
```

Open `http://localhost:4317`. Check the connection under Server, then choose New website. Live installation is explicitly labeled before the final action.

## Domain connection

The first implementation supports direct IPv4 DNS. Set the domain’s A record to `HESTIA_SITE_IP`. Remove conflicting A records and AAAA records and disable any DNS proxy for the test. Hearth does not create DNS zones or change registrar records. It creates no `www` alias; add aliases later through Hestia.

If DNS is not ready, the wizard shows the required record and waits **without changing the server**. After updating DNS, continue with the same installation record and re-enter the password. DNS is checked again at completion. A matching DNS result is a local resolver observation, not a guarantee of worldwide propagation; certificate issuance is a further check.

## Installation sequence

1. Check DNS and refuse existing domains in the Hestia account.
2. Create the web domain at the configured server IP, without aliases.
3. Request HTTPS through Hestia’s Let’s Encrypt integration.
4. Verify the domain’s HTTPS certificate before transmitting the WordPress administrator password to the installer.
5. Call `v-quick-install-app install USER DOMAIN WordPress` with separate options for site name, username, password, email, root directory, language, PHP version, and automatic database creation. Hestia downloads WordPress and creates the database.
6. Enable HTTPS redirection.
7. Verify the home page, WordPress REST identity, and login form through HTTPS pinned to the configured server IP. Only then show Visit website and Open WordPress.

This verifies installation and the presence of the login page; it does not perform an administrator login or prove that email delivery or backups work.

## Recovery and data

Jobs continue if the browser closes, as long as the local Hearth process stays running. Non-secret progress records are kept in `.hearth/installations` (ignored by Git), or in `HEARTH_DATA_DIR` if configured. Records contain domain, title, administrator username/email, server/account identity, and progress. Preserve this folder to retain duplicate-install protection. Passwords and API keys are not written to these records or Hearth logs.

Hearth records checkpoints before changing the server. If a request fails, times out, or Hearth restarts mid-operation, the job stops as **Needs review**. Hestia may still have completed the command. Hearth does not repeat those writes, reinstall WordPress, overwrite an existing domain, or delete any site/database automatically. Inspect the domain, database, certificate and installer outcome in Hestia before manual recovery. Automated continuation after partial installation is not implemented yet.

A DNS-waiting job can be retried because no mutation has started. An existing complete job is returned on duplicate submission. Records are tied to their original panel, account, and site IP. Use one running process per data folder.

Backups are not created by this flow. Configure and test backups through Hestia separately.

## Security boundary

Hearth is still a local, single-operator alpha. It listens on loopback, restricts Host/Origin, uses a startup CSRF token and JSON-only installation POST, limits request sizes, and exposes no arbitrary Hestia command endpoint. API keys remain server-side. TLS verification stays enabled. DNS checks accept only the configured server IPv4; site verification pins HTTPS connections to that address while validating the domain certificate. Redirects are not followed during verification.

Do not expose this version through a public proxy. Remote authentication, multi-user authorization, multi-process job coordination, proxied DNS and IPv6 support remain future work.

## Upstream contracts

- [Hestia access-key API](https://hestiacp.com/docs/server-administration/rest-api)
- [Hestia API argument handling](https://github.com/hestiacp/hestiacp/blob/main/web/api/index.php)
- [Quick Install CLI](https://github.com/hestiacp/hestiacp/blob/main/bin/v-quick-install-app)
- [WordPress installer](https://github.com/hestiacp/hestiacp/blob/main/web/src/app/WebApp/Installers/WordPress/WordPressSetup.php)
