# Generation channels for person replacement

> When choosing a channel for replacing real people, content moderation weighs as much as generation quality. Everything below was measured, not inferred from documentation.

Every channel runs on ZCode ToolHub with the signed-in ZCode account; the plugin holds no keys.

| Step | ToolHub tool | Model | Notes |
|---|---|---|---|
| Storyboards (`swap_storyboards`) | `image_generate` | Seedream | Multi-image edit: the source frame first, then the character sheets. `size` is a tier (`1K` / `1.5K` / `2K`); the aspect follows the source frame |
| Window generation (`swap_generate`) | `minimax_h3_video` | MiniMax-H3 | One reference clip (2-15 s, H.264, no audio) + up to 9 reference images per request; 4-15 s output; `768P` baseline, `2K` showcase |
| (not for swap) | `video_generate` | Seedance 2.5 | Refuses source footage of real people at input (`PrivacyInformation: may contain real person`); fictional characters are not restricted |

## How `swap_generate` talks to ToolHub

- Reference media are https links, never inline data: the window clip and the images are uploaded through the ToolHub file endpoint first (10 MiB per file; the clip is re-encoded at a higher CRF until it fits).
- One Idempotency-Key per window, stored in `swap_out/tasks.json` before the submit. A lost response or an unknown outcome is replayed with the same key; only a clear refusal or a failed task clears the entry so the next run submits again.
- Polling every 10 s, up to 30 minutes per call; after that, rerun to keep collecting the same task (it is never resubmitted automatically).
- Failure codes: `MINIMAX_CONTENT_REJECTED` (change the prompt or the media - an identical retry is pointless), `MINIMAX_INVALID_INPUT` (fix parameters or media), `MINIMAX_TASK_FAILED` / `MINIMAX_TASK_CANCELED` / `WATERMARK_FAILED` / `RESULT_EXPIRED` (rerun).
- The text-level moderation is strict about wording: "slaps" was refused once and passed after rewording; a prompt that claims an identity is refused (upstream code 1046).
- The result link is temporary; the tool downloads it at once. ToolHub may add a visible "由 Z.ai 生成" watermark (on by default in the domestic region).

## Final configuration

- Generation: `minimax_h3_video`, **768P baseline** (the quality the user accepts; 2K is the showcase tier)
- Storyboards: `image_generate`, `2K` tier
- Concurrency: 6 by default; the provider account runs at most 30 tasks at once across all ToolHub callers, so keep a batch at about 10. Submits are staggered by 1-3 s
