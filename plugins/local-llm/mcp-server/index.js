#!/usr/bin/env node
/**
 * @module dotclaude-local-llm-mcp
 * @version 0.1.0
 * @plugin local-llm
 * @description MCP server that proxies code generation requests to a local
 *   Gemma 4 E4B instance (llama-server or Ollama). Manages backend lifecycle:
 *   lazy start on first call, auto-shutdown on idle.
 *
 *   Tools:
 *   - local_generate  — send a structured coding prompt, get code back
 *   - local_status    — health check + model info
 *   - local_shutdown  — free VRAM by stopping the backend
 *
 *   Stdout is the JSON-RPC wire — all logging goes to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Config resolution: project > global > plugin defaults
// ---------------------------------------------------------------------------

function readJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}

function resolveConfig() {
  const defaults = readJson(join(PLUGIN_ROOT, "scripts", "config.json"));
  const global = readJson(join(homedir(), ".claude", "local-llm", "config.json"));
  const project = readJson(join(process.cwd(), ".claude", "local-llm", "config.json"));

  // Deep merge one level
  const merged = { ...defaults };
  for (const layer of [global, project]) {
    for (const [k, v] of Object.entries(layer)) {
      if (v && typeof v === "object" && !Array.isArray(v) && merged[k] && typeof merged[k] === "object") {
        merged[k] = { ...merged[k], ...v };
      } else {
        merged[k] = v;
      }
    }
  }
  return merged;
}

const CONFIG = resolveConfig();
const PORT = CONFIG.server?.port || 8787;
const HOST = CONFIG.server?.host || "127.0.0.1";
const IDLE_MS = CONFIG.server?.idleShutdownMs || 600_000;
const BASE_URL = CONFIG.backend === "ollama"
  ? `http://${HOST}:11434`
  : `http://${HOST}:${PORT}`;

// ---------------------------------------------------------------------------
// Model path auto-resolution: configured > hook flag > cache dir
// ---------------------------------------------------------------------------

const MODEL_FILE = CONFIG.model?.file || "google_gemma-4-E4B-it-Q4_K_M.gguf";
const MODEL_CACHE_DIR = join(homedir(), ".claude", "local-llm", "models");

function resolveModelPath() {
  // 1. Explicitly configured
  const configured = CONFIG["llama-cpp"]?.modelPath;
  if (configured && existsSync(configured)) return configured;

  // 2. Path written by SessionStart hook (temp flag file)
  try {
    const flagPath = join(tmpdir(), "dotclaude-local-llm-model-path");
    if (existsSync(flagPath)) {
      const hookPath = readFileSync(flagPath, "utf8").trim();
      if (hookPath && existsSync(hookPath)) return hookPath;
    }
  } catch {}

  // 3. Default cache directory
  const cached = join(MODEL_CACHE_DIR, MODEL_FILE);
  if (existsSync(cached)) {
    const stat = statSync(cached);
    if (stat.size > 1_000_000_000) return cached;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Backend lifecycle
// ---------------------------------------------------------------------------

let backendProcess = null;
let idleTimer = null;
let startedAt = null;
let requestCount = 0;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.error("[local-llm] Idle timeout reached — shutting down backend");
    shutdownBackend();
  }, IDLE_MS);
}

async function isBackendAlive() {
  try {
    const url = CONFIG.backend === "ollama"
      ? `${BASE_URL}/api/tags`
      : `${BASE_URL}/health`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

function findLlamaServer() {
  const configured = CONFIG["llama-cpp"]?.serverPath;
  if (configured && existsSync(configured)) return configured;

  // Check common Windows locations
  const candidates = [
    join(homedir(), "llama.cpp", "build", "bin", "Release", "llama-server.exe"),
    join(homedir(), "llama.cpp", "build", "bin", "llama-server.exe"),
    "C:\\llama.cpp\\build\\bin\\Release\\llama-server.exe",
    "C:\\llama.cpp\\llama-server.exe",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // Assume it's in PATH
  return "llama-server";
}

async function startBackend() {
  if (await isBackendAlive()) {
    console.error("[local-llm] Backend already running");
    resetIdleTimer();
    return true;
  }

  if (CONFIG.backend === "ollama") {
    return startOllama();
  }
  return startLlamaCpp();
}

async function startLlamaCpp() {
  const modelPath = resolveModelPath();
  if (!modelPath) {
    throw new Error(
      "Model not found. The SessionStart hook should have downloaded it automatically.\n" +
      "If this persists, download manually:\n" +
      `  huggingface-cli download ${CONFIG.model?.repo || "bartowski/google_gemma-4-E4B-it-GGUF"} ` +
      `--include "${MODEL_FILE}" --local-dir "${MODEL_CACHE_DIR}"\n` +
      "Or set llama-cpp.modelPath in ~/.claude/local-llm/config.json"
    );
  }

  const serverPath = findLlamaServer();
  const gpuLayers = CONFIG["llama-cpp"]?.gpuLayers ?? 99;
  const ctxSize = CONFIG["llama-cpp"]?.contextSize ?? 8192;
  const extraArgs = CONFIG["llama-cpp"]?.extraArgs || [];

  const args = [
    "-m", modelPath,
    "-ngl", String(gpuLayers),
    "-c", String(ctxSize),
    "--host", HOST,
    "--port", String(PORT),
  ];

  // KV cache quantization (saves VRAM, enables larger context)
  const kvK = CONFIG["llama-cpp"]?.kvCacheQuantK;
  const kvV = CONFIG["llama-cpp"]?.kvCacheQuantV;
  if (kvK) args.push("--ctk", kvK);
  if (kvV) args.push("--ctv", kvV);

  args.push(...extraArgs);

  console.error(`[local-llm] Starting llama-server: ${serverPath} ${args.join(" ")}`);

  backendProcess = spawn(serverPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    windowsHide: true,
  });

  backendProcess.stderr.on("data", (d) => {
    const line = d.toString().trim();
    if (line) console.error(`[llama-server] ${line}`);
  });

  backendProcess.on("exit", (code) => {
    console.error(`[local-llm] llama-server exited with code ${code}`);
    backendProcess = null;
    startedAt = null;
  });

  // Wait for server to become ready (model loading can take 10-30s)
  const ready = await waitForBackend(60_000);
  if (ready) {
    startedAt = new Date();
    resetIdleTimer();
  }
  return ready;
}

async function startOllama() {
  // Ollama manages its own server — just ensure model is available
  const model = CONFIG.ollama?.model || "gemma4:e4b";

  // Check if ollama serve is running
  if (!(await isBackendAlive())) {
    console.error("[local-llm] Starting ollama serve...");
    backendProcess = spawn("ollama", ["serve"], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
      windowsHide: true,
      env: { ...process.env, OLLAMA_FLASH_ATTENTION: "false" },
    });
    backendProcess.on("exit", () => { backendProcess = null; startedAt = null; });

    const ready = await waitForBackend(30_000);
    if (!ready) return false;
  }

  // Ensure model is pulled
  try {
    const res = await fetch(`${BASE_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    if (!models.some(m => m.startsWith(model.split(":")[0]))) {
      console.error(`[local-llm] Pulling model ${model}...`);
      await fetch(`${BASE_URL}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model, stream: false }),
        signal: AbortSignal.timeout(600_000),
      });
    }
  } catch (err) {
    console.error(`[local-llm] Model check/pull failed: ${err.message}`);
  }

  startedAt = new Date();
  resetIdleTimer();
  return true;
}

async function waitForBackend(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isBackendAlive()) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  console.error("[local-llm] Backend failed to start within timeout");
  return false;
}

function shutdownBackend() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (backendProcess) {
    console.error("[local-llm] Stopping backend process");
    try { backendProcess.kill("SIGTERM"); } catch { /* ignore */ }
    backendProcess = null;
    startedAt = null;
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible API client
// ---------------------------------------------------------------------------

