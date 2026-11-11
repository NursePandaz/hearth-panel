# The Hearth wizard

Version 0.1 implements this flow as a clearly labeled local demo. The live connector can check access and list hosted domains and account backups; live provisioning remains the next milestone.

## Server setup happens once

Connect an existing HestiaCP test server first. A fresh-server bootstrap installer is a later milestone. Keep connection credentials on the server, never in browser storage or logs. Use certificate verification and narrowly scoped API permissions.

## Create a WordPress site

1. Check server: verify the actual connection and required capabilities; explain blockers.
2. Name website: domain and site title; show copyable DNS instructions where necessary.
3. Create login: administrator email, username, and password; offer password generation.
4. Launch: review the plan and create the site with readable progress.

Show success only after provisioning, WordPress, and HTTPS checks pass. Allow saving and returning while DNS propagates; distinguish pending DNS or certificates from completed setup.

## Dashboard

Websites, Backups, Server, Settings. Website actions: Visit website, Open WordPress, Back up, Manage. Expose only actions actually implemented and available on the connected server.

## Reliability

Save non-secret progress. Retry safely without duplicate resources. Keep passwords out of logs and saved drafts. Protect all management actions with authentication. Show precise recovery actions after failures. Offer backup setup or an explicit reminder; do not imply backups exist until verified.

## Later

Staging, migrations, deeper server controls, and fresh-server installation. Full mail and DNS hosting are outside the initial milestone.
