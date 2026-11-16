# Copilot Instructions for VibeCam

Follow [AGENTS.md](../AGENTS.md). It holds the working guide, product constraints, roles, branch and PR rules, and the verification commands.

- Work from `main` through a feature branch and a pull request. The `mvp` branch is retired.
- Read [CONTEXT.md](../CONTEXT.md) and [release readiness](../docs/RELEASE_READINESS.md) first. `docs/PROJECT_CONTEXT.md` is a historical log.
- Run backend commands from `backend/` and mobile commands from `mobile/`. Reuse the selected Python environment unless asked to recreate it.
- The mobile app needs a custom build for its native module. Do not use Expo Go to validate it.
- Keep backend API code typed with Pydantic models and type hints, and keep the `/health` response contract: `status`, `service`, `timestamp_utc`.
- On Windows, write generated text files as UTF-8 and avoid PowerShell `>` redirection for them.
