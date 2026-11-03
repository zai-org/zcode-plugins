---
name: scene-direction
description: The directing structure inside a Magnific video prompt - scene arc, space map, opening frame, per-shot camera, start and end states, exact dialogue, physics, light, audio and locks - written into each shot of a Seedance multi_prompt call (or one timecoded prompt for a single take). Use it whenever a video prompt is being written for a scene, sequence, short film, ad or music video with characters, dialogue, action or a camera plan, and whenever a take came back with people swapping sides, a room that flips, a missed ending, recited lines or a flat, generic look. Works with cinematic-shots, which owns model choice, pricing and delivery.
---

# Scene direction

A video model reads the prompt as one bag of signals and fills every gap with its strongest default: a centred frame, a generic face, an aimless camera.
This skill closes the gaps with a directing structure: what the scene is about, where everyone is, what the first frame shows, and what each shot does, so the model executes a plan instead of averaging.

Follow `magnific-essentials` for pricing and delivery and `cinematic-shots` for model and resolution. For fights, take the choreography from `fight-scenes`. For lens and look, use section 10 of [video-prompt-craft.md](../magnific-essentials/references/video-prompt-craft.md).

## Build references before the scene

Words alone do not hold a face, a room or a prop across shots; references do.
Before writing the video prompt for any scene with people or a fixed place, build and attach references (details in `consistent-characters`):

1. **One character sheet per main character:** full body front, full body back and a face close-up on a plain light-grey studio backdrop, soft even light, no text, at 16:9 with Seedream 5 Pro. Describe age, build, face, hair and the exact wardrobe the scene uses.
2. **One location plate per place:** the empty set at the scene's time of day and light, from the angle the scene mostly uses, no people, no text, at 21:9.
3. **One image per key prop** that the story turns on (a ring, a letter, a bag), on a plain backdrop.
4. Pass them in the video call as `references` of type `image`, in a fixed order, with no `keyframes` (a start frame excludes references on Seedance).
5. Open shot 1 with the reference contract, naming each image's job in array order: "Image 1 is Ruth's identity sheet: face, hair and wardrobe. Image 2 is the pawnshop: layout, materials and light, not its camera angle. Image 3 is the ring." Repeat the contract line in every shot.
6. Keep the words short where a reference carries the look: name the person and their wardrobe in a few words instead of re-describing the face.
7. **Check each reference against the brief before using it.** List every visible specific the brief names for that person, place or prop (a uniform, a jacket colour, a broken lock, a vintage car) and make sure the reference prompt states each one and the generated image shows it. A reference overrides the words in the video prompt, so a reference that is missing a specific wins over the brief; regenerate it instead of hoping the prompt corrects it.

Extras that only need to look different from each other can share one lineup image.

## Choose the call shape

- **Several shots in up to 30 s:** `multi_prompt`, one entry per shot (up to 6, each 1-12 s, summing to the total), `promptMode: "manual"`.
- **One continuous take:** a single `prompt` with timecoded beats.

## Shot 1 carries the scene blocks

Open shot 1's prompt with these blocks, compact, in this order:

1. **SCENE:** the situation in one or two sentences and the arc in a few words ("hope, quiet refusal, a private look").
2. **CAST and PLACE:** each person and place in words: age, build, hair, wardrobe with colours and materials; the place's materials and practical lights. When library assets or reference images are attached, name each reference's job in array order instead ("the first image is Ruth's identity sheet").
3. **SPACE:** who stands where, what runs left to right, the axis between characters, the side the camera works from, the direction of travel.
4. **OPENING FRAME:** shot size, camera position, who is where, and what is already happening ("he is already at the counter, slightly out of breath").
5. **OPTICS, CAMERA, LOOK, AUDIO:** field of view in degrees per shot size, the camera rules, the grade and film look, and the audio policy (language, exact lines, the sounds that exist).

## Every shot repeats the anchors

Each shot prompt is read on its own. In every shot, write:

