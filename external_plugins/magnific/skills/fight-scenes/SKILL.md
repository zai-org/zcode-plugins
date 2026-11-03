---
name: fight-scenes
description: Choreograph fights and physical combat for Magnific video so they read as real, readable and hard-hitting instead of soft, floaty movie kung fu - beats written as body geometry, contact and reaction physics, coverage choices (one continuous take, medium plus insert, one-hit-per-shot montage with speed ramps), a closing FIGHT LOCK, and the Magnific model and call settings for each. Use it for any fight, brawl, scuffle, takedown, melee or combat beat in a film, ad or music video, and whenever the user says the punches look soft, the hero looks stiff, hits do not land, extras move in sync or the fight is unreadable.
---

# Fight scenes

Video models have seen thousands of film fights, and their default is the average of them: wide swings, spinning kicks, punches that stop short, opponents who wait their turn and fall before they are hit.
This skill overrides those defaults with geometry (which limb travels where), physics (what the contact does to the body that receives it) and coverage (where the camera is when it lands).

Follow `magnific-essentials` for pricing, project folders, waiting and delivery, and `cinematic-shots` for model choice and sequences.

## Model and call

- Fights need `bytedance-seedance-pro-2.5`: it holds fast motion and contact best. Price it first with `simulate_cost`; a long fight is one of the most expensive calls there is.
- **One continuous take:** a single `prompt` with timecoded beats.
- **Montage:** `multi_prompt`, one shot per exchange, each with its own start and end positions.
- **Medium plus insert:** `multi_prompt`, two shots per important hit (the medium for the move, then the insert for the contact), so one call covers about three hits.
- One call holds at most 6 shots; a longer fight is several calls joined in order with `video_concatenate`, each call starting where the last one ended.
- Keep `withSoundEffects: true` and `noMusic: true` so the impacts are heard; list every impact sound in the prompt.
- Fighters who recur across clips belong in the library (`consistent-characters`); a group of opponents can be one lineup image passed as a single reference.

## Writing laws

1. **Describe geometry, not martial-arts vocabulary.** Technique names trigger generic film choreography. Write the limb, its path and its target: "her left fist travels a short straight line from her cheek to the point of his chin".
2. **Say what you want, never what you do not.** An unwanted move named in the prompt, even after "no", tends to appear. Instead of "no spinning kicks", write "every kick lands at belt height or lower".
3. **Write the strike in flight, then its result.** Skip the wind-up; describe the limb already travelling, the contact and the consequence.
4. **Every contact gets a reaction along its direction.** A rising strike lifts the chin; a hook turns the head sideways; a body shot folds the torso toward the fist. Without it, the limb often passes in front of the target.
5. **Unusual strikes need three anchors:** a familiar everyday motion (a backhand slap, kicking a door shut), the striking surface (back of the knuckles, heel), and the reaction along the strike's direction.
6. **Set the stance in the first frame** with full body geometry, then refer back to it with the same short phrase every time.
7. **Write stillness.** Bursts and pauses alternate; a pause is a state ("she stands still in her bladed stance, breathing, eyes on the next man"). Pauses are also clean cut points.
8. **Budget the beats:** about one to two seconds per exchange; an 8 s shot holds four to six beats at most.
9. **Light the contact.** Night fights read only when a motivated key light falls on faces and the point of contact (a work lamp, a floodlight, a shop sign). A fight in silhouette is unreadable.
10. **Keep it lean.** Critical facts (who wins, which hand, where they end) go where they happen and once more in the FIGHT LOCK.

## Workflow

1. Break the brief down: fighters, opponents, weapons, location and obstacles, tone, duration, winner, ending.
2. Pick a style per fighter from `references/styles.md`; contrast sells.
3. Pick a beat pattern from `references/patterns.md`, or build one.
4. Write each beat: positions, action (limb, path, target), reaction, new positions. Use phrasing from `references/moves.md`.
5. Choose coverage and convert beats into timecoded shots.
6. Add physics from `references/physics.md`: sweat, cloth, debris, damage that persists.
7. Close with the FIGHT LOCK.

## Coverage

| Coverage | Use when | How to write it |
|---|---|---|
| One continuous take | Immersive, one against many, corridors | Handheld that jolts and pushes toward each contact; whip pans between opponents as hidden cut points |
| Medium plus insert | Readable action with weight | Each important hit twice: a medium for the move, a tight insert for the contact |
| One hit per shot montage | Brutal, stylised, trading blows | One hit per 2 s shot, five or six shots per `multi_prompt` call (never a 2 s clip on its own; clips are at least 4 s); a short slow-motion ramp (about half a second, around 20% speed) as the limb travels in, normal speed from contact, cut once the reaction has played |
| Locked wide | Pure skill and speed | A long static distant shot, nothing hidden by cutting |

Give every shot a `Starts:` line and an `Ends:` line; the next shot starts where the last ended.

## Several opponents

- Never fight everyone at once: move so the nearest opponent screens the others.
- Label opponents by position and look ("the tall one in the orange vest, on her right") and keep the labels.
- Give each his own attack, timing and way of going down; opponents who move in sync look fake.

## FIGHT LOCK

End every fight prompt with a lock like this, adapted and repeated word for word across fight blocks:

```
FIGHT LOCK: [Hero] hits along the shortest path from her guard to the target, and we only ever see each strike already in flight; her feet strike at belt height or lower; every hit visibly moves the body it lands on, in the direction it was thrown; after each exchange [hero] holds her bladed stance motionless, breathing, eyes on the next man; [opponents] swing wide and heavy, and each one goes down in his own way; the rhythm is a burst, then silence, then a burst.
```

## Reference files

- `references/moves.md`: coded move library with ready phrasing.
- `references/patterns.md`: beat patterns, from a single interception to one against five and creature fights.
- `references/styles.md`: fighter styles and how each reads on screen.
- `references/physics.md`: reactions, falls, impact detail and sound.
