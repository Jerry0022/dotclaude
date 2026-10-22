# Ship — Session title (Pre-Step C)

Referenced by `/do-ship` Pre-Step C. The two hook paths (typed `/do-ship`,
Skill-tool load) and the sentinel rule stay in SKILL.md; this is the fallback
and the Desktop-only detail.

## Fallback

Only when the `[post.flow.title-mode]` block says the title is unknown:

1. `mcp__ccd_session_mgmt__get_session` with `session_id: "self"` → `title`.
2. If the title already starts with `⏳ ┃ 🚀 Shipping `: done.
3. Strip any leading devops prefix (`⏳ ┃ 🚀 Shipping `, `🟩 ┃ 🚀 Alpha `, `👉 ┃ 🧪 Test `,
   `👉 ┃ 📦 Ready `, `👉 ┃ 🚧 Blocked `, `⏳ `, … — the `SESSION_PREFIX` values and the legacy single-icon forms) left by an earlier card or
   ship in this session — never stack them.
4. `mcp__ccd_session_mgmt__set_session_title` with `session_id: "self"` and
   `title: "⏳ ┃ 🚀 Shipping {stripped title}"`.

The `⏳ ┃ 🤖 Solo ` is the fallback for "being worked on", never the override: no
hook or skill replaces a running `⏳ ┃ 🚀 Shipping ` with it (`{PLUGIN_ROOT}/deep-knowledge/session-title-scheme.md`).

## Desktop only

**Both tools exist only in the Desktop app.** Deferred is not unavailable: when they sit in the deferred-tools list, load
the set tool (fallback: both once with `ToolSearch` `select:mcp__ccd_session_mgmt__get_session,mcp__ccd_session_mgmt__set_session_title`), then call them
(`{PLUGIN_ROOT}/deep-knowledge/mcp-deferred-tools.md`). In a terminal session, an
unattended run, or when the call fails for any reason: skip silently — no
retry, no note to the user, no fallback. The rename is a courtesy, never a
gate. The completion card's `[SESSION TITLE]` block replaces the prefix with
the outcome (`🟩 ┃ 🚀 Alpha ` / `👉 ┃ 🚧 Blocked `, see Step 6; scheme: `{PLUGIN_ROOT}/deep-knowledge/session-title-scheme.md`); never restore a
remembered title by re-typing it.
