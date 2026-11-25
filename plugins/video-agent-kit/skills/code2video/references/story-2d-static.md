Implement a runnable 2D animation in code from the text brief, and render it to a video.

Materials, if any, are the files the user names (by default under `input/` in the project directory).

This film is a 2D animation; the main characters appear throughout the film as static portraits (a still-frame style animation).

The task is to create, in code, a static-portrait 2D animation from the provided materials.

Form: the inside of each portrait stays still; the animation comes from moving the whole portrait, switching between different portraits, and the interplay of camera, background, effects and sound

Workflow:

1. From the story requirements, design a complete director's script, storyboard, and action and scene choreography

2. Plan the subject assets: decide the overall style from the script choreography (realistic / chibi / pixel art / fluffy / ...). Decide the main portraits needed: typical actions and viewing angles, showing the necessary states such as standing, fallen on the ground, changes of appearance and so on. Once the style is settled, all assets must stay harmonious and consistent in style.

3. Art asset generation:

3.1 Simple shapes (geometric solids / clean vector style), environments, effects, props and the like: implement them yourself in code such as HTML/CSS/SVG/Canvas/Three.js/shader.
3.2 Bitmaps that code cannot draw (complex characters with fine textures): generate them with the `image_generate` tool.
3.2.1 From the plan, first decide which portraits each independent subject needs.
3.2.2 Generate the portraits of one subject in a single image in one go wherever possible, laid out in order, to keep them consistent. Only when one image cannot hold them, consider generating in batches by shot / angle and so on.
3.2.3 When calling the tool for a subject that has reference images, the prompt only needs to give the description of the portraits required: action / viewing angle / change of appearance (if any) / style (if it needs specifying);
3.2.4 For a task with reference images, first check the provided reference images. When one character has several reference images that separately show details / full body / multiple views and so on, or a subject and its equipment / outfit and so on are split across several images, you may stitch them together for use, and state in the prompt that they are the same character and how they are stitched (only say what each sub-image is; there is no need to describe what is inside the images)
3.2.5 For a subject with no reference image, design the character's appearance yourself and describe it in the prompt.
3.2.6 Key points for using `image_generate`:
- Each image is one entry in `items`, with `id` and `prompt` required; use `kind:"character"` for subject portraits.
- Outputs have no alpha channel. When a cut-out is needed, ask in the prompt for a solid background (pure white or pure green) with a clean edge between subject and background, then cut it out yourself.
- Laying out several poses in one image is normal practice in this workflow; be sure to set `check_panel_layout:false`, otherwise it is mistaken for a storyboard grid and flagged falsely.
- For a subject with reference images, pass the reference image paths in each entry's `reference_images`.
- `size` is a resolution tier, one of `1K` / `1.5K` / `2K` (default `2K`); set landscape or portrait with `orientation`, which goes into the prompt and is checked after generation.
- Write generated assets to `output_dir:"out/code2video/assets"`; transient failures are retried automatically.

4. Scene recording
4.1 Produce the film scene by scene, in modules.
4.2 In each scene, first get the moving objects coordinated: when objects interact, make sure the interaction relationship, the positional relationship and the layer order are correct.
4.3 Form of organization: the inside of each portrait stays still, and the story is expressed by moving, scaling, rotating, shaking, changing opacity and so on; key actions / state changes are expressed by swapping portraits and by effects
4.3.1 For example (examples only; design the actual form, and whether to use it, yourself from the script itself and the scene's style and mood):
- When a character runs, the portrait moves with a slight sway, and line effects / dust-puff effects can be added at the legs to convey hurried speed and emotion;
- For a character's particular emotions, some face effects can be added (such as tears / black lines when embarrassed / sparkling stars when happy / blinking / mouth opening and closing and so on);
- To show a limb swinging, motion-line effects can also be added around the limb to convey the feeling of movement;
4.4 Because the characters themselves do not move, the background, camera work and audio need more refined design. The background can be layered to give the picture depth, the camera can push in, pull out and cut, effects fill in action and emotion, and sound provides a sense of time and information about what is happening.
4.4.1 For example (examples only; design the actual form, and whether to use it, yourself from the script itself and the scene's style and mood): push the camera in for a close-up of part of a character, cut suddenly to a prop, shake the camera on a hit / explosion, cut between several characters.
4.4.2 Background components can be layered: split foreground, midground and background into several layers that show depth in the picture, moving at different speeds to produce parallax
4.4.3 Voice and sound effects: generate narration / dialogue with `tts_generate` (the voice is set by the `voice` parameter, and each character must keep one voice ID). Produce the voice first to get each line's duration, then arrange the picture's pacing from that, to avoid lip-sync / duration mismatches; supply background sound and sound effects yourself.
4.5 Keyframe review (optional but recommended): once a scene's key rendered images are out, you may dispatch the image paths and the corresponding script intent to the `c2v-reviewer` sub-agent for an independent image review (it only looks at images and only reports serious problems that can be confirmed visually), then fix according to its list.

5. Whole-film compositing: after producing the scenes one by one, composite the whole film, adding transition effects if needed; align the voice track to the picture and mix. After the whole film is recorded, do a final check of consistency across the whole film. Render the final film and write it to `out/final.mp4` (with sound, playable, with a positive duration); this is the delivery criterion for this task.

6. Watch the GPU/CPU/memory load while rendering
