# Model Configuration Reference — Gemma 4 E4B

Hardware-specific reference for running Gemma 4 E4B on consumer hardware.

## Model Specs

| Property | Value |
|----------|-------|
| Architecture | Dense transformer (NOT MoE) |
| Effective parameters | 4.5B |
| Total parameters (incl. embeddings) | ~8B |
| Layers | 42 |
| Attention | Hybrid: sliding-window local (512 tokens) + global full-context |
| Context window | 128K (theoretical), 8K-16K practical on 8GB VRAM |
| Vocabulary | 262,144 tokens |

## Quantization Guide (GTX 2080 Super — 8GB VRAM)

Recommended quantizations sorted by quality:

| Quant | File Size | Fits 8GB VRAM? | Context headroom | Quality |
|-------|-----------|-----------------|------------------|---------|
| Q5_K_M | 5.82 GB | Yes (1.5 GB free) | 4K-8K tokens | High — best quality that fits |
| **Q4_K_M** | **5.41 GB** | **Yes (2 GB free)** | **8K-12K tokens** | **Good — recommended default** |
| Q4_K_S | 5.24 GB | Yes (2.5 GB free) | 8K-16K tokens | Slightly lower |
| IQ4_XS | 5.11 GB | Yes (2.5 GB free) | 8K-20K tokens | Decent, very compact |
| Q8_0 | 8.03 GB | NO — needs split | Requires -ngl 36 | Excellent but slow on split |

**Primary recommendation: Q4_K_M** — best balance of quality, speed, and context headroom.

## llama-server Launch Commands

### Default (Q4_K_M, full GPU, 8K context):
```bash
llama-server -m /path/to/gemma-4-E4B-it-Q4_K_M.gguf -ngl 99 -c 8192 --host 127.0.0.1 --port 8787
```

### Larger context with KV cache quantization (16K context):
```bash
llama-server -m /path/to/gemma-4-E4B-it-Q4_K_M.gguf -ngl 99 -c 16384 --ctk q4_0 --ctv q4_0 --host 127.0.0.1 --port 8787
```

### Higher quality (Q5_K_M, less context headroom):
```bash
llama-server -m /path/to/gemma-4-E4B-it-Q5_K_M.gguf -ngl 99 -c 8192 --host 127.0.0.1 --port 8787
```

## Plugin Config Examples

### Minimal config (`~/.claude/local-llm/config.json`):
```json
{
  "llama-cpp": {
    "modelPath": "C:/models/gemma4-e4b/google_gemma-4-E4B-it-Q4_K_M.gguf"
  }
}
```

### Full config with KV cache quantization:
```json
{
  "llama-cpp": {
    "modelPath": "C:/models/gemma4-e4b/google_gemma-4-E4B-it-Q4_K_M.gguf",
    "gpuLayers": 99,
    "contextSize": 16384,
    "kvCacheQuantK": "q4_0",
    "kvCacheQuantV": "q4_0"
  },
  "server": {
    "port": 8787,
    "idleShutdownMs": 600000
  }
}
```

### Ollama backend:
```json
{
  "backend": "ollama",
  "ollama": {
    "model": "gemma4:e4b"
  }
}
```

**Ollama on Turing GPUs (GTX 2080 Super):** Set `OLLAMA_FLASH_ATTENTION=false` environment
variable to avoid a known GPU crash bug. The plugin's MCP server handles this automatically
when starting Ollama as a child process.

## Performance Expectations (GTX 2080 Super)

| Quant | Throughput (est.) | First token | Note |
|-------|-------------------|-------------|------|
| Q4_K_M (full GPU) | 20-35 tok/s | ~200ms | Best speed |
| Q5_K_M (full GPU) | 18-30 tok/s | ~250ms | Slightly slower, better quality |
| Q8_0 (split -ngl 36) | 10-20 tok/s | ~400ms | Not recommended |

Model load time (cold start): 10-30 seconds. Subsequent requests are instant.

## Download Commands

```bash
# Q4_K_M (recommended)
huggingface-cli download bartowski/google_gemma-4-E4B-it-GGUF \
  --include "google_gemma-4-E4B-it-Q4_K_M.gguf" \
  --local-dir C:/models/gemma4-e4b

# Q5_K_M (higher quality)
huggingface-cli download bartowski/google_gemma-4-E4B-it-GGUF \
  --include "google_gemma-4-E4B-it-Q5_K_M.gguf" \
  --local-dir C:/models/gemma4-e4b
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| CUDA out of memory | Model + KV cache exceeds 8GB | Reduce `-c` or use smaller quant |
| Very slow generation | Layers on CPU (split inference) | Ensure `-ngl 99` with Q4_K_M or Q5_K_M |
| Ollama GPU crash (Xid 43/31) | Flash Attention bug on Turing | Set `OLLAMA_FLASH_ATTENTION=false` |
| Empty/garbage output | Temperature too high | Use temperature 0.1-0.3 for code |
| Truncated output | max_tokens too low | Increase generation.maxTokens in config |