- the camera position (side, height, distance), angle and one move with a start and an end, and the camera rules that must hold everywhere ("three-quarter angles, never straight-on");
- **Starts:** where everyone and everything is at the shot's first frame;
- the action as states already in motion, with left and right named;
- the exact dialogue lines, each in its own timed beat with its speaker and the delivery as an action ("5-8 s: he pushes the envelope toward her as he says...");
- one performance line: natural and lived-in, a breath before each line, small reactions, eyes that track the other person;
- the sounds in this shot;
- **Ends:** where everyone finishes and what the cut lands on;
- the identity, wardrobe, space and light anchors, word for word as in shot 1;
- a short **LOCKS** line: cast count, who is where, what never changes.

## Writing laws

1. **Numbers over adjectives:** degrees, seconds, metres, counts.
2. **Positive phrasing:** say what happens. "The soundtrack is dialogue and room sound only" beats "no music".
3. **States, not preparations:** describe motion already travelling and its consequence.
4. **Exact words for dialogue,** in order, with one speaker per timed beat; a shot can hold an exchange as long as each beat names its speaker and its seconds ("5-8 s: RUTH, without looking up: ...").
5. **Keep the protagonist in every shot** when they must stay readable; cutaways without them are where identity drifts.
6. **Motion has weight:** describe what moves, how fast and where it lands; avoid freeze language such as "hangs in the air".
7. **Be ambitious inside the plan:** an unexpected but motivated angle, a light source that tells the story, a physical detail only this scene would have. The structure is what lets a bold idea survive generation.

## Shot budget and motion

Generated video loses identity at cuts and freezes when a shot has nothing to do.
Plan every scene against those two failures:

- **Shot budget, by scene type:**
  - *Dialogue, drama and quiet scenes:* at most 3 shots per 15 seconds, none shorter than 3 seconds. Fewer, longer shots give each performance time to play and give the model fewer chances to redraw a face or a room. When the beat needs more angles, move the camera inside a shot instead of cutting.
  - *Beat-dense action other than fights (chases, escapes, stunts, any brief with four or more distinct physical beats):* first list every physical beat the brief names, in order. Then either use up to 5 shots with one or two beats each, or one continuous take with a named time window for every beat ("6-8 s: she vaults the crate, both feet leaving the ground"). Every beat on the list must have its own window; a beat squeezed into a sentence is a beat the model skips.
  - *Fights:* the coverage chosen in `fight-scenes` sets the shot count (a one-hit-per-shot montage runs as several calls of up to 6 shots); the beat list and one window per beat still apply.
- **An action in every second:** write what moves at each moment of every shot: a hand, the eyes, breath, cloth, steam, the camera. A shot that only describes a pose comes back frozen.
- **Open in motion:** the first frame is already mid-action ("she is already turning toward the door"), never a still waiting for the action to start.
- **End in motion, not in a hold:** close on a small continuing action under the last beat (he keeps wiping the counter; the steam keeps rising as the camera drifts in). Long held endings are where takes freeze.

## Readability and the ending (non-action scenes)

Use this section for dialogue, drama, atmosphere and crowd scenes. Fights and chases take their lighting from `fight-scenes` instead, because extra general rules there crowd out the choreography.

- **Light the story:** give faces and the point of action a motivated key light from something in frame (a lamp, a window, a shop sign, a flame). Shadows stay deep, but eyes, hands and the story's object read.
- **Frame the ending to be read:** the last shot runs at least 3 seconds, at a size where the end state is unmistakable, and the prompt names that end state in one plain sentence.

## Props that hold (non-action scenes)

Use this section when a scene turns on an object. In fights and chases, keep props to what the choreography needs and let `fight-scenes` handle them.

- **One key prop per scene;** remove or simplify other handheld objects.
- **Describe it once, exactly, and reuse the same words:** material, colour, size relative to a hand.
- **Track it:** in every shot, say where it is and which hand holds it.
- **Give it one insert** where it fills about a third of the frame.
- **Lock it:** close every shot with "the [prop] keeps exactly this shape and colour and never multiplies or disappears".

## Fights and chases

For any fight or scuffle, follow `fight-scenes` for choreography, coverage and shot count, lighting of the contact and props. For chases, escapes and stunts without combat, use the beat-dense action budget above. Keep the prompt focused on the physical beats; skip the non-action sections.

## Templates

`references/templates.md` holds patterns for continuations with overlap, extensions from the last frame, re-coverage from new angles, room tours, blocking diagrams, relight-only and reverse-angle plates, and character performance references.
`references/example.md` is a complete worked example for calibrating density.
