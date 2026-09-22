---
name: project-plan-writer
description: Create or revise repository-local development plans in the project's _plan directory. Use when the user asks for a 개발 계획서, implementation plan, roadmap, work plan, or phased technical plan for this repository.
---

# Project Plan Writer

Create an actionable Korean development plan grounded in the current repository and the user's confirmed decisions.

## File convention

- Store new plans under `<repository-root>/_plan`.
- Name files `YYYYMMDD_###_제목.md`, using the current local date.
- Determine `###` by scanning that date's existing files and choosing one greater than the highest sequence. Start at `001`; never overwrite or reuse an existing number.
- Convert a supplied title into a short filesystem-safe Korean or English title. Replace whitespace with hyphens and omit Windows-reserved characters.
- Update an existing plan only when the user explicitly identifies it or asks to revise the current plan. Otherwise create a new numbered plan.

## Required header

Begin each plan with YAML frontmatter containing:

- `title`
- `document_id` matching the filename without `.md`
- `created_at` with local time and UTC offset
- `author`
- `requested_by`
- `purpose`
- `status`

Use `Codex (OpenAI)` as the author when Codex writes the document. If the user's personal name is unknown, use `프로젝트 사용자` rather than inventing one. Use `draft` unless the user explicitly approves or finalizes the plan.

## Planning workflow

1. Inspect the repository structure, relevant configuration, implementation files, and existing plans before writing.
2. Treat user-confirmed requirements as decisions. Separate deferred work, exclusions, and unresolved questions instead of silently expanding scope.
3. State the current baseline with file-level evidence.
4. Make the implementation sequence concrete enough to execute: affected files/components, behavior, security constraints, verification, and completion criteria.
5. Include risks and future-extension points only when they affect the current design.
6. Do not implement the plan unless the user also requests implementation.

## Expected content

Adapt headings to the task, but ordinarily cover:

- background and objective
- confirmed decisions
- current state
- scope and non-goals
- proposed architecture and behavior
- phased implementation checklist
- expected file changes
- test matrix and acceptance criteria
- risks and mitigations
- deferred items and later extension strategy

Prefer checklists for executable work. Mark assumptions and unverified behavior explicitly. Keep the plan specific to this repository rather than adding generic project-management prose.
