#!/usr/bin/env node
/**
 * @module dotclaude-local-llm-mcp
 * @version 0.2.0
 * @plugin local-llm
 * @description MCP server that proxies code generation requests to a local
 *   AnythingLLM Desktop instance over its OpenAI-compatible REST API. This
 *   server does NOT manage any model or backend process lifecycle — that is
 *   owned by the AnythingLLM app. We only speak HTTP to its workspace.
 *
 *   Tools:
 *   - local_generate  — send a structured coding prompt, get code back
 *   - local_status    — phase + workspace info, no side effects
 *   - local_shutdown  — no-op retained for backwards-compatible API surface
 *
 *   Stdout is the JSON-RPC wire — all logging goes to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_ROOT = resolve(__dirname, "..", "hooks", "lib");

const http = require(join(LIB_ROOT, "anythingllm-http.js"));
const lifecycle = require(join(LIB_ROOT, "anythingllm-lifecycle.js"));
const { resolveConfig, hasApiKey, USER_CONFIG_PATH } = require(join(LIB_ROOT, "anythingllm-config.js"));

const CONFIG = resolveConfig();
const BASE_URL = CONFIG.anythingllm?.baseUrl || "http://localhost:3001";
const WORKSPACE_SLUG = CONFIG.anythingllm?.workspaceSlug || "claude-code";
const API_KEY = CONFIG.anythingllm?.apiKey || "";
const TEMPERATURE_DEFAULT = CONFIG.generation?.temperature ?? 0.2;
const MAX_TOKENS_DEFAULT = CONFIG.generation?.maxTokens ?? 4096;

// ---------------------------------------------------------------------------
// Output sanitization
// ---------------------------------------------------------------------------

// Strip a single outer markdown fence ```lang ... ``` if present. Local
// models often ignore "no markdown" instructions and wrap their output, so
// callers consistently get a fenced block. We unwrap exactly one outer pair
// and leave inner fences (multi-block answers) untouched.
function stripOuterFence(text) {
  if (typeof text !== "string") return text;
  const trimmed = text.trim();
  const match = trimmed.match(/^```[a-zA-Z0-9_+\-.#]*\n([\s\S]*?)\n```$/);
  return match ? match[1] : trimmed;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

async function getPhase() {
  if (!hasApiKey(CONFIG)) {
    return {
      phase: "needs_api_key",
      ready: false,
      hint: `Run the local-llm-setup skill to store an AnythingLLM API key at ${USER_CONFIG_PATH}.`,
    };
  }

  const health = await http.checkHealth(BASE_URL);
  if (!health.online) {
    const install = lifecycle.detectInstallation();
    if (!install.installed) {
      return {
        phase: "not_installed",
        ready: false,
        hint: `AnythingLLM Desktop is not installed. Download: ${lifecycle.DOWNLOAD_URL}`,
      };
    }
    const running = lifecycle.isProcessRunning();
    return {
      phase: running ? "network_blocked" : "not_running",
      ready: false,
      hint: running
        ? `AnythingLLM is running but ${BASE_URL} is unreachable. Enable network access in Settings → API.`
        : `AnythingLLM is installed at ${install.path} but not running. Start the app.`,
    };
  }

  const auth = await http.verifyAuth(BASE_URL, API_KEY);
  if (!auth.valid) {
    return {
      phase: auth.errorType === "auth_failed" ? "auth_failed" : "network_blocked",
      ready: false,
      hint: `Auth probe failed: ${auth.error || auth.errorType}. Re-run local-llm-setup.`,
    };
  }

  const ws = await http.getWorkspaces(BASE_URL, API_KEY);
  if (!ws.ok) {
    return {
      phase: "network_blocked",
      ready: false,
      hint: `Workspace list failed: ${ws.error || ws.errorType}`,
    };
  }
  const exists = ws.workspaces.some((w) => w.slug === WORKSPACE_SLUG);
  if (!exists) {
    return {
      phase: "configuring",
      ready: false,
      hint: `Workspace "${WORKSPACE_SLUG}" not found. It will be auto-created on the next SessionStart.`,
    };
  }

  return { phase: "ready", ready: true, hint: null };
}

// ---------------------------------------------------------------------------
// Heartbeat (matches devops MCP servers)
// ---------------------------------------------------------------------------

function registerHeartbeat(name) {
  const pidFile = join(tmpdir(), `dotclaude-mcp-${name}.pid`);
  try {
    writeFileSync(pidFile, String(process.pid), "utf8");
    const cleanup = () => { try { unlinkSync(pidFile); } catch { /* ignore */ } };
    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); process.exit(0); });
    process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "dotclaude-local-llm",
  version: "0.2.0",
});

