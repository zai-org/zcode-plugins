# Fights and chases

Read this when a unit stages a fight, a struggle, a chase or any exchange of force. It says how to write the `blocks` so the generator has something physically consistent to execute. The screenplay, block fields and prompt compilation are in [screenplay.md](screenplay.md); reaction design outside a fight is in [performance.md](performance.md).

The failures this guards against are the ones reviewers name in action: a body that arrives somewhere without moving there, a blow that lands with no reaction, a hand that passes through an arm, a duel that reads as two people waving near each other. Most of them come from blocks that are each plausible alone but do not follow from one another.

## One action per block, rhythm across the unit

Give each block one main exchange — one attack and its answer, one dodge, one grab — over 2–3 s. A block that lists five simultaneous moves gets one of them, chosen by the generator, or a blur of all five.

Shape the unit in three beats:

| Beat | Share | What it carries |
| --- | --- | --- |
| Wind-up | ~30% | stand-off, approach, the first testing exchange; the space is shown |
| Burst | ~50% | the main exchange: the densest chain of cause and effect |
| Aftermath | ~20% | the result made readable — who is down, what broke — and a hook |

Shift the shares when the chain needs it; a four-link burst may take more than half. Over several units the same shape repeats at a larger scale: a fight is rarely won in its first unit.

## Each block starts from the previous block's result

This is the rule that matters most. The action of every block after the first begins with what the previous block left behind: a body off balance, momentum in some direction, a weapon caught, an opening. Write that hand-off into the `action` text. The Chinese phrases below are sample wording for a Chinese-language work, each followed by an English gloss.

- Momentum: 借着对方前冲的势头 (using the opponent's forward rush) / 顺着惯性 (following the inertia) / carried by the swing
- Consequence: 被踢中的怪兽身体前倾，她顺势… (the kicked monster pitches forward, and she follows through…) / with the blade stuck in the shell, it wrenches its head…
- Condition: 趁尘土遮住视线 (while the dust blocks the view) / 借残骸反弹 (rebounding off the wreckage) / while he is still turning

Self-check before validating: read each pair of adjacent blocks as "because (the end of block N), (the action of block N+1)". If the sentence does not hold physically, block N+1 is an isolated action — the source of teleporting and clipping. Rewrite it, or merge the two blocks. `creation_plan_validate` warns on a fight block whose action does not open from the previous one; the warning is a prompt to read the pair, not a proof either way.

## A hit has four parts

A blow the audience feels is written as: where the force comes from, the moment of contact, how the material answers, and what the body does as a result.

Weak (sample `action` text): 她挥刀砍中怪兽。 ("She swings her blade and hits the monster.")

Strong (sample `action` text): 她腰部发力带动长刀横斩，刀刃撞上怪兽前臂甲壳——接触瞬间迸出火星，怪兽头部被力道带偏半寸，前爪在沙地上犁出两道浅沟。 ("She drives from the hips into a horizontal slash of the long blade; the edge slams into the shell of the monster's forearm — sparks burst at the moment of contact, the force knocks the monster's head half an inch aside, and its front claws plough two shallow furrows in the sand.")

- Force starts in the body: hips turning, a foot driving off the ground, the run-up — not an arm swinging from nowhere.
- Contact gets a material response: metal on metal sparks, shell chips, stone cracks, cloth tears.
- The result is a displacement: head knocked aside, half a step back, a stumble. That displacement is exactly what the next block's action starts from.

## Environment feedback, one per block

Every block names one thing in the surroundings that answers the force: dust thrown up, sparks, a crack running across the floor, debris, water splashing. It tells the generator where the force goes. One is enough; three in a block bury the action they were meant to show.

| Ground / setting | Feedback |
| --- | --- |
| Sand, gravel | dust bursts, gravel sprays, a furrow dragged in the ground |
| Stone, rock face | chips flake off, a crack spreads, falling grit, an echoing boom |
| Metal, ruins | sparks, a plate dents and rings, wreckage tips over |
| Wooden interior | planks splinter, a table skids, dust drifts down from beams |
| Water, rain | spray thrown sideways, rings spreading, a wet surface throwing back light |
| Courtyard, garden | petals and leaves torn loose, a lantern swings, tiles crack |

Put it after the contact and before the displacement.

## The key strike: trajectory, not outcome

For the one blow the unit is built around, write its path in steps rather than its result, for example 空中下落 → 双手高举 → 竖向重劈 → 刀锋正中厚甲 (falling through the air → both hands raised high → a heavy vertical chop → the edge lands square on the thick armour). Each step is a frame the generator can execute; "a heavy downward strike" is a result it has to invent a path for.

## Slow motion: one, short, with a duration

If the key strike gets slow motion, give it a length and a return, for example 命中瞬间约 0.2–0.3 秒微慢动作，随即恢复正常速度 (about 0.2–0.3 s of slight slow motion at the moment of impact, then straight back to normal speed). At most once per unit, and only on that strike. Slow motion on every hit flattens the rhythm it was meant to sharpen; "slight slow motion" without a duration is read as a slowed-down block.

## A hit may fail

A blade that bounces off armour, a punch that throws the attacker back by its own recoil, an edge that chips: a physically consistent failure is more convincing than a fight won in every exchange, and it gives the next unit its turn — the hero has to find another way. Write the failure as concretely as a success: no cut, no mark, only a jolt running back up the arms.

## End on the next round

The aftermath is more than a held frame. Turn the winner toward the next target, show the hero realising the armour will not break, let someone wipe blood and walk off. Leave the cut a question the next unit answers.

## Several opponents

State how many there are and the order they move in — "six of them turn and hiss; two lunge first" — and frame that order so it reads. Each opponent who is seen clearly has a distinct face, different from every other opponent and from the protagonist; give a recurring opponent a character card like anyone else. A crowd that shares one face is a duplicated character, which review treats as a hard defect.

## Camera by beat

- Wind-up: slow push in, low angle on the stronger side, over the shoulder to fix positions.
- Burst: close follow along the direction of the move, a short handheld shake on impact, an insert of the weapon meeting or the foot planting.
- Aftermath: slow pull back to the whole space, or a hold while the dust settles.

Not locked off for a whole fight, and at most two camera changes inside one block. A move serves the action; a flourish that shows nothing costs the generator attention.

## Sound

Write the block's `sound` in three layers: force (the dull thud of a hit, rushing air, an engine climbing), material (gravel, scraping, the hiss of a spark) and body (breath, a grunt, a roar). The current generator returns silent clips ([generators.md](generators.md)), so none of these layers is heard: `sound` stays the record of what the cut should sound like, and the visible feedback above — dust, sparks, the displacement — has to carry the rhythm. Music reaches a fight only as a `bgm` track the brief or the user supplies to `creation_timeline_build`; declare the unit's `music` cue so it is placed there. With neither, the fight plays with no effects and no music around its lines; say so in the delivery note.

## What review checks

A hit with no reaction from the body it lands on, or a body that changes place with nothing moving it there, is a `physics` or `continuity` failure in review — not a minor defect, because it is exactly what makes the exchange unreadable. See [verification.md](verification.md).
