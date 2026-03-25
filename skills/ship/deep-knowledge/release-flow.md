# Release Flow

Before committing a new version tag (`vX.Y.Z`):
1. Run the project's release pipeline — use GitHub Actions where possible; fall back to a Windows self-hosted runner for anything requiring native Windows (installers, platform-specific tooling).
2. Update `CHANGELOG.md` (or equivalent) before tagging. See per-project memory for tone/format requirements.
- This applies to **all** version bumps — major, minor, and patch alike.
- **CI tag filter rule:** The release workflow's tag trigger must match **all** semver tags (`v[0-9]+.[0-9]+.[0-9]+`), not just `.0` tags. When creating or auditing a release workflow, verify the filter accepts patch tags — a filter like `v*.*. 0` silently skips patches and is a common source of missed releases.
- Specific pipeline details (scripts, artifact names, runner requirements) are stored in per-project memory.
