# Channel feature flags (developer guide)

Not shipped: the marketplace ships `./plugins/devops` only, so this file never
reaches a consumer. The consumer-facing part is the "Channel features" section
of `plugins/devops/deep-knowledge/devops-config.md`.

## Model

Every release goes to all three channels (`alpha`, `beta`, `stable`). A
feature registered in `plugins/devops/features.json` is **offered** only to
consumers whose channel pin reaches its `minChannel`:

| Pin | Sees |
|---|---|
| `alpha` | alpha + beta features |
| `beta` | beta features |
| `stable` | none |

The pin is `~/.claude/plugins/.channels.json[<marketplace>]`, read via
`hooks/lib/channels.js` `readChannelPin`. The marketplace name comes from the
plugin root path (`…/cache/<mp>/devops/…`), else the first `devops@<mp>` key
in `~/.claude/plugins/installed_plugins.json`, else `dotclaude`.

The code is public on every channel. What the gate prevents is that a stable
user finds the feature by prompting, via a skill or a doc, or that Claude
pulls it in on its own.

## Contract

Registry `plugins/devops/features.json`:

```json
{ "features": { "<name>": {
  "minChannel": "alpha" | "beta",
  "summary": "<one line>",
  "docs": ["deep-knowledge/<file>.md"],
  "scripts": ["scripts/<file>.js"],
  "skills": ["skills/<dir>"]
} } }
```

`skills` is optional (gates the skill's `triggers.<lang>.txt` aliases in the
prompt dispatch glossary).

Library `plugins/devops/hooks/lib/features.js` (CommonJS, no deps, never throws,
cached per process):

| Export | Returns |
|---|---|
| `currentChannel(opts)` | `'alpha' \| 'beta' \| 'stable'` |
| `featureAllowed(name, opts)` | `boolean` |
| `gatedDocs(opts)` | `Set` of `deep-knowledge/…md` paths NOT allowed now |
| `gatedSkills(opts)` | `Set` of `skills/<dir>` NOT allowed now |
| `listFeatures(opts)` | `[{ name, minChannel, summary, docs, scripts, skills, allowed }]` |
| `allowedFeatureDocs(opts)` | `[{ feature, file, summary }]` of allowed gated docs |
| `docGated(file, opts)`, `readRegistry(opts)`, `marketplaceName(opts)`, `_resetCache()` | helpers |

`opts`: `pluginRoot`, `home`, `pluginsDir`, `marketplace`, `channel` — all
optional, for tests. There is no env override; tests inject via `opts` or a
temp `HOME`/`USERPROFILE` with its own `.channels.json`.

CLI `plugins/devops/scripts/feature-flag.js`: `check <name>` → exit 0 allowed,
126 not allowed (the plugin's "switched off" rc, as in `claude-api-safe.js`),
2 usage; `list` → JSON `{ channel, marketplace, registry, features }`.

Fail-closed rules: unknown name → not allowed; corrupt registry → nothing
allowed and every `deep-knowledge/*.md`, `scripts/*.js`, `skills/*` path in
the raw text is gated; invalid `minChannel` → `alpha`; missing or unreadable
pin → `stable`. A missing `features.json` means nothing is registered.

## Rules

1. **Register every alpha/beta feature** in `features.json` — name, minChannel,
   summary, and every doc, script and skill that belongs to it.
2. **Gate all four find-points:**
   - **SessionStart index** (`ss.knowledge.index.js`): gated docs are dropped
     from ALWAYS_ON and from the index list. Done centrally — nothing to add.
   - **Prompt dispatch** (`prompt.knowledge.dispatch.js`): gated docs are
     never injected or pointed to (TOPIC_MAP and `lib/knowledge-pointers.js`),
     gated skills' aliases stay out of the glossary. Done centrally — a TOPIC_MAP
     entry for a gated doc is fine.
   - **Scripts**: each registered script calls the flag first, before any
     I/O or network, and exits 126:
     ```js
     if (!require('../hooks/lib/features').featureAllowed('<name>')) {
       process.stderr.write('<name>: not available on this channel\n');
       process.exit(126);
     }
     ```
     For a module that is also `require`d, put the check in the
     `require.main === module` branch and in every exported entry point that
     would act.
   - **Skills**: a skill that belongs to a gated feature sets
     `disable-model-invocation: true` in its frontmatter (Claude never picks it
     on its own; the harness still lists it for slash use) and its first step
     runs `node "{PLUGIN_ROOT}/scripts/feature-flag.js" check <name>`; on rc 126
     it says the feature is not on this channel and stops. List the skill dir
     under `skills` in the registry.
3. **Never list a gated doc in `deep-knowledge/INDEX.md`** — every channel
   reads that file. The index hook appends allowed gated docs itself, with the
   feature `summary` as topic. Do not mention a gated feature in ungated docs,
   README prose or skill descriptions either.
4. **Context budget:** the bytes a gated feature adds to a non-matching
   channel's context must stay **< 0.1 %** of the injected total (in practice
   zero: the doc is filtered, not shortened). Measure on stable vs total:
   ```bash
   H=$(mktemp -d); mkdir -p "$H/.claude/plugins"; echo '{"dotclaude":"stable"}' > "$H/.claude/plugins/.channels.json"
   HOME="$H" USERPROFILE="$H" node -e "
     const {buildContext}=require('./plugins/devops/hooks/session-start/ss.knowledge.index.js');
     const f=require('./plugins/devops/hooks/lib/features.js');
     const ctx=buildContext(require('path').resolve('plugins/devops'));
     const names=f.listFeatures().flatMap(x=>[x.name,x.summary,...x.docs.map(d=>require('path').basename(d,'.md'))]).filter(Boolean);
     const hit=names.reduce((n,s)=>n+ctx.split(s).length-1,0);
     console.log({totalBytes:Buffer.byteLength(ctx),featureMentions:hit});"
   ```
   `featureMentions` must be 0; for the dispatch run the hook with a prompt
   that matches the feature's TOPIC_MAP patterns under the same `HOME` and
   check the doc is absent. `hooks/lib/features.test.js` pins both.
5. **Tests**: `hooks/lib/features.test.js` checks that every registry entry is
   well-formed, no gated doc is in INDEX.md, every existing registered script
   contains `featureAllowed(` and its feature name, both knowledge hooks
   consult the flags, and the stable index names no gated doc.

## Gated features

| Name | minChannel | Since | Status |
|---|---|---|---|
| `batch` | alpha | 0.304.0 | Message Batches API for unattended read-only jobs on the API credit |

Keep this table in sync with `features.json`.

## Graduating a feature

1. Move to the next channel: change `minChannel` `alpha` → `beta`.
2. Release to everyone: delete the entry from `features.json`, add its docs
   to `deep-knowledge/INDEX.md` (and the README if user-facing), drop the
   `featureAllowed` check from its scripts, and remove
   `disable-model-invocation` from its skill if it should be model-invoked.
   Update the table above (or remove the row and note it in the CHANGELOG).
