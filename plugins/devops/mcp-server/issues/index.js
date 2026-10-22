#!/usr/bin/env node
/**
 * Bootstrap for dotclaude-issues (#824): guarantees the SDK/zod resolve, then
 * loads the real server (./server.js). The split exists because ES static
 * imports hoist above any check — the server module must be imported dynamically.
 */
import { ensureDeps } from "../lib/ensure-deps.js";

await ensureDeps();
await import("./server.js");
