#!/usr/bin/env node
/**
 * @hook ss.llm.health
 * @version 0.2.0
 * @event SessionStart
 * @plugin local-llm
 * @description Check local LLM backend availability, auto-download model if
 *   missing, and inject delegation instructions into Claude's context.
 *
 *   Auto-download chain (tries in order):
 *   1. huggingface-cli download (resumable, verified)
 *   2. curl -L -C - (resumable, via Git for Windows)
 *   3. PowerShell Invoke-WebRequest (always available on Windows)
 *
 *   Model is cached in ~/.claude/local-llm/models/ so it persists across sessions.
 *
 *   Stdout → injected into Claude's context as system instructions.
 *   Stderr → shown in hook output (collapsed).
 */

require('../lib/plugin-guard');

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '../..');
const defaults = readJson(path.join(PLUGIN_ROOT, 'scripts', 'config.json'));
const globalCfg = readJson(path.join(os.homedir(), '.claude', 'local-llm', 'config.json'));
const projectCfg = readJson(path.join(process.cwd(), '.claude', 'local-llm', 'config.json'));

const backend = projectCfg.backend || globalCfg.backend || defaults.backend || 'llama-cpp';
const port = projectCfg.server?.port || globalCfg.server?.port || defaults.server?.port || 8787;
const host = projectCfg.server?.host || globalCfg.server?.host || defaults.server?.host || '127.0.0.1';

const configuredModelPath = projectCfg['llama-cpp']?.modelPath || globalCfg['llama-cpp']?.modelPath || defaults['llama-cpp']?.modelPath;
const ollamaModel = projectCfg.ollama?.model || globalCfg.ollama?.model || defaults.ollama?.model || 'gemma4:e4b';

// Model download metadata
const modelRepo = projectCfg.model?.repo || globalCfg.model?.repo || defaults.model?.repo || 'bartowski/google_gemma-4-E4B-it-GGUF';
const modelFile = projectCfg.model?.file || globalCfg.model?.file || defaults.model?.file || 'google_gemma-4-E4B-it-Q4_K_M.gguf';
const modelDisplayName = projectCfg.model?.displayName || globalCfg.model?.displayName || defaults.model?.displayName || 'Gemma 4 E4B Q4_K_M';

// Cache directory for auto-downloaded models
const MODEL_CACHE_DIR = path.join(os.homedir(), '.claude', 'local-llm', 'models');
const CACHED_MODEL_PATH = path.join(MODEL_CACHE_DIR, modelFile);

// ---------------------------------------------------------------------------
// Model path resolution: configured > cached > download
// ---------------------------------------------------------------------------

