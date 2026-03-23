---
name: youtube-transcript
description: >-
  Fetch and summarize the transcript of a YouTube video. Use when the user
  shares a YouTube URL and wants to know what's in it. Also triggers on:
  "summarize this video", "fass das Video zusammen", "what does this talk
  about" when a YouTube link is present, "YouTube transcript", or when the
  user pastes a youtu.be or youtube.com link and asks about its content.
argument-hint: "[YouTube URL or video ID] [--at MM:SS]"
allowed-tools: WebFetch, WebSearch
---

# YouTube Transcript

Fetch and summarize the YouTube video: `$ARGUMENTS`

## Arguments

- **URL or video ID**: The YouTube video to fetch (required).
- **`--at MM:SS`**: Jump to a specific timestamp and focus the summary on that section (optional).

## Step 1 — Extract video ID

Parse `$ARGUMENTS` to get the video ID:
- `youtube.com/watch?v=<ID>` → extract after `v=`
- `youtu.be/<ID>` → extract after `/`
- Raw 11-character ID → use directly

## Step 2 — Fetch transcript (robust fallback chain)

Try these sources in order, moving to the next only if the previous fails:

1. **Primary**: `https://youtubetranscript.com/?server_vid2=<videoId>`
2. **Fallback 1**: Fetch the YouTube page directly (`https://www.youtube.com/watch?v=<videoId>`) and extract any embedded transcript data.
3. **Fallback 2**: WebSearch for `"<video title>" transcript site:reddit.com OR site:github.com`
4. **Fallback 3**: WebSearch for `"<video title>" summary` — clearly label this as a third-party summary, not a transcript.

If no transcript is available through any source, clearly state this and offer the web-search summary as a best-effort alternative.

## Step 3 — Timestamp handling

If `--at MM:SS` was provided:
- Locate the relevant section in the transcript (within ±2 minutes of the timestamp).
- Focus the summary on that specific section.
- Provide context from surrounding sections if needed.

## Step 4 — Generate summary

Match the summary language to the user's conversation language (German if they speak German, etc.).

```markdown
## Video: <title>
**URL:** <url>
**Dauer:** <if known>

### TL;DR
<2–3 sentence executive summary>

### Wichtigste Punkte
1. ...
2. ...
3. ...

### Bemerkenswerte Aussagen
> "<short quote, max 14 words>"

### Handlungsempfehlungen
- ...
```

## Step 5 — Interactive follow-up

After the summary, offer: "Soll ich auf einen bestimmten Teil genauer eingehen, oder ein bestimmtes Thema aus dem Video vertiefen?"

## Rules

- Always credit the original source with URL.
- If transcript is unavailable, clearly state it — don't pretend a web-search summary is a transcript.
- Focus on extracting actionable insights, not just summarizing chronologically.
- Respect copyright: never reproduce large chunks of transcript text. Summarize in your own words.
- Short quotes (max 14 words) in quotation marks are fine for notable statements.
