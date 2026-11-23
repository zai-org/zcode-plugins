# Deep Research

Build the question and evidence chain around the video, supporting fact verification, provenance tracing, full-original search, research on related videos and material screening. External search is driven by the research goal; when local evidence is sufficient, form the conclusion directly.

## Build Clues from the Input

- With a video/screenshot, first read the input with `video_observe` and note the objects, actions, on-screen text, location, program and time clues relevant to the question; fetch a transcript only when speech is needed.
- With only a text recollection, break it into subject, action, scene and explicit details; keep hedged recollections such as "seems like" or "maybe" flexible.
- Break the research question into verifiable sub-questions, and record known facts, candidate explanations and gaps. Choose sites according to the user's search scope and candidate list; when a candidate pool already exists, check within the pool first.

## Alternate Search and Observation

1. `video_search(query, page, sites)` returns results and failure information per site. Start with a few topic keywords; adjust queries to the actual site language, and the same clue may be searched separately in different languages. Exact site names are tool configuration and source information; use them as returned.
2. When the target candidate is missing but results are relevant, page through later pages of the same query; only rephrase when results are too broad or entirely empty. A site error or timeout is a search gap and must not be treated as "the site does not have the target".
3. Titles are for filtering. Use `video_observe` to look at the candidate's relevant visuals, scanning coarsely first and then viewing likely matching time windows densely; use `video_metadata` to add description, date, uploader and part information.
4. When a candidate yields new clues, update the queries and sub-questions. State the reason for continuing to search; avoid iterating through results without a basis.
5. To verify same footage, use `video_compare(source, candidate)`, giving `offset_s` or a candidate crop region when needed (`crop="default"` or a `w:h[:x[:y]]` expression, such as `iw*0.8:ih*0.8`). When the input is a screenshot whose aspect ratio differs from the candidate's, the tool tries the left/centre/right (or top/middle/bottom) crops that would explain the difference by itself and reports `crop_search`; read `median_dist` (Hamming distance out of 64): a true frame re-saved as JPEG lands at 11–14, unrelated frames of the same game sit at 15–22, random footage near 32. Similarity, reuploads or same-frame matches only corroborate the footage relationship; the same event, occasion, location or another episode still requires content evidence. High scores on solid-color and low-texture footage are unreliable. A screenshot taken mid-dissolve, with an overlay, or shown inside another video with borders will not hash-match any raw recording: look for the edited video it came from, locate the moment by observation, and treat the visual comparison as the evidence.
6. When further local analysis or material delivery is needed, save the whole video with `video_download` and record the mapping between the remote URL/id and the local file; local and remote observation use the same `video_observe`.

For the judgment criteria of different research goals, see [Research Matching Criteria](../references/research-matching.md). Read it as needed; do not use "same footage" as the uniform completion criterion for all search tasks.

## Form the Conclusion

- Summarize the supporting evidence, conflicts and unresolved parts for each sub-question; distinguish visual facts, subtitles/transcripts, metadata, external sources and inferences.
- Every recommended candidate must have had its decisive segment actually observed, with a URL, source time and specific matching basis available. Looking only at titles cannot justify claiming the content is verified.
- For fact and provenance questions, give the conclusion and sources; for material searches, rank by confidence and state which conditions are satisfied. Deliver once sufficient evidence is found; for unfinished parts, keep the search scope and leads for continuation.
- When the user only asks for an answer, deliver it directly; for longer or combined research, save records per [Evidence and Delivery](../references/evidence-format.md) for later reuse in editing or creation.
