---
name: pptx-author
description: Produce a professional .pptx deck on disk with python-pptx — slide conventions, template handling, and delivery contract for research decks and pitch materials.
---

# pptx-author

Use this skill whenever you need to deliver a PowerPoint deck as a file. This plugin runs in Claude Code (no live Office application), so all decks are built with Python/`python-pptx`.

## Output contract

- **Write the deck where the caller collects deliverables from** — the path the user gave, else the delivery directory this session already establishes (usually present in the working directory, alongside uploaded inputs; look before guessing), else the working directory. Do not assume a fixed name, and confirm the file is there before finishing: a deck written somewhere the caller does not read is the same outcome as no deck.
- Return the file path in your final message.

## How to build the deck

Write a short Python script and run it with Bash. Use `python-pptx`:

```python
from pptx import Presentation
from pptx.util import Inches, Pt

prs = Presentation("./templates/firm-template.pptx")  # if a template is provided
# or: prs = Presentation()

slide = prs.slides.add_slide(prs.slide_layouts[5])    # title-only
slide.shapes.title.text = "Valuation Summary"
# ... add tables / charts / text boxes ...

prs.save(f"{DELIVER}/pitch-<target>.pptx")   # DELIVER = the caller's delivery directory
```

## Conventions

- **One idea per slide.** Title states the takeaway; body supports it.
- **Every number traces to a source.** If a figure comes from a model workbook (e.g. `<DELIVER>/model.xlsx`), footnote the sheet and cell; if it comes from a data source, keep the `[n]` source marker convention.
- **Use the firm template** when the user provides one; otherwise default layouts.
- **Charts**: prefer embedding a PNG rendered from the model over native pptx charts when fidelity matters.
- **CJK text**: verify Chinese text renders and wraps correctly; pick fonts the target machine will have.
- **No external sends.** This skill writes a file; it never emails or uploads.