function resolveModelPath() {
  // 1. Explicitly configured path
  if (configuredModelPath && fs.existsSync(configuredModelPath)) {
    return { path: configuredModelPath, source: 'config' };
  }

  // 2. Cached download
  if (fs.existsSync(CACHED_MODEL_PATH)) {
    const stat = fs.statSync(CACHED_MODEL_PATH);
    // Reject suspiciously small files (incomplete downloads)
    if (stat.size > 1_000_000_000) {
      return { path: CACHED_MODEL_PATH, source: 'cache' };
    }
    // Incomplete file — will re-download (resume if tool supports it)
    console.error(`[local-llm] Cached model file too small (${(stat.size / 1e9).toFixed(2)} GB) — likely incomplete, re-downloading`);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Auto-download: try huggingface-cli → curl → PowerShell
// ---------------------------------------------------------------------------

function hasCommand(cmd) {
  try {
    execSync(`where ${cmd}`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function downloadModel() {
  const url = `https://huggingface.co/${modelRepo}/resolve/main/${modelFile}`;

  fs.mkdirSync(MODEL_CACHE_DIR, { recursive: true });

  console.error(`[local-llm] Model not found — downloading ${modelDisplayName}`);
  console.error(`[local-llm] Source: ${modelRepo}`);
  console.error(`[local-llm] Target: ${CACHED_MODEL_PATH}`);
  console.error(`[local-llm] This is a one-time download (~5.4 GB). Please wait...`);

  // Strategy 1: huggingface-cli (best — resumable, verified, progress bar)
  if (hasCommand('huggingface-cli')) {
    try {
      console.error('[local-llm] Downloading via huggingface-cli...');
      execSync(
        `huggingface-cli download "${modelRepo}" --include "${modelFile}" --local-dir "${MODEL_CACHE_DIR}"`,
        { stdio: ['pipe', 'pipe', 'inherit'], timeout: 600_000 }
      );
      // huggingface-cli may put the file in a subdirectory or with different name
      // Check both direct path and repo-style path
      if (fs.existsSync(CACHED_MODEL_PATH)) return true;
      const altPath = path.join(MODEL_CACHE_DIR, modelFile);
      if (fs.existsSync(altPath)) return true;
      // Search for the .gguf file in cache dir
      const found = findGgufFile(MODEL_CACHE_DIR);
      if (found) {
        if (found !== CACHED_MODEL_PATH) {
          fs.renameSync(found, CACHED_MODEL_PATH);
        }
        return true;
      }
    } catch (err) {
      console.error(`[local-llm] huggingface-cli failed: ${err.message}`);
    }
  }

  // Strategy 2: curl (common via Git for Windows — resumable with -C -)
  if (hasCommand('curl')) {
    try {
      console.error('[local-llm] Downloading via curl...');
      execSync(
        `curl -L -C - --progress-bar -o "${CACHED_MODEL_PATH}" "${url}"`,
        { stdio: ['pipe', 'pipe', 'inherit'], timeout: 600_000 }
      );
      if (fs.existsSync(CACHED_MODEL_PATH)) {
        const stat = fs.statSync(CACHED_MODEL_PATH);
        if (stat.size > 1_000_000_000) return true;
      }
    } catch (err) {
      console.error(`[local-llm] curl failed: ${err.message}`);
    }
  }

  // Strategy 3: PowerShell Invoke-WebRequest (always available on Windows)
  try {
    console.error('[local-llm] Downloading via PowerShell (no resume, may be slower)...');
    execSync(
      `powershell -NoProfile -Command "` +
      `$ProgressPreference = 'SilentlyContinue'; ` +
      `Invoke-WebRequest -Uri '${url}' -OutFile '${CACHED_MODEL_PATH}' -UseBasicParsing"`,
      { stdio: ['pipe', 'pipe', 'inherit'], timeout: 600_000 }
    );
    if (fs.existsSync(CACHED_MODEL_PATH)) {
      const stat = fs.statSync(CACHED_MODEL_PATH);
      if (stat.size > 1_000_000_000) return true;
    }
  } catch (err) {
    console.error(`[local-llm] PowerShell download failed: ${err.message}`);
  }

  return false;
}

function findGgufFile(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.gguf')) {
        return path.join(entry.parentPath || entry.path || dir, entry.name);
      }
    }
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

function checkHealth() {
  return new Promise((resolve) => {
    const url = backend === 'ollama'
      ? `http://${host}:11434/api/tags`
      : `http://${host}:${port}/health`;

    const req = http.get(url, { timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  let modelReady = false;
  let resolvedPath = null;

  if (backend === 'llama-cpp') {
    // Resolve model path (configured → cached → download)
    let resolved = resolveModelPath();

    if (!resolved) {
      // Model not found anywhere — auto-download
      const downloaded = downloadModel();
      if (downloaded) {
        resolved = resolveModelPath();
        if (resolved) {
          console.error(`[local-llm] Download complete: ${resolved.path}`);
        }
      } else {
        console.error('[local-llm] Auto-download failed. Install manually:');
        console.error(`  huggingface-cli download ${modelRepo} --include "${modelFile}" --local-dir "${MODEL_CACHE_DIR}"`);
        console.error('  Or set llama-cpp.modelPath in ~/.claude/local-llm/config.json');
      }
    }

    if (resolved) {
      resolvedPath = resolved.path;
      modelReady = true;
      console.error(`[local-llm] Model: ${resolvedPath} (${resolved.source})`);
    }
  } else {
    // Ollama backend — model pull handled by MCP server
    modelReady = true;
    console.error(`[local-llm] Backend: Ollama (model: ${ollamaModel})`);
  }

  const alive = await checkHealth();

  if (alive) {
    console.error(`[local-llm] Backend running (${backend} on port ${backend === 'ollama' ? 11434 : port})`);
  } else if (modelReady) {
    console.error(`[local-llm] Backend not running — will start lazily on first local_generate call`);
  }

  // Write resolved model path to temp file so MCP server can pick it up
  if (resolvedPath) {
    try {
      const flagPath = path.join(os.tmpdir(), 'dotclaude-local-llm-model-path');
      fs.writeFileSync(flagPath, resolvedPath, 'utf8');
    } catch {}
  }

  // Stdout: injected into Claude's context
  if (!modelReady && backend === 'llama-cpp') {
    process.stdout.write(
      `[local-llm] Model not available — auto-download failed. ` +
      `The local_generate MCP tool is disabled until the model is installed.\n`
    );
    return;
  }

  const modelName = backend === 'ollama' ? ollamaModel : modelDisplayName;
  const status = alive ? 'running' : 'available (lazy start on first call, ~15s model load)';

  process.stdout.write(
    `[local-llm] ${modelName} is ${status} via mcp__plugin_local-llm_dotclaude-local-llm__local_generate.\n` +
    `Read deep-knowledge/delegation-rules.md from the local-llm plugin (${PLUGIN_ROOT}/deep-knowledge/delegation-rules.md) ` +
    `for the decision matrix on when to delegate tasks to the local LLM.\n` +
    `\n` +
    `Quick rules — delegate to local_generate ONLY when ALL conditions are met:\n` +
    `  1. Task is mechanical code generation (boilerplate, DTOs, test files, CRUD, type defs)\n` +
    `  2. You can write a COMPLETE, UNAMBIGUOUS spec (signature + types + behavior)\n` +
    `  3. Output is >20 lines (below that, writing directly is faster)\n` +
    `  4. Task does NOT require cross-file reasoning, debugging, security, or architecture\n` +
    `  5. You WILL review the output before using it\n` +
    `NEVER delegate complex reasoning, debugging, refactoring, or ambiguous tasks.\n`
  );
})();
