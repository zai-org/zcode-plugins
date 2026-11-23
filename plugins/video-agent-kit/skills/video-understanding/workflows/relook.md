# Video Relook

Use for Q&A on existing videos, segment localization, additional observation and conclusion verification. The goal is to find evidence that answers the question, increasing observation density as needed.

## Localize First, Then Gather Evidence

1. Read the question, candidate answers and valid existing records. Confirm the source path and time base; use `video_metadata` to read the duration only when you need to know the full video's range.
2. If the question gives a time, observe the corresponding window directly, keeping a few seconds of context when necessary. If the question points to the beginning/end, observe that part first; if it points to before or after some event, localize the event first. Choose a whole-video coarse scan or a transcript index only when the question has no location clue.
3. For dialogue-driven questions, prefer `video_observe(include_transcript=true)` to get the text of the relevant interval; for visual questions, prefer visuals. Once the transcript localizes the segment, observe that segment directly and avoid further useless whole-video scans.
4. After a coarse scan finds candidate segments, shorten the interval and raise fps. Each additional look targets one still-unresolved question: action order, counts, small text, briefly appearing objects, or the visuals that correspond to a line.
5. Answer once the evidence is sufficient; when the relevant content cannot be seen, first re-interpret the question and time, then widen the range. Do not re-verify facts that are already clear just to follow a fixed procedure.

## Sampling Choices

A whole-video coarse scan can use `num_frames=16` or `32`; for long videos this only yields a sampled overview. When the question requires a conclusion across the whole video, continue covering the necessary ranges by chapter or event. Reference values for local observation follow; adjust them to how fast the visuals change and to tool limits:

| Interval | Starting sampling reference |
| --- | --- |
| Several minutes or more | Sparse frames; localize the event first |
| Half a minute to two minutes | 0.5–1 fps |
| Ten to thirty seconds | 1–2 fps |
| Actions, counting or reading text within a few seconds | 2–8 fps, narrowing the window further when necessary |

Tool time labels mark positions on the sampling grid; when a precise cut point is needed, continue reading adjacent windows, and do not treat sparse sampling directly as frame-level localization.

## Speech and Special Constraints

- Embedded subtitles may differ from the actual speech, and transcripts may contain recognition errors. When the answer depends on original speech, note the evidence source; when an auditory judgment is needed but the current tools cannot return audio, state the gap.
- An empty transcript for the current window means the window has no usable text. Decide whether to continue transcribing only after confirming there is no audio track or the required range is sufficiently covered.

Deliver, for important conclusions, the corresponding source file, time in seconds, visible evidence/text source and uncertainty. For multiple-choice questions, give the option in the user's format; for open questions, answer the question directly.
