# node_core

Framework library for Little Ridge Node hosts. A single host process loads this first, then application modules (`node_am`, later `node_ecom`).

The host is a multi-site live bus. WordPress remains the data authority. Divi modules hydrate from WordPress REST and subscribe to public room names (`auction:12`). This package binds each connection to a registered site origin and prefixes rooms internally so two WordPress sites cannot see each other's events.

## Responsibilities

- HTTP server (health, JWT verify, signed webhooks)
- Site registry (per-origin JWT and webhook secrets)
- WebSocket hub at `/ws` with origin-scoped rooms
- Room allow-lists and broadcast
- JWT verification (WordPress issues tokens; this package does not)
- WordPress HTTP helper for later module use

## Sites

`createApp()` takes a `sites` list keyed by canonical origin (`https://am.local`):

- `jwtSecret` / `webhookSecret` — per site, not shared
- `wpBaseUrl` — for rare Node → WordPress calls
- `modules` — optional allow-list (`["am"]`) so a shop cannot subscribe to auction rooms

CORS and WebSocket `Origin` checks use the same list. JWT `iss` must match the site used to verify the token.

## Live protocol

Clients connect to `/ws` without a token to watch public rooms. The browser `Origin` (or the sole registered site) selects the tenant. Browser JS still sends unprefixed room names.

```
{ "type": "subscribe", "rooms": ["auction:12"] }
{ "type": "auth", "token": "<jwt>" }
```

Application modules register room patterns and webhook handlers, then broadcast the same public names. The hub stores `site:{origin}:{room}` internally.

```
{ "type": "event", "event": "bid.created", "rooms": ["auction:12"], "payload": { ... } }
```

Webhooks must send `X-Spruce-Origin` (the WordPress `home_url()` origin) and an HMAC using **that site’s** webhook secret. A single registered site is accepted without the header for local scripts.
