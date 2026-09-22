---
name: commit-message-writer
description: Write concise Git commit messages for this repository. Use when proposing or creating a commit to summarize what changed, why it changed, validation or compatibility impact, while excluding secrets and sensitive operational details.
---

# Commit Message Writer

Describe the actual commit, not the conversation or intended future work.

## Build the message

1. Inspect `git status --short`, `git diff`, and `git diff --cached`. When committing, describe only the staged changes.
2. Apply `secure-git-push` before creating the commit. A commit message is not a substitute for removing sensitive content from the files or history.
3. Choose the narrowest applicable type:
   - `feat`: user-visible capability
   - `fix`: defect correction
   - `refactor`: behavior-preserving code restructuring
   - `test`: test-only change
   - `docs`: documentation or repository instruction
   - `build`: dependency, container, or build configuration
   - `ci`: automation pipeline
   - `perf`: measured performance improvement
   - `chore`: maintenance that fits none of the above
4. Write a subject as `<type>: <핵심 변경>` in Korean. Keep it specific, preferably within 72 characters, without a trailing period.
5. If one subject fully explains the commit, stop there. Otherwise add a blank line and one bullet per meaningful change:

```text
- <무엇을 변경했는지>: <왜 변경했는지>
```

6. Add only information that helps future maintenance:
   - `검증:` for meaningful tests or builds actually run
   - `호환성:` for a real migration, API, schema, or deployment impact
   - `BREAKING CHANGE:` only when consumers must change and the breaking change is intentional
   - a public issue reference only when it is known and relevant

Do not add empty sections, exhaustive file lists, implementation narration, future plans, or generated-by/co-author trailers unless the user explicitly requests them.

## Sensitive-information filter

Never include secret values or material that helps locate or exploit private infrastructure. Exclude:

- passwords, tokens, cookies, keys, OAuth codes, credential-bearing URLs, or fragments of those values
- real domains, IP addresses, email allowlists, usernames, database hosts, network names, device serial numbers, or internal identifiers when they are not already intentionally public
- private file locations, secret environment values, vulnerability reproduction details, exploit steps, or the exact signature of a discovered credential
- deleted sensitive text copied from a diff or history

Use a safe functional summary instead, such as `환경설정 예제를 공개용 값으로 정리` or `저장소 공개 전 검사 절차 추가`. If the diff contains a possible secret, stop the commit workflow and follow `secure-git-push`; do not merely redact the message and proceed.

## Examples

Single-purpose change:

```text
fix: 연결 해제 후 폴링 작업이 재실행되지 않도록 수정
```

Several related changes:

```text
docs: 프로젝트 작업 지침과 구조 설명 정리

- README에 구성요소의 책임을 설명해 프로젝트 진입점을 명확화
- 공통 에이전트 지침을 추가해 최소 범위 구현 원칙을 공유
- 공개 전 검사 절차를 추가해 저장소 확인 과정을 일관화

검증: 스킬 형식 및 공개 파일 검사 통과
```

Keep related changes in one commit message. If the changes have unrelated purposes, recommend separate commits instead of writing an ambiguous combined message.
