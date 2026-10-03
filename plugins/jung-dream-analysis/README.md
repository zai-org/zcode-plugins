# Jungian Dream Analysis

A ZCode plugin that analyzes dreams the way C.G. Jung practiced analytical psychology — not with a dream dictionary, but as a guided dialogue between you and your own unconscious.

The plugin is a set of expert instructions (a skill and a slash command) plus reference material. It adds no tools, no network calls, and no configuration — everything happens in conversation with your ZCode agent.

## What it does

Given a dream, the agent walks Jung's actual method step by step:

1. **Context** — a few focused questions about your life situation, your waking feeling, and your habitual stance.
2. **Structure** — the dream retold faithfully, then laid out as Jung's four-act play (exposition, development, culmination, lysis — including when there is no resolution).
3. **Personal association** — you are asked what each motif means *to you*; your associations lead, never a dictionary.
4. **Amplification** — where a motif resists personal association, parallel imagery from myth, fairy tale, and religious symbolism is offered as questions, not answers.
5. **Archetypal mapping** — tentative identification of figures and dynamics (Shadow, Anima/Animus, Persona, Self, Great Mother, Wise Old Man/Woman, Divine Child, Trickster, Hero), tested against your recognition.
6. **Compensation** — the central Jungian step: your waking stance set beside the dream's counter-position, and what one-sidedness the dream may be correcting.
7. **Synthesis** — the constructive question the dream poses, and where it sits on the individuation path if anything larger is visible.
8. **Grounding** — active imagination, an outer gesture, or journaling; recurring dreams can be tracked as a series across sessions.

## Install

From the ZCode plugin marketplace, or by adding this repository as a marketplace source.

## Usage

- Type `/dream` followed by your dream text — or just tell the agent "I had a dream …" and the skill triggers on its own.
- Leave the arguments empty to open a guided session.
- Answer the context questions (short, honest answers in your own words work best); the interpretation is built from them.

Example:

```
/dream I dreamed I was driving my old family car down a hill and the
brakes barely worked; my late grandfather sat beside me, calm, and
said: you'll get there. I woke up anxious.
```

Expected behavior: the agent asks about your current life situation and the waking feeling, restates the dream, maps its dramatic structure, asks what the car and the grandfather mean *to you*, and only then offers archetypal hypotheses, the compensation reading, and one constructive question — with an active-imagination exercise to close.

## What's inside

| Path | Purpose |
| --- | --- |
| `skills/jung-dream-analysis/` | The analysis method: stance, session flow, output format |
| `skills/jung-dream-analysis/references/archetypes.md` | Starting points for recognizing archetypal figures in dreams |
| `skills/jung-dream-analysis/references/symbols.md` | Amplification starting points for ~20 common dream motifs |
| `commands/dream.md` | The `/dream` slash command |

## Scope and ethics

- **A symbol is not a sign.** The plugin never hands down fixed meanings; every interpretation is a hypothesis the dreamer confirms or rejects.
- **The dreamer is the final authority.** If a reading doesn't resonate, it is dropped.
- **Not therapy.** This is self-reflection and education, not diagnosis or treatment, and it does not predict the future. If the material touches severe trauma or crisis, the plugin instructs the agent to say so and point to a qualified therapist.
- Dreams discussed in a session are handled like the rest of your conversation with your ZCode agent — see your ZCode privacy settings for how sessions are stored.

## Dependencies and side effects

None. The plugin ships text instructions only: no MCP servers, no hooks, no scripts, no network access, no file writes, and no third-party code or assets. Jung's concepts are drawn from his published works, which are cited as background (for example, *Memories, Dreams, Reflections* and the *Collected Works*); all text in this plugin is original.

## License

Apache-2.0, as this repository.
