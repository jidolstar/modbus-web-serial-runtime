---
name: api-swagger-docs
description: Add or update Swagger/OpenAPI documentation whenever this repository's NestJS Backend API endpoints, request contracts, response contracts, authentication requirements, or public error behavior change.
---

# API Swagger Documentation

Keep the running API behavior and OpenAPI contract in the same change.

## Required workflow

1. Inspect the controller, guards, DTO validation, service return value, and public error codes before documenting an endpoint.
2. Add an `@ApiOperation` summary/description, tag, authentication requirement, parameters or request body, success response, redirects, and every meaningful public error response.
3. Use named DTO classes with `@ApiProperty` or explicit schemas when runtime reflection cannot describe the contract. Do not use internal database rows as public schemas.
4. Give each request and body response at least one realistic, self-contained example. Add contrasting examples when configured/unconfigured, authenticated/anonymous, or validation outcomes materially differ.
5. Keep examples safe for this public repository: use `example.com`, placeholder identities, and synthetic IDs. Never include cookies, JWTs, OAuth codes, client secrets, allowlist contents, credentials, stack traces, SQL details, or real internal domains.
6. Keep stable public error codes and HTTP statuses aligned with the implementation. Describe security behavior without revealing validation internals useful for bypassing it.
7. Run typecheck, tests, and build. Inspect `/api/docs-json` for paths, schemas, examples, cookie security, and absence of secrets; then load `/api/docs` to confirm the UI renders.

## Repository conventions

- Swagger UI is served at `/api/docs`; OpenAPI JSON is served at `/api/docs-json`.
- Cookie-authenticated endpoints use the `sessionCookie` security scheme. Document that the cookie is `HttpOnly` and is not supplied in request bodies or JavaScript.
- OAuth start/callback endpoints document `302` redirect behavior and relevant response headers rather than pretending they return JSON bodies.
- State-changing endpoints document the strict allowed-origin requirement. Swagger UI “Try it out” may be rejected when its origin differs from `CORS_ORIGIN`; do not weaken CSRF protection to make interactive docs succeed.
- A `204` response has no example body.
- Missing-configuration diagnostics may name environment variable keys but never their values.
