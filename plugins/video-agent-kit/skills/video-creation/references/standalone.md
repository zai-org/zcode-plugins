# Standalone work

First determine the work's core expression and the understanding or feeling it should leave when viewing ends. Genre is decided by content: drama advances through action and character choices, documentary/explainer organizes viewpoints and materials, ads center on product benefits and credible demonstration, and MV/remix lets music and visual structure lead. Write `format` explicitly as `film`, `documentary`, `interview`, `ad`, `mv`, `remix`, `explainer` or the project's genre; there is no need to change the genre to bypass irrelevant rules.

## Script to directing plan

- The screenplay states place/time, action and dialogue segment by segment, and preserves the original's core events and relationships ([screenplay.md](screenplay.md)). Shot language goes in the plan's blocks.
- For each scene/segment, write its function, the information revealed and withheld, and its opening and landing. Narrative beats write `cause → action → result` and `audience_before → audience_after`, listing the changes that should actually be visible, and the emotional turn, open question and stake that make the beat worth watching ([story.md](story.md)).
- Decide each speaking character's want, need and flaw before writing lines: the want drives what they say, the flaw explains the choice that makes things worse, and the gap between want and need is what the ending pays off.
- Arrange shots by subject of attention, point of view, visible reaction and cut points. Key turns may compare different treatments for clarity, emotion, continuity and cost; ordinary passages do not need forced multiple options.
- Continuous behavior can span shots, carried by movement direction and match on action. Narrative formats run at the density and cut rhythm in [story.md](story.md#density-and-pacing); a long quiet observation needs a reason the audience can feel, and camera movement or atmosphere never substitutes for story events.
- Long works allocate the production budget by chapter/act and review the full-film progression after stage previews; short works compress to the core information while keeping the necessary causality and resolution. The user's duration takes priority; do not split entry points by "10min/2min".

## Continuity and sound

Record world facts with stable keys, such as `cup_holder: A:left_hand`, `door: closed`. A shot flipping image left/right does not mean the character switched hands or the world light source moved; judge using eyeline axis, scene anchors and camera position. Describe allowed actions in `allowed_changes`; plot-critical changes must actually be visible.

Design in-clip dialogue, a character's inner voice and external narration separately. External sound goes in `voiceover` and can span shots; do not let lip-sync performance wrongly carry an inner voice. For information the picture can show, prefer action/reaction; documentary, interview and ads may use narration as the expression requires.

Non-diegetic music is off by default. Add a music track only when the brief asks for one, or when the piece is music-led (an MV, an ad built on a jingle); do not compose, synthesize or license a score on your own initiative. Sound with a source in the scene (a phone playing an ad, a radio, a street performer) is diegetic: keep it in the clips and level it with the scene. Ask the generator for no background music in prompts as well, since it may add its own. When music is wanted, BGM must be an explicitly provided file, with volume calibrated by actually listening against voices/effects; do not carry over levels from the source song or from experiments.

Full-film review covers comprehensibility, pacing, intended effect and audio coherence; non-narrative films may state that story clarity is not applicable, but other judgments still require actual observation. Cut evidence comes from the final timeline and the real final video; the generation reference chain is not the editing order.
