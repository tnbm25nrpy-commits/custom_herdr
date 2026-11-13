---
name: show-image
description: REQUIRED inside herdr-app (HC_TERMINAL_ID set) whenever you take, render or Read an image the user should see - screenshots of UI you changed, before/after, charts, designs, bug repros. Sends it to the herdr-app "Show" panel next to the session, where the user can mark it up and send it back. Also use when the user says "show me", "let me see", "screenshot". The user cannot see images you Read; a hook blocks your stop if you skip this.
---

# show-image

**Rule:** inside herdr-app, every image the user should look at goes to the Show panel. Do it right after
capturing/reading it, not at the end. Hooks (~/.claude/hooks/show-enforce.mjs) remind you after a screenshot
or image Read, and block the end of your turn if images were touched but none was shown.

The user runs Claude inside **herdr-app**. Images you `Read` are visible only to you. To put one
in front of the user, send it to the **Show panel** (right side of the window, opens by itself):

```powershell
powershell -NoProfile -File "$HOME\.claude\scripts\show-image.ps1" "<absolute path>" -Title "<what this shows>" -Group "<topic>"
```

- `-Group "<topic>"`: the panel groups cards into collapsible sections. Use one short group name per
  task/topic (e.g. "Login bug", "Tab bar redesign") and reuse the exact same string for related images
  (before/after, iterations). Without `-Group`, images fall into a section named after the sending tab.

- Each call adds a card (newest on top). Earlier ones stay, so before/after pairs work: send
  "before" first, then "after".
- Give a short, useful `-Title` ("Pricing page after fix, 1440px").
- Any image format works (png/jpg/gif/webp/bmp kept, others converted to PNG via ffmpeg).
- The user can mark the image up (arrows, boxes, circles, notes, numbered steps) and click
  **Send back**. It then arrives in your prompt as `[Image #n]` (usually `<name>.marked.png`).
  Treat the marks as their review comments: numbered badges are ordered points, notes are instructions.
- If `HC_TERMINAL_ID` is unset you are not in herdr-app: tell the user the file path instead.

## Getting a screenshot first

- Web page or local dev server: Claude in Chrome screenshot, or Playwright
  `npx playwright screenshot --full-page <url> <out.png>`, then show it.
- The herdr window itself: `herdr-app shot <out.png>`.
- Save screenshots under the project in `.screenshots/` (or `%TEMP%` for throwaway ones),
  never on the Desktop.