async function generate(systemPrompt, userPrompt, opts = {}) {
  const started = await startBackend();
  if (!started) throw new Error("Backend not available — check config and model path");

  requestCount++;
  resetIdleTimer();

  const temp = opts.temperature ?? CONFIG.generation?.temperature ?? 0.2;
  const maxTokens = opts.maxTokens ?? CONFIG.generation?.maxTokens ?? 4096;

  const url = CONFIG.backend === "ollama"
    ? `${BASE_URL}/v1/chat/completions`
    : `${BASE_URL}/v1/chat/completions`;

  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: userPrompt });

  const body = {
    messages,
    temperature: temp,
    max_tokens: maxTokens,
    stream: false,
  };

  if (CONFIG.backend === "ollama") {
    body.model = CONFIG.ollama?.model || "gemma4:e4b";
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error("No response from backend");

  return {
    content: choice.message?.content || "",
    tokensUsed: data.usage?.total_tokens || null,
    finishReason: choice.finish_reason || "unknown",
  };
}

// ---------------------------------------------------------------------------
// Heartbeat (same pattern as devops MCP servers)
// ---------------------------------------------------------------------------

function registerHeartbeat(name) {
  const pidFile = join(tmpdir(), `dotclaude-mcp-${name}.pid`);
  try {
    writeFileSync(pidFile, String(process.pid), "utf8");
    const cleanup = () => { try { unlinkSync(pidFile); } catch {} };
    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); shutdownBackend(); process.exit(0); });
    process.on("SIGTERM", () => { cleanup(); shutdownBackend(); process.exit(0); });
  } catch {}
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "dotclaude-local-llm",
  version: "0.1.0",
});

// --- Tool: local_generate ---

