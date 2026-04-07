# Code Defaults

Standard coding conventions enforced across all projects using the devops plugin.

## Encoding & Language
- UTF-8 encoding for all files.
- English identifiers, comments, and strings (except explicit i18n/localization resource files).

## Change Philosophy
- Minimal changes only — no refactoring or features beyond what was asked.
- No fallbacks by default — propose as an option, implement only with explicit approval.
- Avoid over-engineering: only make changes that are directly requested or clearly necessary.

## What NOT to Do
- Don't add docstrings, comments, or type annotations to code you didn't change.
- Don't add error handling for scenarios that can't happen.
- Don't create helpers or abstractions for one-time operations.
- Don't design for hypothetical future requirements.
- Don't add backwards-compatibility hacks for removed code.
