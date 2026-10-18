# Interactive terminal

The **Terminal** tab opens a real, interactive shell in the environment that runs the terminal service.
It is **disabled by default**: the tab always appears, but it shows a notice until you enable it in the
bundle configuration and start the dedicated service.

The shell is as powerful as direct execution — it can change anything in your application — so enable it
only where you really need it, and treat the service host as part of your application's security boundary.

![Interactive terminal](docs/img/terminal.png)

## Requirements

- Linux, with a **non-root** user. The service refuses to start on other platforms or as root.
- **Node.js 22+** for the terminal service. The rest of the bundle does not need Node.js at runtime.

## Enabling the terminal

Turn the terminal on in the bundle configuration and start the service with a shared secret and the Studio
origin:

```yaml
# config/packages/command_center.yaml
pimcore_command_center:
    terminal:
        enabled: true
        secret: '%env(COMMAND_CENTER_TERMINAL_SECRET)%'   # at least 32 characters
        origin: 'https://studio.example.com'             # exact scheme and host, no path
```

```sh
cd packages/command-center/terminal
npm ci
COMMAND_CENTER_TERMINAL_ENABLED=1 \
COMMAND_CENTER_TERMINAL_SECRET='<same shared secret>' \
COMMAND_CENTER_TERMINAL_ORIGIN='https://studio.example.com' \
COMMAND_CENTER_TERMINAL_CONSUME_URL='http://127.0.0.1/command-center-internal/terminal/consume' \
COMMAND_CENTER_TERMINAL_CWD='/var/www/html' \
node server.mjs
```

The `secret` in the bundle configuration and `COMMAND_CENTER_TERMINAL_SECRET` for the service must be the
same value and at least 32 characters long. Keep the service running under Supervisor, systemd or your
container orchestrator so it restarts automatically.

## Deployment and proxying

The service listens on `127.0.0.1:8091` by default and must be reachable on the **same origin** as Studio:

- Reverse-proxy the WebSocket path (`/command-center-terminal` by default) to the service.
- Keep the internal consume path (`/command-center-internal/…`) reachable **only** by the service. It is
  part of the same origin but must not be exposed to browsers or the public internet.

The bundle's Docker setup follows this pattern: the service runs under Supervisor as `www-data` alongside
FrankenPHP, and Caddy proxies the WebSocket path on the same origin while returning `404` for the internal
consume path to every client other than loopback.

## Security model

- The settings and ticket endpoints require an active Pimcore administrator and a valid CSRF token; the
  ticket request must also come from the configured origin and carry a Studio session.
- Every connection uses a **single-use ticket**, stored only as a hash and expiring after 30 seconds. The
  ticket is bound to the requesting user and Studio session, and the consume endpoint re-checks that the
  user is still an active administrator before a shell is started.
- The internal consume endpoint is protected by the shared secret (`Authorization: Bearer …`) and never by
  the Studio session. It must stay unreachable from outside the host.
- Authorization is time-limited: the tab renews it every 30 seconds with a fresh single-use ticket, and the
  service ends the shell if a renewal does not arrive in time (60 seconds by default). Deactivating or demoting
  the user therefore also ends a running session.
- The service refuses to start on non-Linux systems or as root, and the shell does not inherit the service
  secret or the other `COMMAND_CENTER_TERMINAL_*` variables.
- Closing the tab or the browser ends the session and stops the shell. A dropped connection can reconnect to
  the same shell within 15 seconds.

## Limits

- 20 concurrent shells and up to 100 simultaneous WebSocket clients.
- 64 KiB per WebSocket message and 1 MiB of buffered output per shell.
- The tab offers connect/disconnect, clear, copy and paste. The shell keeps no audit history, so run anything
  you want to keep a record of as a command, template or workflow instead.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `COMMAND_CENTER_TERMINAL_ENABLED` | Set to `1`; the service exits otherwise. |
| `COMMAND_CENTER_TERMINAL_SECRET` | Shared secret (≥ 32 characters) for the internal consume endpoint. |
| `COMMAND_CENTER_TERMINAL_ORIGIN` | Exact Studio origin; upgrades from other origins are rejected. |
| `COMMAND_CENTER_TERMINAL_CONSUME_URL` | Absolute URL of the internal ticket-consume endpoint. |
| `COMMAND_CENTER_TERMINAL_CWD` | Absolute working directory of the shell. |

Optional: `COMMAND_CENTER_TERMINAL_SHELL` (default `/bin/bash`), `COMMAND_CENTER_TERMINAL_PATH` (default
`/command-center-terminal`) and `COMMAND_CENTER_TERMINAL_HOST` / `_PORT` (default `127.0.0.1:8091`).

## Development

Install the service dependencies and run its tests:

```sh
cd terminal
npm ci
npm test
```
