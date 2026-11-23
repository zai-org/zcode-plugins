---
name: video-understanding
description: Understand videos, verify local details, or conduct deep research around a video, checking facts and provenance and finding the full original video and related materials. Use for Q&A on local videos, on-demand relook, and research tasks that combine cross-site video search with visual evidence.
---

# Video Understanding

Build evidence around the user's question. Use the unified video tools: `video_observe` to observe local or remote materials, `video_metadata` to read metadata, `video_search` to search, `video_download` to save full materials, and `video_compare` to help verify same-footage matches. Speech transcription reuses the shared `transcribe` capability.

## Select a Workflow

- To answer questions about an existing video, localize an action or line, or verify an existing conclusion: read [Video Relook](workflows/relook.md).
- To check facts and provenance in a video, find the original video from a clip/screenshot/recollection, or search related videos and synthesize a conclusion: read [Deep Research](workflows/deep-research.md).
- For combined tasks, first build evidence from the inputs, then search candidates, and finally relook at the decisive segments. All stages share source and time localization; avoid re-acquiring valid evidence.

## Shared Conventions

- `source` in tool parameters takes a local path, a supported video page URL, or an id returned verbatim by search. Time parameters are always in seconds; frame labels and `data.evidence[].time_s` are source-material time.
- Visual facts come from images actually read. `video_observe` returns a contact sheet by default, and `layout=frames` returns individual frame images; contact sheets are arranged from top-left to bottom-right, and the evidence index gives the time, image path and cell number. When a detail is unclear, read the corresponding individual frame or narrow the time window.
- Use either `fps` or `num_frames`, not both; the tool reports sampling-rate reduction, missing decoded frames and images not returned. Use only evidence actually received and read for conclusions, and look again at missed parts as the task requires.
- `include_transcript=true` uses embedded text subtitles or the shared transcription service (the whole video is recognized once, and later windows on the same material bytes and language reuse it); frames are not fetched by default in this case, and explicit `include_frames=true` fetches them as well. Neither subtitles nor transcripts equal actual listening; having no text for the current interval does not mean the whole video is silent.
- The image count accumulates over the session. Choose an observation range and sampling density that can answer the question; full temporal order, fast actions and briefly shown text need dense local viewing.
- Basic metadata, titles and similarity are for localization and cross-checking; they do not on their own prove video events or a person's identity. Truthfully record unreadable evidence, search failures, conflicting sources and uncertainty.
- Use the delivery format the user specifies. For combined or structured tasks, keep resumable records per [Evidence and Delivery](references/evidence-format.md); standalone Q&A can be answered directly without being forced to write a fixed evaluation file.
