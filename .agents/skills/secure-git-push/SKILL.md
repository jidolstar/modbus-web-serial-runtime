---
name: secure-git-push
description: Audit this public repository before committing or pushing. Use whenever a user requests a Git commit, push, publication, release, or asks whether sensitive files and credentials are excluded from Git.
---

# Secure Git Push

Prevent company-only material and secrets from entering Git history. This skill does not itself authorize a commit or push; perform those mutations only when requested.

## Required workflow

1. Inspect `git status --short`, `git diff`, `git diff --cached`, `.gitignore`, and the exact files that would enter the commit.
2. Run `powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/secure-git-push/scripts/test-public-repo.ps1` from the repository root.
3. If available, also run `gitleaks git --redact --no-banner .` or an equivalent repository-history scan. Never print a discovered secret value.
4. Run relevant tests/builds before committing.
5. Use `commit-message-writer` for a concise message that excludes sensitive operational details.
6. Re-run the audit after staging because ignore rules do not remove files that were already tracked.
7. Review the outgoing commits and remote URL before push. Push only the intended branch and do not force-push unless the user explicitly requests it and the exact consequence is understood.
8. Report what was checked and stop if any finding remains unresolved.

## Blocking findings

- `.env` or environment-specific secret files other than approved `.env.sample` files
- `_doc`, `_plan`, `_temp`, `temp`, `tmp`, `.codex`, or other company/private working material
- private keys, certificates containing private material, keystores, database dumps, backups, logs, or credential exports
- passwords, JWT signing keys, OAuth client secrets, access tokens, session cookies, credential-bearing database URLs, or real private infrastructure values
- secrets introduced and later removed within commits that have not yet been pushed

Use placeholders such as `replace_with_secret` and `https://api.example.com` in samples. Do not replace a real secret with a weak but realistic-looking value.

If a secret has entered any commit that may have reached a remote, removing it from the latest file is insufficient. Stop, tell the user to rotate/revoke it, determine whether history rewriting is authorized, and avoid repeating the value in output.
