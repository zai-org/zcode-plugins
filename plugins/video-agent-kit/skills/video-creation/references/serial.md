# Serial episodes

The same generation/review tools serve series work. Episode duration is decided by the user, platform and story, and may be short or long; the aspect ratio is not fixed to portrait either. Maintain a series brief, character assets and per-episode state, so characters and voices are not rebuilt every episode.

## Episode progression

A common structure is `hook → escalation → payoff → cliffhanger`: the opening raises a forceful question, the middle explains the character's goal and raises the cost, the episode delivers a local result, and the ending leaves a new choice or unresolved consequence. `format=episode` expresses this structure and provides `episode {ep_no,target_seconds}`; closed-form single episodes or documentaries within a series may choose the corresponding genre, with series attributes recorded independently.

The opening can be danger, an identity contrast, an exposed secret or a dilemma; the closing pull can land on a new threat, a relationship change, revealed evidence or a two-sided choice. Adjust to the subject matter, and avoid reusing the same interrupting line every episode. A cliffhanger needs support from existing actions and consequences; it cannot rely solely on a sudden cut to black.

Character motivation runs through the series. A counterattack or emotional payoff should have visible cost/reaction; do not make a character suddenly lose judgment to manufacture a twist. Write the change in audience knowledge separately from plot causality; dialogue serves progression, character or emotion, and its length is decided by the actual audio and scene rhythm.

## Series assets and state

For each character, keep a stable id/name, appearance traits, body scale, voice reference, relationships, and wardrobe/injury state cards with explicit reasons. At the end of each episode, update: what characters know, goals and choices, prop holders, relationships/commitments, spatial and temporal progression, injuries and emotional residue. The next episode's entry state continues from the previous episode's observed exit state.

Do not change a character's voice timbre because of emotion; performance may vary, voice identity stays. State cards must also cover characters in the same frame; do not change only the protagonist's clothes while other characters revert to an old scene. Future state cards should not affect past shots, but when the state image, voice reference or relationship definition currently in use changes, re-review is required.

Multiple episodes in the same project share one candidate directory and cumulative budget: each episode's plan writes the same `budget` caps (the cumulative limit for the whole series), and `take_id` is unique across the whole series; when each episode needs its own budget, use a separate project per episode and copy the needed character cards and voice references. After switching episodes, old episodes' candidates must be re-reviewed against the new plan's units and cannot be placed directly into the new episode.

Summarize across episodes the current deliveries, character states and setups awaiting payoff. For each episode, watch the real clips, real cuts and the whole episode's progression; multi-episode tasks additionally check repetition, escalation and payoff, and cannot copy one template verdict into a pass.
