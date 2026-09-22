---
name: app-security-policy
description: Apply this repository's frontend and backend security policy when implementing or reviewing authentication, authorization, cookies, APIs, database access, environment configuration, validation, logging, or other security-sensitive application behavior.
---

# Application Security Policy

Protect the public repository and deployed application without expanding the requested feature scope.

## Required workflow

1. Identify trust boundaries and data that must remain server-side before editing code.
2. Read [references/backend.md](references/backend.md) for Backend, authentication, database, API, migration, or server configuration work.
3. Read [references/frontend.md](references/frontend.md) for Frontend, browser storage, Web Serial, UI authentication state, or client configuration work.
4. Inspect existing configuration and security controls rather than assuming they exist.
5. Implement the smallest secure design that satisfies the request.
6. Add negative-path tests for the security boundary, not only successful behavior.
7. Before any commit or push, also use the `secure-git-push` skill.

## Repository invariants

- Keep actual credentials exclusively in ignored environment files or an external secret manager. Public samples contain placeholders and example domains only.
- Treat every `VITE_` value as public browser data. Never place a secret in a `VITE_` variable or frontend bundle.
- Preserve the architecture boundary: the browser owns Web Serial/Modbus execution; the server owns authentication, authorization, persistence, and management APIs.
- Validate untrusted input at the boundary and use parameterized database queries. Do not construct raw SQL, identifiers, JSON paths, redirects, origins, or file paths from unchecked input.
- Deny access when security configuration is missing or ambiguous. A safe diagnostic response may name missing variables but must never return their values.
- Do not log passwords, tokens, cookies, OAuth codes, private keys, database URLs containing credentials, or full sensitive request bodies.
- Use named security constants or validated environment settings. Do not scatter cookie lifetimes, retry limits, key lengths, or similar security values as magic numbers.
- Keep dependencies pinned by the lockfile and check relevant advisories when adding or upgrading security-sensitive packages.

If a requested shortcut weakens one of these boundaries, explain the concrete risk and use the closest safe design instead.
