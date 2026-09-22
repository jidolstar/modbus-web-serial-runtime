# Frontend policy

Use this reference for Vue, browser authentication state, environment variables, Web Serial, and UI work.

## Browser trust boundary

- Assume all shipped frontend code, network requests, `VITE_` variables, and browser storage are visible to the user.
- Never embed OAuth client secrets, JWT signing keys, database credentials, private endpoints containing credentials, or privileged allowlists in the frontend.
- Do not store session JWTs or OAuth tokens in localStorage, sessionStorage, IndexedDB, Pinia persistence, or ordinary JavaScript-readable cookies.
- Call cookie-authenticated APIs with `credentials: 'include'`; treat HTTP 401 as an ordinary anonymous state.

## Rendering and navigation

- Render untrusted text through Vue interpolation. Do not use `v-html` without an explicit sanitizer and a demonstrated requirement.
- Validate externally supplied URLs and restrict navigation/redirect targets to known origins or relative application paths.
- Do not display raw backend errors, stack traces, tokens, callback query values, or secret configuration values.
- A configuration-status screen may show missing environment variable names and safe remediation text only.

## Web Serial and device data

- Keep Web Serial calls behind the existing transport/runtime abstraction.
- Require a deliberate user action for port selection, connection, writes, and configuration changes.
- Treat device frames, Profile/Recipe JSON, imported files, and decoded strings as untrusted input and enforce existing schema/range validation before execution or rendering.
- On disconnect, abort pending work and do not silently replay write/configuration operations after reconnect.
- Do not send raw serial traffic or device identifiers to the Backend unless an approved feature explicitly requires it and the UI communicates the data flow.

## Verification

Test missing configuration, anonymous/expired sessions, escaped hostile strings, invalid redirects, rejected API input, device disconnect, and reconnection without replay. Confirm production bundles and source maps contain no secret-like values.
