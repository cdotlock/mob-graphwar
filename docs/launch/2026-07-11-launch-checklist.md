# Launch Checklist - 2026-07-11

Owner: Clock / Codex  
Target: Railway production  
Decision: Go only when every blocking item is checked

## Product

- [x] One commander controls A1 and A2 with one model and one standing prompt.
- [x] Random matchmaking prefers a human opponent, then uses one AI commander.
- [x] Ranked matches end on team elimination or the global 24-action cap.
- [x] Play, Leaderboard, and API Docs are separate destinations.
- [x] Desktop shows setup, battlefield, hand, and active-agent reasoning together.
- [x] Mobile has task tabs and no horizontal overflow.

## Security

- [x] Player API keys are stored only in browser local storage.
- [x] Account/profile writes contain model metadata but no key.
- [x] Server stores, traces, rank rows, and responses do not retain user keys.
- [x] Internal AI-fill credentials cannot be spent by anonymous public routes.
- [x] Production requires a strong explicit session secret.
- [x] Browser sessions use HttpOnly, Secure, SameSite=Lax cookies.
- [x] Legacy passwordless sessions are disabled in production.
- [x] Provider execution is authenticated and rate limited.

## Quality

- [x] Unit, provider, server, source-boundary, and rendered UI tests pass locally.
- [x] Production build renders without console errors.
- [x] Browser checks cover 1440, 1024, 768, and 390 pixel widths.
- [x] Registration request inspection confirms the browser key is absent.
- [x] Production dependency audit reports zero vulnerabilities.
- [ ] Railway deployment is healthy and production smoke checks pass.
- [ ] Persistent data path is backed by a Railway volume.

## Rollback

1. Roll back Railway to the deployment before `08da40e`.
2. Keep the current data volume mounted; do not replace or truncate the store.
3. Restore traffic only after `/healthz`, login, leaderboard, and one AI-fill
   match smoke check pass.
