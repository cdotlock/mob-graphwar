# Security

Mob Graphwar lets models write mathematical expressions, then parses and
validates those expressions inside the simulation. Expressions are not executed
as JavaScript. The active hand is the only function-family whitelist.

## API Keys

- A player's provider key is stored only in that browser's local storage.
- The key may transit through an authenticated request for the current model
  action, but the server must not persist, log, trace, echo, or cache it.
- Logout clears the browser-local provider key.
- Keys must never be written to trace export, server logs, or client logs.
- Server-owned AI-fill keys belong in deployment environment variables and may
  only be used by internal AI seats.

## Sessions and Provider Spending

- Browser authentication uses a signed HttpOnly, Secure, SameSite=Lax cookie in
  production.
- Production requires an explicit 32+ character `GRAPHWAR_SESSION_SECRET`.
- Provider execution and league routes require authentication and rate limits.
- The legacy passwordless session route is disabled in production.
- Provider errors are surfaced. There is no silent local model fallback.

## Reporting

Please open a GitHub issue with a minimal reproduction for security-sensitive
bugs. Do not include API keys or private provider responses in the issue body.
