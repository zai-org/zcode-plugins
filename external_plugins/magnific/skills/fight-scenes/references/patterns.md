# Beat patterns

Ready sequences with timings.
One beat is one exchange; the times assume real speed unless a ramp is written.
Adapt names, sides, styles and moves (codes from `moves.md`).

## Contents
- BP1 One clean interception
- BP2 Long range to close range
- BP3 Parry and counter combination
- BP4 Pressure into an obstacle
- BP5 Two against one
- BP6 Many against one, continuous take
- BP7 Knife
- BP8 Trading blows montage
- BP9 Human against creature
- BP10 Finish and aftermath

---

### BP1. One clean interception (4-6 s)
1. Both still; the hero in his bladed stance, the other man square and angry (ST1, ST5, ST4).
2. The other man throws a big swing.
3. The hero lands first; the swing never finishes (IN1).
4. The other man staggers or drops; the hero returns to stillness (FA3, ST4).

### BP2. Long range to close range (6-8 s)
1. Circling (FW4).
2. The other man steps in; a stop kick to his knee (KI1).
3. The knee buckles and he pitches forward.
4. A rising strike meets the falling face (PU4).
5. He drops past the hero; stillness.

### BP3. Parry and counter combination (6-8 s)
1. A straight punch comes in; slap it aside and hit in one movement (IN2).
2. The other man tries again; pull his wrist into a back-of-the-fist strike (IN3, PU6).
3. He is yanked forward and falls past; the hero lets go and goes still.

### BP4. Pressure into an obstacle (4-6 s)
1. The other man is already dazed.
2. Chain punches walking forward (PU8).
3. A push kick sends him into a named obstacle that breaks (KI3, FA4).

### BP5. Two against one (8-12 s, two shots)
1. Shot one: the hero moves so the two line up; the nearer one attacks; BP1 or BP2; he falls in front of the second.
2. Shot two: the second steps around the fallen man; a different pattern (BP3, or KI2 then PU3).
Each opponent goes down a different way.

### BP6. Many against one, continuous take (20-30 s)
1. The group notices the hero; a whip pan to him and back to them; they charge as one, then spread.
2. Opponent 1: the hero meets him in the air or at a run (KI3 or EL1); he falls straight back.
3. Opponent 2: a short, sharp elbow (EL1); he drops face down.
4. Opponent 3 guards; three body shots and one to the chin (IN5, PU5, PU4); he crumples.
5. Opponent 4, the biggest, charges; a speed ramp into one heavy straight (PU2); he falls stiff.
6. Opponent 5 swings wide; the hero ducks under and rises inside (IN4), finishing with a knee (EL2).
7. Stillness. The camera drops to floor level among the bodies as the hero settles his clothes and walks on.
Write "one strike per beat, stillness between strikes" and label the opponents by role and position.

### BP7. Knife (6-10 s)
1. The knife appears; the hero opens the distance, hands up in front of his chest, body turned sideways.
2. The thrust; he angles off the line and kicks the knee on the knife side (FW3, KI1).
3. Both hands on the knife wrist, the knife drops (WP1).
4. A strike to reopen the distance, then stillness.

### BP8. Trading blows montage (up to 30 s, one hit per 2 s shot)
Coverage: one hit per 2 s shot, a brief slow-motion ramp while each limb travels in, normal speed from the moment of contact, and the edit once the reaction completes.
Build it in `multi_prompt` calls of five or six 2 s shots (10-12 s per call; one call takes at most 6 shots), so a 30 s montage is three calls of five shots.
The last shot of each call ends where the first shot of the next call starts; join the calls in order with `video_concatenate`.
Never render a 2 s shot as a clip of its own: Seedance clips are at least 4 s.
1. Alternate attackers; each fighter lands hits, so it feels like a real exchange.
2. Escalate the damage: early hits are fast and light, later ones heavier with furniture breaking.
3. Give each shot a Starts line and an Ends line.
4. End with both standing and one in control, for example the hero behind the other man in a head hold (CL5), leaving room for an extension shot to finish.

### BP9. Human against creature (variable)
- The creature swings big, fast and wide, with claws, leaps and roars; the human moves small and precise and survives by angles and timing.
- The creature lands hits too; a human who never gets hit removes all the tension.
- Keep the creature's body consistent with its reference: claw length, teeth, wardrobe tears that stay torn.
- Hide transformations behind a body or a camera move crossing the lens.

### BP10. Finish and aftermath (5-10 s)
1. The last hit lands; the reaction plays fully at real speed.
2. A beat of complete stillness: breathing, sweat, the sound of the room returning.
3. One small human action: straightening a coat, wiping a knuckle, picking up the dropped weapon.
4. The camera finds the face, or drops to floor level among the fallen.