server.registerTool(
  "local_generate",
  {
    title: "Local LLM Code Generation",
    description:
      "Generate code via a local AnythingLLM Desktop workspace. " +
      "Use ONLY for mechanical, well-specified coding tasks (GREEN tier): " +
      "boilerplate, DTOs, test files from patterns, CRUD, type definitions, " +
      "repetitive variations. " +
      "NEVER use for: debugging, architecture, security-critical code, " +
      "cross-file reasoning, or ambiguous tasks. " +
      "Claude MUST formulate a complete, unambiguous prompt and MUST " +
      "review the output before using it.",
    inputSchema: z.object({
      task: z.string().describe(
        "Precise code generation task. Must be unambiguous and self-contained. " +
        "Include: language, function signature, expected behavior, types, constraints."
      ),
      context: z.string().optional().describe(
        "Relevant code context: existing types, interfaces, patterns to follow. " +
        "Keep under 2000 tokens — the local model has limited context (8K)."
      ),
      language: z.string().optional().describe(
        "Programming language (e.g., 'typescript', 'python', 'go')."
      ),
      temperature: z.number().min(0).max(1).optional().describe(
        "Generation temperature. Default 0.2 (deterministic). Never above 0.5 for code."
      ),
    }),
  },
  async ({ task, context, language, temperature }) => {
    const phase = await getPhase();
    if (!phase.ready) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ error: true, phase: phase.phase, hint: phase.hint }),
        }],
      };
    }

    const lang = language || "the appropriate language";
    const systemPrompt =
      "You are a code generation assistant. Output ONLY the requested code — " +
      "no explanations, no markdown fences, no commentary. " +
      "If the task specifies a function signature, match it exactly. " +
      "Follow the coding style shown in the context if provided.";

    let userPrompt = `Language: ${lang}\n\nTask: ${task}`;
    if (context) userPrompt += `\n\nContext (existing code to follow):\n${context}`;
    userPrompt += "\n\nGenerate the code:";

    const result = await http.chatCompletion(BASE_URL, API_KEY, {
      workspaceSlug: WORKSPACE_SLUG,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: temperature ?? TEMPERATURE_DEFAULT,
      maxTokens: MAX_TOKENS_DEFAULT,
    });

    if (!result.ok) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: true,
            phase: "request_failed",
            status: result.status,
            hint: result.error || result.errorType,
          }),
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          code: stripOuterFence(result.content),
          tokensUsed: result.tokensUsed,
          finishReason: result.finishReason,
          workspace: WORKSPACE_SLUG,
          note: "Review this output before using it. The local model may " +
                "produce incorrect code for edge cases.",
        }),
      }],
    };
  }
);

server.registerTool(
  "local_status",
  {
    title: "Local LLM Status",
    description:
      "Check if the local AnythingLLM backend is reachable and the workspace is ready. " +
      "Use to verify availability before delegating tasks.",
    inputSchema: z.object({}),
  },
  async () => {
    const phase = await getPhase();
    const install = lifecycle.detectInstallation();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          phase: phase.phase,
          ready: phase.ready,
          hint: phase.hint,
          baseUrl: BASE_URL,
          workspaceSlug: WORKSPACE_SLUG,
          hasApiKey: hasApiKey(CONFIG),
          installed: install.installed,
          installPath: install.path,
          processRunning: lifecycle.isProcessRunning(),
        }),
      }],
    };
  }
);

server.registerTool(
  "local_shutdown",
  {
    title: "Shutdown (no-op)",
    description:
      "Retained for API compatibility. AnythingLLM Desktop manages its own " +
      "process lifecycle — this plugin never spawns or kills the app.",
    inputSchema: z.object({}),
  },
  async () => ({
    content: [{
      type: "text",
      text: JSON.stringify({
        shutdown: false,
        message: "No-op. AnythingLLM Desktop is owned by the user, not this plugin.",
      }),
    }],
  })
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
registerHeartbeat("dotclaude-local-llm");
console.error("[dotclaude-local-llm] MCP server started on stdio");
