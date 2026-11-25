# Evidence and Delivery

Follow the user's format first. Ordinary Q&A can give the answer, source and time directly; complex research and tasks that will hand off to editing/creation may save JSON or Markdown.

Recommended contents: research goal, conclusion, source list, evidence, limitations and next steps. A generic JSON example:

```json
{
  "question": "Question to verify",
  "answer": "Current conclusion",
  "sources": [{"id": "Source identifier", "url": "Original source page", "local_path": "Material path"}],
  "evidence": [{"source": "Source identifier or path", "start_s": 12.5, "end_s": 15.0,
                "kind": "visual", "note": "Fact actually observed", "image_path": "Evidence image path"}],
  "limitations": ["Sampling scope or content not yet verified"]
}
```

- Always give source time in seconds and keep the source file/segment. Label subtitle/transcript and metadata evidence types separately; unknown times may be omitted; do not fabricate localization.
- Search results can also record each candidate's URL, the matched input segment, candidate source time, the basis for confidence, the queries, and the sites that failed.
- In combined tasks, give each stage its own record file so relook answers and research results do not overwrite each other.

Images omitted by the image budget or that failed to decode (see `image_delivery`) are not evidence that has been read.
