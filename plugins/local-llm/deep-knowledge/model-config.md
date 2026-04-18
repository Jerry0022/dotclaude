# Model Configuration Reference — AnythingLLM Backend

This plugin does not manage any model itself. The local LLM is owned by
**AnythingLLM Desktop** — the user installs it once, generates an API key,
and configures the underlying LLM inside the AnythingLLM UI. This plugin
just speaks HTTP to the workspace.

## Recommended setup

| Property | Value |
|----------|-------|
| Backend app | AnythingLLM Desktop (https://anythingllm.com/download) |
| LLM provider | Ollama |
| Model | `gemma4:e4b` (≈4.5B effective params, dense transformer) |
| Plugin workspace slug | `claude-code` |
| API port | 3001 (AnythingLLM default) |

The plugin auto-creates the `claude-code` workspace on first successful
connect. Model choice, GPU offload, KV-cache quantization, and context size
are all managed inside AnythingLLM's settings — outside this plugin's scope.

## One-time user steps

1. Install AnythingLLM Desktop.
2. Open it → Settings → **Developer API** → **Generate API Key**.
3. Provider setup: pick **Ollama**, let AnythingLLM pull `gemma4:e4b` (or
   select another model if the user prefers; the plugin does not enforce).
4. Run the `local-llm-setup` skill in Claude Code to save the API key.

## Config layering

Configuration is resolved in three layers (later overrides earlier):

1. Plugin defaults — `plugins/local-llm/scripts/config.json`
2. Project config — `<cwd>/.claude/local-llm/config.json`
3. User config — `~/.claude/local-llm/config.json`

The **API key is only read from the user layer** to prevent accidental commits.
The setup skill always writes to the user layer.

## Minimal user config (written by `local-llm-setup`)

```json
{
  "anythingllm": {
    "apiKey": "ANYTHINGLLM-xxxxxxxxxxxxxxxxxxxxxxxx"
  }
}
```

## Full config reference

```json
{
  "anythingllm": {
    "baseUrl": "http://localhost:3001",
    "apiKey": "",
    "workspaceSlug": "claude-code",
    "workspaceName": "Claude Code",
    "autoLaunch": true,
    "launchTimeoutMs": 30000,
    "pollIntervalMs": 1000
  },
  "generation": {
    "temperature": 0.2,
    "maxTokens": 4096
  }
}
```

| Field | Purpose |
|-------|---------|
| `baseUrl` | AnythingLLM API root. Keep default unless the app runs on a different port/host. |
| `apiKey` | User-global secret. Only read from `~/.claude/local-llm/config.json`. |
| `workspaceSlug` | Workspace the plugin talks to. Auto-created if missing. |
| `autoLaunch` | If true, the SessionStart hook launches AnythingLLM when installed but not running. |
| `launchTimeoutMs` | How long the hook waits for the API to become reachable after launch (advisory; the hook itself never blocks the prompt). |
| `generation.temperature` | Default sampling temperature for `local_generate`. Keep ≤ 0.5 for code. |
| `generation.maxTokens` | Upper bound on completion length. |

## Phase reference

The SessionStart hook and `local_status` tool return one of these phases:

| Phase | Meaning |
|-------|---------|
| `ready` | All systems go. `local_generate` is usable. |
| `needs_api_key` | No key saved yet. Run `local-llm-setup`. |
| `not_installed` | AnythingLLM Desktop not found on disk. |
| `not_running` | Installed but process not up, and `autoLaunch` is disabled. |
| `starting` | Just launched; API not yet responding. Retry on next SessionStart. |
| `network_blocked` | Process up, but `/api/ping` fails. Enable Network Discovery in AnythingLLM Settings → API. |
| `auth_failed` | API key rejected. Re-run setup. |
| `configuring` | API reachable, workspace missing. Creation triggered in background. |
| `request_failed` | A completion call failed mid-flight (MCP-only). |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `needs_api_key` loops | Key saved to a project-level config | Move it to `~/.claude/local-llm/config.json` |
| `network_blocked` while app is open | AnythingLLM Settings → API has network access off | Toggle it on |
| Slow first completion | Ollama is loading the model into VRAM | One-time — subsequent calls are fast |
| `auth_failed` after a working day | User regenerated the key in AnythingLLM UI | Re-run `local-llm-setup` |
| Garbage or truncated output | `temperature` too high or `maxTokens` too low | Adjust `generation.*` in user config |
