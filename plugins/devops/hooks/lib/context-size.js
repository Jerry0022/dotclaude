/**
 * @module context-size
 * @version 0.1.0
 * @plugin devops
 * @description Estimate the CURRENT context size of a session from its
 *   transcript, for hooks that want to warn before a context-hungry step.
 *
 *   Every API call re-reads the whole context, and the transcript records
 *   that per assistant message as `usage`: `input_tokens` +
 *   `cache_read_input_tokens` + `cache_creation_input_tokens` is exactly
 *   the number of tokens the model was handed on that call — i.e. the
 *   context size at that moment. The newest assistant line in the file is
 *   therefore the best available estimate of what the NEXT call will cost,
 *   no API needed (measured 2026-09-21: a /ship at session end ran 16 calls
 *   × Ø 434 k tokens — 99 % of it cache reads — and made up ~24 % of the
 *   whole session's tokens).
 *
 *   Reads only a tail slice of the file (the last assistant line is within
 *   the last few hundred KB even after a huge tool result), never the whole
 *   transcript. Returns null when nothing usable is found — a caller must
 *   treat null as "unknown", never as "small".
 *
 *   A `compact_boundary` newer than every assistant line means the session
 *   was just compacted: the newest `usage` predates the compaction and
 *   describes a context that no longer exists. That is unknown (null), not
 *   the old size — reading past the boundary made the ship-compact advice
 *   fire again right after the user compacted (3 of 8 fires, 2026-09-22).
 */

const fs = require('fs');

/** Tail bytes to scan. A single tool result can be 100 KB+; the assistant
 *  line that follows it sits right after, so 512 KB covers every practical
 *  case without reading a multi-MB file. */
const TAIL_BYTES = 512 * 1024;

/**
 * Sum the tokens the model was handed on one call.
 * @param {object} usage — the `message.usage` object of an assistant line
 * @returns {number}
 */
function contextOfUsage(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  return (usage.input_tokens || 0)
    + (usage.cache_read_input_tokens || 0)
    + (usage.cache_creation_input_tokens || 0);
}

/**
 * Newest assistant `usage` in a transcript slice.
 * @param {string} text — JSONL text (may start mid-line)
 * @returns {number|null} context tokens of the newest assistant call, or null
 */
function contextFromTranscriptText(text) {
  if (!text) return null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.includes('"compact_boundary"')) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'system' && obj.subtype === 'compact_boundary') return null;
      } catch { /* truncated slice line — not a boundary we can trust */ }
    }
    // cheap pre-filter before JSON.parse — most lines are tool results
    if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'assistant' || obj.isSidechain) continue;
    const n = contextOfUsage(obj.message && obj.message.usage);
    if (n > 0) return n;
  }
  return null;
}

/**
 * Current context size of the session behind `transcriptPath`.
 * @param {string} transcriptPath — `hook.transcript_path`
 * @returns {number|null} tokens, or null when unknown
 */
function currentContextTokens(transcriptPath) {
  if (!transcriptPath) return null;
  let fd;
  try {
    const size = fs.statSync(transcriptPath).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, start);
    return contextFromTranscriptText(buf.toString('utf8'));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

/** "434 k" — the one format every hook message uses. */
function formatTokens(n) {
  if (n == null) return '?';
  return `${Math.round(n / 1000)} k`;
}

module.exports = { TAIL_BYTES, contextOfUsage, contextFromTranscriptText, currentContextTokens, formatTokens };
