# Copilot Instructions for VibeCam

## Session Startup

- Read docs/PROJECT_CONTEXT.md and README.md first.
- Assume branch mvp unless the user asks to switch.
- Prefer small, production-oriented changes.

## Repository Conventions

- Monorepo layout: mobile/ and backend/.
- Mobile workflow uses a custom dev client; do not default to Expo Go.
- Keep backend API code strongly typed with Pydantic models and Python type hints.
- Preserve the current /health response contract:
  - status
  - service
  - timestamp_utc

## Environment and Command Conventions

- Run backend commands from backend/.
- Run mobile commands from mobile/.
- Reuse the user's selected Python environment unless they explicitly ask to recreate it.
- On Windows, avoid PowerShell > for generated lock/list text files. Use cmd redirection or explicit UTF-8 output.

## Validation Checklist

- After backend changes, run and verify GET /health.
- After dependency/output file generation, ensure files are UTF-8 plain text.
- Re-run diagnostics and fix new errors introduced by the change.

## Documentation Rule

- If setup, behavior, or workflow changes, update both:
  - README.md
  - docs/PROJECT_CONTEXT.md
