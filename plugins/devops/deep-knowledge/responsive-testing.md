# Responsive Testing — Multi-Viewport Verification via Edge DevTools

Multi-device web apps require verification at phone, tablet, and desktop
breakpoints. This file defines how to perform responsive testing via Chrome-MCP
in Edge without needing separate physical devices.

---

## Viewport Presets

| Key | Device | Width × Height | Use case |
|-----|--------|---------------|----------|
| `mobile-ios` | iPhone SE | 375 × 667 | Phone portrait — smallest common iOS viewport |
| `mobile-android` | Pixel 7 | 393 × 851 | Phone portrait — typical modern Android, taller aspect |
| `tablet-ios` | iPad | 768 × 1024 | Tablet portrait — iOS breakpoint boundary |
| `tablet-android` | Galaxy Tab S9 | 800 × 1280 | Tablet portrait — typical Android tablet aspect |
| `desktop` | Standard | 1280 × 800 | Baseline for all web projects |

Android variants matter because Android phones are typically **taller** than
iPhones (longer aspect ratio) and Android tablets are **wider in portrait**
than iPads — both can trigger layout regressions that iOS-only testing misses.

---

## How to Activate via Chrome-MCP

Use `javascript_tool` to resize the viewport before taking a screenshot or
snapshot. The snippet below resizes both the window and the document root so
that CSS media queries fire correctly for visual tests.

```js
// Viewport resize snippet — run via javascript_tool
// Replace W and H with the target dimensions (e.g. 375, 667).
(function setViewport(w, h) {
  // Attempt CDP-style metrics override via window API (available in some
  // Chrome-MCP versions that expose DevTools protocol).
  if (window.__cdpEmulateViewport) {
    window.__cdpEmulateViewport(w, h);
    return 'cdp';
  }
  // Fallback: resize window and force document width via inline style.
  // Works for visual snapshot/screenshot tests; does NOT emulate touch events.
  try { window.resizeTo(w, h); } catch (_) {}
  document.documentElement.style.width  = w + 'px';
  document.documentElement.style.height = h + 'px';
  document.documentElement.style.overflow = 'hidden';
  return 'resize';
})(375, 667);
```

**Important limitations:**
- `window.resizeTo` is restricted in some browser security contexts (cross-origin
  iframes). It works reliably on `localhost` dev servers.
- Setting `style.width` on `<html>` forces layout reflow but does **not** emulate
  touch events, device-pixel-ratio, or pointer type.
- For reliable touch-event emulation and pixel-ratio testing, use **Playwright**
  (`playwright_navigate` with `device` descriptor). This snippet is sufficient for
  layout and breakpoint verification, not for interaction tests.

To restore default desktop size after a viewport test, call the snippet with
`(1280, 800)`.

---

## Workflow

1. Navigate to the page (`navigate` or `preview_start` depending on profile).
2. For each viewport in order (mobile-ios → mobile-android → tablet-ios →
   tablet-android → desktop):
   a. Run the resize snippet via `javascript_tool`.
   b. Call `preview_snapshot` to verify content and DOM structure.
   c. Call `preview_screenshot` to capture visual layout.
3. Compare states — flag regressions where content overflows, is hidden, or
   breaks layout at a given breakpoint.
4. Restore desktop viewport (1280 × 800) when done.

---

## When to Use

Trigger responsive testing on every UI change in web profiles:

- `web-vite` — any component, style, or template change
- `web-angular` — any component, template, or SCSS change
- `ha-config` — any dashboard card or Lovelace UI change

The [decision matrix in test-autonomy.md](test-autonomy.md) maps change scope
to tool-chain for each profile.

---

## When NOT to Use

Skip responsive testing entirely for:

- Backend-only changes (API routes, database models, services)
- CLI projects (`cli-node` profile)
- Library projects (`lib` profile) without a UI
- Home Assistant integrations (`ha-integration` profile — Python only, no frontend)
- Pure config or build/infra changes with no visual output
