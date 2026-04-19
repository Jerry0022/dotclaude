---
name: local-llm-setup
description: Interactive setup for the local-llm plugin — ask the user for their AnythingLLM API key, save it user-globally, and verify the connection. Use when the SessionStart hook reports `phase: needs_api_key`, `auth_failed`, or when the user explicitly asks to configure or reconfigure the local LLM. Triggers on "local llm setup", "anythingllm key", "local-llm configure".
---

# local-llm-setup

Guided flow to connect this plugin to a running AnythingLLM Desktop instance.

## What this skill does

1. Confirms the user has installed AnythingLLM Desktop and generated an API key.
2. Asks the user to paste the API key.
3. Saves the key to `~/.claude/local-llm/config.json` (user-global, outside any git repo).
4. Verifies the key against `GET /api/v1/auth`.
5. Auto-creates the `claude-code` workspace if missing.
6. Reports the resulting phase.

## Step 1 — Precondition check

Before asking for the key, tell the user what they need:

> **AnythingLLM Desktop** must be installed and running.
> If not yet installed: https://anythingllm.com/download
> After install:
>   1. Open AnythingLLM.
>   2. Settings → **Developer API** → **Generate API Key**.
>   3. Copy the key.
>   4. (Recommended) Configure the LLM provider to **Ollama** with **Gemma 4 E4B**:
>      - HuggingFace page: https://huggingface.co/bartowski/google_gemma-4-E4B-it-GGUF
>      - Ollama pull tag: `hf.co/bartowski/google_gemma-4-e4b-it-gguf:bf16`
>        (HuggingFace GGUF — supported by Ollama ≥ v0.3.13; pull via the AnythingLLM UI or `ollama pull`).
>      If Ollama is not installed, AnythingLLM can download it during the provider setup.
>      Any other model configured in AnythingLLM will also work — the plugin uses whatever the workspace is set to.

## Step 2 — Ask for the key

Ask the user **in chat** (not via `AskUserQuestion` — the key is free-form text, not a multiple choice):

> Paste your AnythingLLM API key here (or type `cancel` to abort).

Wait for the user's next message. If the response is `cancel`, stop and report that no changes were made.

Otherwise, treat the user's message as the API key. **Do not echo the key back in chat.**

## Step 3 — Save and verify

Run the save-and-verify script, passing the key via argv:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/save-api-key.js" "<paste-the-key-here>"
```

The script writes to `~/.claude/local-llm/config.json` and probes AnythingLLM. It prints a single-line JSON result to stdout with these shapes:

- `{ok:true, verified:true, phase:"ready", workspace:"claude-code"}` — green path.
- `{ok:true, verified:true, phase:"configuring"}` — key valid, workspace creation pending.
- `{ok:true, verified:false, phase:"auth_failed"}` — key saved but rejected; ask the user to check the key.
- `{ok:true, verified:false, phase:"not_running"}` — key saved; AnythingLLM is installed but not running.
- `{ok:true, verified:false, phase:"not_installed"}` — key saved; AnythingLLM must be installed first.

## Step 4 — Report

Tell the user:

- Where the key was saved (`~/.claude/local-llm/config.json`).
- Whether verification succeeded.
- If `ready`: ask the user to restart the session so the SessionStart hook picks up the new state.
- If `auth_failed`: offer to retry with a fresh key.
- If `not_installed`/`not_running`: give the download link / remind them to start the app, then restart the session.

Never log or echo the API key itself — only acknowledge receipt.
