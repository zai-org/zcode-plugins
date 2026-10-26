# Part of the ruic-card plugin (photo-card skill). MIT License - see the plugin's LICENSE.
"""Render the card's rotation + gentle holo sweep as a 10-second loop (240 frames @24fps),
1920x1440, GPU. The saved scene animates over 96 frames, so every keyframe is stretched by
2.5x first - the motion stays smooth instead of repeating a short cycle.

Flags after the sway multiplier: native (render at the artwork's own size),
clean (no foil / gold trim / star flecks / contour glow, artwork driven straight from the
texture so the frame reproduces the photo), still (one frame only, for a quick look).
usage: blender --background --python render_anim.py -- <project> <out_dir> [sway] [flags]
"""
import sys
from pathlib import Path

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
R, OUT = Path(args[0]), Path(args[1])
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(R / "card.blend"))
scene = bpy.context.scene
CLEAN = any(a == "clean" for a in args)
STILL = any(a == "still" for a in args)
if CLEAN:
    # "不要加什么金箔特效，高清就行": drop the holographic foil, the gold trim, the star flecks
    # and the contour glow, and drive the artwork with emission instead of a lit metallic BSDF -
    # a lit surface renders the photo through the lamps, which is what made it look gilded and
    # washed out. The Standard view transform then keeps the colours identical to the file.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.eevee.taa_render_samples = 16
    for m in bpy.data.materials:
        nt = m.node_tree
        if nt is None:
            continue
        if "核心合成" in m.name:
            for n in nt.nodes:
                if n.type == "MIX_RGB":
                    n.inputs[0].default_value = 0.0            # no foil overlay on the artwork
                elif n.type == "MATH" and n.name in ("条纹强度", "限制辉光覆盖 0.018", "闪星亮度"):
                    n.inputs[1].default_value = 0.0            # no stripe / glow / star emission
                elif n.type == "BSDF_PRINCIPLED":
                    col = n.inputs["Base Color"]
                    if col.links:
                        src = col.links[0].from_socket
                        nt.links.remove(col.links[0])          # must unlink: a live Base Color
                        nt.links.new(src, n.inputs["Emission Color"])   # link beats the default
                    else:
                        n.inputs["Emission Color"].default_value = col.default_value
                    n.inputs["Base Color"].default_value = (0, 0, 0, 1)
                    n.inputs["Metallic"].default_value = 0.0
                    n.inputs["Emission Strength"].default_value = 1.0
                    # A Principled BSDF keeps a ~4% dielectric reflection even with a black base,
                    # and the studio lamps are bright enough that it lifted the whole artwork by
                    # ~15 levels (dark areas worst - the "washed out" look). Kill the reflection.
                    for key in ("IOR", "Specular IOR Level", "Specular"):
                        if key in n.inputs:
                            n.inputs[key].default_value = 1.0 if key == "IOR" else 0.0
        elif m.name.startswith("04"):                          # 古金压边 -> plain light trim
            for n in nt.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    n.inputs["Base Color"].default_value = (0.80, 0.80, 0.80, 1)
                    n.inputs["Roughness"].default_value = 0.45
        elif m.name.startswith("03"):                          # 镭射卡边 -> plain dark edge
            for n in nt.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    n.inputs["Emission Strength"].default_value = 0.0
                    n.inputs["Base Color"].default_value = (0.10, 0.10, 0.11, 1)
                    n.inputs["Roughness"].default_value = 0.5
    for o in bpy.data.objects:                                  # no warm gold key light
        if o.type == "LIGHT":
            o.data.color = (1, 1, 1)
    for o in bpy.data.objects:      # the decorative rings go too: the artwork is the subject
        if o.name.startswith(("外圈", "内圈")):
            o.hide_render = True
    print("clean mode: foil/gold/flecks/glow/rings off, artwork rendered unlit")
NATIVE = any(a == "native" for a in args[3:]) if len(args) > 3 else False
if NATIVE:
    bg = next(im for im in bpy.data.images if "background" in im.name.lower())
    bw, bh = bg.size
    scene.render.resolution_x, scene.render.resolution_y = bw, bh
    # Frame the camera tight to the card: build_card leaves a 22% margin, which renders the
    # artwork at ~82% of the texture resolution and softens it. 3% is enough for the sway.
    card_w, card_h = 6.3, 6.3 * bh / bw
    scene.camera.data.ortho_scale = max(card_w, card_h) * 1.03
    print("native render size", bw, bh, "ortho_scale", round(scene.camera.data.ortho_scale, 3))
else:
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1440
scene.render.resolution_percentage = 100
# EEVEE: the card is flat emissive/metal planes, so Cycles path tracing bought nothing but
# cost (22 s per frame at this size). EEVEE renders it rasterised with screen-space
# reflections, clean and roughly 20x faster, which is what makes a 10 s HD loop practical.
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE"
try:
    scene.eevee.taa_render_samples = 8
    scene.eevee.use_raytracing = True
except Exception as e:
    print("eevee options", e)
scene.render.image_settings.file_format = "PNG"

STRETCH = 240 / 96          # 96-frame cycle -> 240 frames = 10 s at 24 fps
SWAY = float(args[2]) if len(args) > 2 else 1.0   # optional: swing amplitude multiplier
for act in bpy.data.actions:
    for fc in act.fcurves:
        for kp in fc.keyframe_points:
            kp.co.x = 1 + (kp.co.x - 1) * STRETCH
            kp.handle_left.x = 1 + (kp.handle_left.x - 1) * STRETCH
            kp.handle_right.x = 1 + (kp.handle_right.x - 1) * STRETCH
        fc.update()

if SWAY != 1.0:
    for ob in bpy.data.objects:
        ad = ob.animation_data
        if not (ad and ad.action):
            continue
        for fc in ad.action.fcurves:
            if "rotation_euler" not in fc.data_path:
                continue
            for kp in fc.keyframe_points:
                kp.co.y *= SWAY
                kp.handle_left.y *= SWAY
                kp.handle_right.y *= SWAY
            fc.update()
    print("sway multiplied by", SWAY)

if STILL:
    scene.frame_start = scene.frame_end = 61      # 61 = the stretched 25th keyframe: card face-on
    scene.render.filepath = str(OUT / "still_")
    bpy.ops.render.render(write_still=True)
    print("STILL_RENDER_DONE", scene.render.resolution_x, scene.render.resolution_y)
else:
    scene.frame_start = 1
    scene.frame_end = 240
    scene.render.filepath = str(OUT / "frame_")
    bpy.ops.render.render(animation=True)
    print("ANIMATION_RENDER_DONE")
