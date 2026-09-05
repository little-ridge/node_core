# node_core

Framework library for Little Ridge Node hosts. `am_node` loads this first, then application modules.

## Responsibilities

- HTTP server (health, JWT verify, signed webhooks)
- WebSocket hub at `/ws`
- Room allow-lists and broadcast
- JWT verification (WordPress issues tokens; this package does not)
- WordPress HTTP helper for later module use

## Live protocol

Clients connect to `/ws` without a token to watch public rooms.

```
{ "type": "subscribe", "rooms": ["auction:12"] }
{ "type": "auth", "token": "<jwt>" }
```

Application modules register room patterns and webhook handlers, then broadcast:

```
{ "type": "event", "event": "bid.created", "rooms": ["auction:12"], "payload": { ... } }
```
