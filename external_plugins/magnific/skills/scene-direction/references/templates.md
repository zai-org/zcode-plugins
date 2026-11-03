# Templates for special prompt types

Each template lists what to attach, what to tell the model, and why.
Fill the brackets; keep the block titles.

## Contents
1. Continuation
2. Extension from the last frame
3. Re-coverage (same performance, new angles)
4. Room tour (new views of one location)
5. Blocking reference (starting positions only)
6. Relight only
7. Reverse angle of a room
8. Character performance reference
9. Fix-pass message

---

## 1. Continuation

Use when the scene needs the next block (usually another 30 s) with the same cast, room, light and voices.

**Attach:** the same element tags as the previous block, plus any new state references (a wound, a transformed look).

**Open the prompt with an overlap.**
The first shot repeats the previous block's last line or action, so the editor can choose the cut point inside a shared moment:

```
SCENE
Block [n+1] of [N]. Continues directly from Block [n]. Same characters, room, lighting and voices.
The first shot repeats the end of Block [n] for editing overlap: [SPEAKER]: "[last line of previous block]".
```

Then write the rest normally.
If something must stay hidden until a reveal (a transformation, an injury), tie the reveal to a physical wipe: a body crossing the lens, a camera move passing behind a shoulder.
The hidden moment then happens off-screen, where the model cannot get it wrong.

## 2. Extension from the last frame

Use when a clip is good but ends a few seconds too early.
Most tools offer a "forward extend" or "sequel" mode that continues from the final frame.

```
EXTEND - [scene name] - [beat]. [duration] s, one unbroken shot picking up from the final frame of the source clip.
The same room, light, wardrobe and positions: [restate exactly where each person is, what each hand holds, what is broken].
In these [duration] seconds: [one decisive action], then [one camera move, for example a slow push to his face].
[LOCKS that apply.]
```

Why restate positions: the model sees one frame, not the scene's history.
Anything you do not restate (which hand holds the gun, which side the door is on) is up for reinvention.
Keep extensions to a single action plus a single camera move.

## 3. Re-coverage (same performance, new angles)

Use when a take has the right action but the wrong coverage, for example only close-ups when the audience needs to see geography.
The source clip carries the choreography; the prompt changes only camera and speed.

**Attach:** the selected clip as `@video_1`, plus the character and location references.

```
SCENE
Re-coverage of @video_1. [duration] s.
@video_1 is the SOURCE: every movement, its timing, its position in the room and its outcome match the source exactly.
What is new is only the camera [and the speed]: [n] shots, hard cuts at [times].
Every shot is [wide / medium], from places the source never used: [through foreground objects, from floor level, from a ceiling corner, through a doorway], [Dutch angle 25-35°].
```

Then list the shots with the source beat each one covers ("SHOT 3 · 8.8-13.2 s covers the fall through the table").
In the edit, cut between source and re-coverage on matching movement.

## 4. Room tour (new views of one location)

Use when one location plate is not enough: a fight needs an overhead, a dialogue needs a reverse.
Generate a short video that moves through the empty room, then pull stills from it.

```
SCENE
[8-10] s, the empty room from @loc_[name]_v1, no people.
@loc_[name]_v1 defines geometry, materials, palette and light. Its camera angle is not inherited.
Stages: 0-3 s wide from [corner]; 3-6 s medium past [object]; 6-10 s a high angle looking straight down over [the area where the action will happen].
All stages share one room, one night and one colour grade.
```

## 5. Blocking reference (starting positions only)

Use when the model keeps putting characters in the wrong places.
Take the overhead frame from a room tour, mark each character's starting position with a coloured dot, and attach it as `@image_1`.

Tell the model exactly what the diagram is for, or it will reproduce the diagram as a frame:

```
@image_1 - BLOCKING DIAGRAM. It sets starting positions only: [colour] = [NAME] [where], [colour] = [NAME] [where].
It is not a keyframe and not a camera position. The camera follows the shots below.
```

For fights, shrink the stage: state a radius ("all action within two metres of the red sofa") and remove references to parts of the room the camera never sees.
Fewer spaces in play means fewer chances to flip the geography.

## 6. Relight only

Use when a generated location has the right layout but the wrong mood.
Rerolling loses the layout; relighting keeps it.
Attach the image to an image-editing model.

```
RELIGHT ONLY. Keep this exact frame: the same camera position, composition, lens, furniture, objects and materials.
Change only the light: [new sources, for example the picture light, two wall sconces and the desk lamp, all warm tungsten], [what stays, for example the windows stay dim blue].
The room stays empty.
```

## 7. Reverse angle of a room

Use for dialogue that cuts across a room: one plate per side, one tag per plate.

```
The reverse view of @loc_[name]_v1, looking toward [the door / the window wall].
The interior, materials, style and light are identical to the approved plate.
Add [a story detail, for example splintered wood around the handle, because the door will be kicked in].
Beyond [the door]: [what is visible, for example a corridor with real depth].
```

Then name both: `@loc_[name]_[sideA]_v1` and `@loc_[name]_[sideB]_v1`, and in every scene prompt say which side is behind whom.

## 8. Character performance reference

Use once per speaking character, before any scene work.
Source: the approved character sheet and the character's voice: a library voice cast with `audio_tts`, or a recording of the user's own voice or one they confirm they have the speaker's permission to use (never a public figure or someone recorded without consent).
A Seedance `audio` reference only guides rhythm and mood; it does not clone a voice, so the voice goes on with lip sync.
The sheet itself has several panels (front, back, face), so never animate it directly: make one single-performer portrait from it first.

1. Generate the portrait with `images_generate`, the sheet as the image reference, using the prompt below.
2. Make the line's audio with `audio_tts` (one `voiceId` per character), or use the permitted recording.
3. Turn the portrait into a talking performance with `video_speak` (`imageUrl` plus `audioUrl`); `sound-and-voice` covers the models and limits.

```
One person only, from the attached character sheet: the exact face, hair, skin and wardrobe, front-facing medium close-up, eyes to the lens, mouth closed and relaxed.
Plain light-grey studio backdrop, soft even key light, natural skin texture. A single photograph, no panels, no text.
```

Approve the synced result, then save it as `@char_<name>_video_v1`.

## 9. Fix-pass message

When a take misses, send only the deltas, numbered, and say that everything else stays:

```
Revise the prompt. Keep everything not listed below exactly as it is.
1. [Remove or change one thing, written positively: "the door opens cleanly, its edges intact".]
2. [Change one camera decision and say why: "orbit around him on the line instead of tilting up from the gun, so we stay on his face for the emotion".]
3. [Lock one spatial fact: "in opposing wides the side wall is behind them; the door is behind Mara, the stove behind Jonas".]
```