server.registerTool(
  "local_generate",
  {
    title: "Local LLM Code Generation",
    description:
      "Generate code using the local Gemma 4 E4B model. " +
      "Use ONLY for mechanical, well-specified coding tasks (GREEN tier): " +
      "boilerplate, DTOs, test files from patterns, CRUD operations, " +
      "type definitions, repetitive variations. " +
      "NEVER use for: debugging, architecture, security-critical code, " +
      "cross-file reasoning, or ambiguous tasks. " +
      "Claude MUST formulate a complete, unambiguous prompt and MUST " +
      "review the output before using it. " +
      "Starts the backend lazily on first call (may take 10-30s for model loading).",
    inputSchema: z.object({
      task: z.string().describe(
        "Precise code generation task. Must be unambiguous and self-contained. " +
        "Include: language, function signature, expected behavior, types, constraints. " +
        "Example: 'TypeScript: Create an interface UserDTO with fields id (number), " +
        "name (string), email (string), createdAt (Date), roles (string[])'."
      ),
      context: z.string().optional().describe(
        "Relevant code context: existing types, interfaces, patterns to follow. " +
        "Keep under 2000 tokens — the local model has limited context (8K)."
      ),
      language: z.string().optional().describe(
        "Programming language (e.g., 'typescript', 'python', 'go'). " +
        "Helps the model produce correctly formatted output."
      ),
      temperature: z.number().min(0).max(1).optional().describe(
        "Generation temperature. Default 0.2 (deterministic). Use 0.0 for exact patterns, " +
        "up to 0.5 for creative variations. Never above 0.5 for code."
      ),
    }),
  },
  async ({ task, context, language, temperature }) => {
    const lang = language || "the appropriate language";

    const systemPrompt =
      "You are a code generation assistant. Output ONLY the requested code — " +
      "no explanations, no markdown fences, no commentary. " +
      "If the task specifies a function signature, match it exactly. " +
      "Follow the coding style shown in the context if provided.";

    let userPrompt = `Language: ${lang}\n\nTask: ${task}`;
    if (context) {
      userPrompt += `\n\nContext (existing code to follow):\n${context}`;
    }
    userPrompt += "\n\nGenerate the code:";

    try {
      const result = await generate(systemPrompt, userPrompt, { temperature });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            code: result.content,
            tokensUsed: result.tokensUsed,
            finishReason: result.finishReason,
            model: CONFIG.backend === "ollama"
              ? (CONFIG.ollama?.model || "gemma4:e4b")
              : "gemma-4-e4b",
            note: "Review this output before using it. The local model may " +
                  "produce incorrect code for edge cases.",
          }),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: true,
            message: err.message,
            hint: err.message.includes("model path")
              ? "Configure the model path in .claude/local-llm/config.json"
              : err.message.includes("not available")
              ? "Ensure llama-server or Ollama is installed"
              : "Check backend logs for details",
          }),
        }],
      };
    }
  }
);

// --- Tool: local_status ---

server.registerTool(
  "local_status",
  {
    title: "Local LLM Status",
    description:
      "Check if the local LLM backend is running and report model info. " +
      "Use to verify availability before delegating tasks.",
    inputSchema: z.object({}),
  },
  async () => {
    const alive = await isBackendAlive();

    const status = {
      running: alive,
      backend: CONFIG.backend,
      port: CONFIG.backend === "ollama" ? 11434 : PORT,
      model: CONFIG.backend === "ollama"
        ? (CONFIG.ollama?.model || "gemma4:e4b")
        : (resolveModelPath() || "not found — restart session to trigger auto-download"),
      startedAt: startedAt?.toISOString() || null,
      requestCount,
      gpuLayers: CONFIG["llama-cpp"]?.gpuLayers ?? 99,
      contextSize: CONFIG["llama-cpp"]?.contextSize ?? 8192,
      idleShutdownMinutes: Math.round(IDLE_MS / 60_000),
    };

    if (alive && CONFIG.backend !== "ollama") {
      try {
        const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
        const health = await res.json();
        status.slots = health.slots_idle ?? null;
        status.slotsProcessing = health.slots_processing ?? null;
      } catch {}
    }

    return {
      content: [{ type: "text", text: JSON.stringify(status) }],
    };
  }
);

// --- Tool: local_shutdown ---

server.registerTool(
  "local_shutdown",
  {
    title: "Shutdown Local LLM",
    description:
      "Stop the local LLM backend to free GPU VRAM. " +
      "Use when done with mechanical tasks or when VRAM is needed for other work. " +
      "The backend will be restarted automatically on the next local_generate call.",
    inputSchema: z.object({}),
  },
  async () => {
    const wasRunning = backendProcess !== null || await isBackendAlive();
    shutdownBackend();

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          shutdown: true,
          wasRunning,
          message: wasRunning
            ? "Backend stopped — VRAM freed. Will restart on next local_generate call."
            : "Backend was not running.",
        }),
      }],
    };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
registerHeartbeat("dotclaude-local-llm");
console.error("[dotclaude-local-llm] MCP server started on stdio");
