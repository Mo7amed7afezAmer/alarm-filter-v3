# NOC Alarm Platform — standing rules

Read this file before any work in this repository.

## Documents
- **`REQUIREMENTS.md`** is the source of truth (FR-01…FR-70, NFR-01…NFR-43).
- **`PLAN.md`** defines the tasks, their order and their acceptance criteria.
- **`PROMPTS.md`** defines the execution stages (Stage 0 … Stage 12).
- **`docs/DECISIONS.md`** records decisions D-01…D-12, risks and the answers to Q-01…Q-11.
- **`docs/TASKS.md`** is the task checklist and status.

## Rules
- **Parity rule:** implement FR-01…FR-70 and NFR-01…NFR-43 exactly as written. Never add, change or drop a feature. If a requirement is ambiguous, stop and ask; do not guess.
- **Tests first:** for every task, write the tests named in its Acceptance column before the implementation. All existing tests must stay green.
- **One task at a time,** in PLAN.md §4 order (0 → G → 3 → 4 → 6 → 7).
- **Secrets:** never commit credentials.json, token.json, secrets/ or .env. Never run destructive git commands.
- **Stack is fixed:** Node 20, pnpm 9.15.9, Next.js 14, Prisma, PostgreSQL 16, Vitest, Playwright, Docker Compose, Debian unrar.
