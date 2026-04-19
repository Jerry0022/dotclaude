# Model Configuration Reference — AnythingLLM Backend

The backend app is **AnythingLLM Desktop** — the user installs it once and
generates an API key. The plugin then talks to a workspace via HTTP.

**The chat model is owned by the user inside AnythingLLM.** The plugin does
not pin, swap, or probe models. Whatever the workspace is configured with is
what `local_generate` will use. The SessionStart hook only reads the active
`chatModel` and surfaces a recommendation when none is set.

## Recommended setup

| Property | Value |
|----------|-------|
| Backend app | AnythingLLM Desktop (https://anythingllm.com/download) |
| Provider | Ollama (built-in native LLM in AnythingLLM) |
| Recommended model | **Gemma 4 E4B** (Bartowski GGUF, bf16 full precision) |
| → HuggingFace page | https://huggingface.co/bartowski/google_gemma-4-E4B-it-GGUF |
| → Ollama pull tag | `hf.co/bartowski/google_gemma-4-e4b-it-gguf:bf16` |
| Plugin workspace slug | `claude-code` |
| API port | 3001 (AnythingLLM default) |

The plugin:

1. Auto-creates the `claude-code` workspace on first successful connect.
2. Reads the workspace's `chatModel` on each SessionStart and shows it in
   the ready banner.
3. If no model is configured, emits a one-shot recommendation with the
   HuggingFace GGUF URL and the `ollama pull` command. Any other model the
   user sets in AnythingLLM also works — the plugin does not enforce.

GPU offload, KV-cache quantization, context size, temperature caps, and
model selection all remain inside AnythingLLM's settings — outside this
plugin's scope.

## One-time user steps

1. Install AnythingLLM Desktop.
2. Open it → Settings → **Developer API** → **Generate API Key**.
3. Provider setup: pick **Ollama**, pull the recommended model
   **Gemma 4 E4B** —
   HuggingFace page: <https://huggingface.co/bartowski/google_gemma-4-E4B-it-GGUF>,
   Ollama pull tag: `hf.co/bartowski/google_gemma-4-e4b-it-gguf:bf16`
   (HuggingFace GGUF — supported by Ollama ≥ v0.3.13; must be pulled via the
   AnythingLLM UI or `ollama pull`, the AnythingLLM REST API cannot trigger
   the download).
   Any other model works too — the plugin uses whatever is configured.
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
    "pollIntervalMs": 1000,
    "recommendedModel": "hf.co/bartowski/google_gemma-4-e4b-it-gguf:bf16",
    "recommendedModelUrl": "https://huggingface.co/bartowski/google_gemma-4-E4B-it-GGUF"
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
| `workspaceName` | Human-readable name used when the workspace is auto-created. |
| `autoLaunch` | If true, the SessionStart hook launches AnythingLLM when installed but not running. |
| `launchTimeoutMs` | How long the hook waits for the API to become reachable after launch (advisory; the hook itself never blocks the prompt). |
| `recommendedModel` | Ollama pull tag shown in the ready banner when the workspace has no `chatModel` set. Not enforced — the user's AnythingLLM selection always wins. |
| `recommendedModelUrl` | HuggingFace page for the recommended model, shown alongside the Ollama tag in the recommendation block. |
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
| No `Model:` line in ready banner | Workspace has no `chatModel` set | Configure a chat model in AnythingLLM → Workspace Settings → Chat Settings |
