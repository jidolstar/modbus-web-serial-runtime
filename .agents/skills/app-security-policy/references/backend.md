# Backend policy

Use this reference for NestJS/Fastify, authentication, API, MySQL, migration, and server configuration work.

## Configuration and secrets

- Parse environment variables once in the composition/configuration layer and expose a validated typed object.
- Fail startup for missing secrets or database settings required for safe operation. Optional integrations may expose a non-secret unavailable status.
- Require high-entropy signing keys and validate numeric ranges and URL/origin formats.
- Use an application-specific MySQL account with only the privileges needed on `modbus_manager.*`; never run the application as MySQL root.
- Use versioned migrations. Do not enable ORM schema synchronization in a deployed environment.

## Authentication and session

- Use Google OpenID Connect Authorization Code flow with state, nonce, and PKCE. Verify signature, issuer, audience, expiry, nonce, and `email_verified`.
- Identify a Google user by `sub`; normalize email only for the allowlist and display.
- An absent or empty allowlist denies all users.
- Keep JWTs in host-only `Secure`, `HttpOnly`, `SameSite=Lax` cookies. Never return them to browser JavaScript or store them in localStorage.
- Store only a hash of the JWT `jti` in the database. Check expiry/revocation for protected requests and revoke the session during logout.
- Do not persist Google access or refresh tokens unless a separately approved feature needs Google API access.

## HTTP/API

- Allow an exact configured CORS origin with credentials; never combine credentialed requests with wildcard origin.
- Require authentication and authorization at controller boundaries and repeat ownership constraints in database queries where applicable.
- Protect state-changing cookie-authenticated requests with a strict Origin check and SameSite cookie; add a CSRF token if the deployment topology needs cross-site requests.
- Use DTO validation with allowlisted fields, size/range limits, and rejection of unexpected input.
- Use stable public error codes. Do not expose stack traces, SQL details, token-validation internals, or whether a disallowed account exists.
- Apply bounded rate limits to login, callback, and other abuse-prone endpoints.
- Use security headers and disable unnecessary framework disclosure.

## Database and query construction

- Use Kysely parameter binding for values. Avoid `sql.raw`, `sql.lit` with untrusted values, `Kysely<any>`, and user-controlled identifiers or JSON paths.
- Define foreign keys, uniqueness, nullability, lengths, and domain constraints in migrations as well as application validation.
- Use transactions for multi-step state changes whose partial completion would violate an invariant.
- Store the minimum personal data necessary and define expiry/cleanup for session records.

## Verification

Test unauthenticated, unauthorized, expired, revoked, malformed, cross-origin, invalid-input, and dependency-failure paths. Inspect actual `Set-Cookie`, CORS, cache, and security headers rather than testing implementation details alone.
