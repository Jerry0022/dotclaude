---
name: youtube-transcript
description: Fetch and summarize the transcript of a YouTube video. Use when the user shares a YouTube URL and wants to know what's in it.
argument-hint: [YouTube URL or video ID]
allowed-tools: WebFetch, WebSearch
---

# YouTube Transcript

Fetch and summarize the YouTube video: `$ARGUMENTS`

## Steps

1. Extract the video ID from `$ARGUMENTS` (the part after `v=` or the short `youtu.be/<id>`).
2. Try fetching the transcript from `https://youtubetranscript.com/?server_vid2=<videoId>`.
3. If that fails, try `https://www.youtube.com/watch?v=<videoId>` and extract any available text.
4. If no transcript is available, search the web for `"<video title>" transcript` or `"<video title>" summary`.
5. Return a structured summary:

```markdown
## Video: <title>
**URL:** <url>
**Duration:** <if known>

### TL;DR
<2–3 sentence executive summary>

### Key Points
1. ...
2. ...
3. ...

### Notable Quotes / Examples
> "..."

### Action Items / Recommendations
- ...
```

## Rules
- Always credit the original source.
- If transcript is unavailable, clearly state it and offer web-search summary as fallback.
- Focus on extracting actionable insights, not just summarizing chronologically.
