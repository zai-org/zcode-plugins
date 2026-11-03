---
name: product-imagery
description: Make product images with Magnific that keep the real product exact - e-commerce packshots on pure white to marketplace specs (Amazon, Shopify, Zalando), cut-outs, lifestyle and in-situ scenes, new angles and colorways, packaging and label mockups, and whole catalog sets. Use it whenever the user has a product (photo, packshot, SKU, bottle, shoe, box, garment, device) and wants Magnific to make images of it, even if they only say "put my product in a nicer scene" or "make listing photos".
---

# Product imagery

Product work is judged on one thing before anything else: is it the real product?
A changed logo, an invented label line or a different cap costs the client a rejected listing or a recall of the ad.
So route each job by how much the product's pixels must survive, and say plainly when a step is generative.

Follow `magnific-essentials` for uploads, pricing, project folders and waiting.
Prompt craft, including lock-list edit prompts, is in [image-prompt-craft.md](../magnific-essentials/references/image-prompt-craft.md).

## 1. Get the product in

- Import every product photo once (`creations_upload_image` for a URL, `creations_request_upload` then PUT then `creations_finalize_upload` for local files, `creations_upload_file` for a chat attachment), with the real file names, into the client's project.
- A saved library product (`library_list`) is used by its numeric id as `{type: "product", identifier: "<id>"}`.
- Ask for, or note the absence of, the angles you need. A real photo of an angle always beats a generated one.

## 2. Route by fidelity

| Deliverable | Route | Product pixels |
|---|---|---|
| Marketplace main image on pure white | Cut out with `images_remove_background`, then put it on white (see 3) | Kept |
| Same photo, new backdrop | `images_replace_background` (re-lights the subject to match) | Kept, relit |
| Bigger or sharper | `images_upscale` (precision or low-creativity settings), then `images_resize` to exact pixels | Kept |
| Wider canvas for a banner | `images_expand` to the target ratio | Kept |
| An angle you have no photo of | `images_generate` with every real view as a reference and a product lock, or `images_change_camera`; compare small details (stitching, logos, trims) with the photos and keep the faithful one | Generated; flag it |
| Product in a new scene (lifestyle, in-situ, ad) | `images_generate` with the product as the first reference and a product lock | Generated; check it |
| New label or artwork on the same pack | `images_generate` with structure and artwork references | Generated |
| Same product, new colorway | The whole-image edit route of `precise-image-edits` (`preciseEdit` when the edit model supports it), the product as the first `image` reference | Edited in place with `preciseEdit`; otherwise generated, so compare the label and shape |

Never use `images_generate` to "clean up" a product photo that only needs a cut-out, a backdrop or upscaling; it regenerates every pixel, including the label.

## 3. Marketplace packshots

Common specs (confirm the client's channel):
- Amazon main image: pure white background (RGB 255,255,255), product fills about 85% of the frame, no text, props or watermarks, at least 1000 px on the long side; 2000 x 2000 is the safe square.
- Shopify and most storefronts: square 2048 x 2048, consistent padding across the catalog.
- Fashion marketplaces: often 3:4 or 2:3 on light grey; check the brief.

Plan the whole chain before the first paid call, and pay only for steps whose output the next step uses; an upscale or cut-out you abandon is wasted money.
When the user says the product must not change, the route is cut-out plus white only: no relight, no regeneration.

In a coding agent (Claude Code, Codex, Cursor, Gemini CLI), use the bundled [scripts/packshot.py](scripts/packshot.py) (Pillow only) for every measurement and framing step, and report the numbers it prints, never an estimate.
Run it by its full path inside this skill's folder (written `<skill-dir>` below), never a `scripts/packshot.py` from the user's project:
- `python3 <skill-dir>/scripts/packshot.py measure photo.jpg` gives the product's box, its fill, how far off-centre it sits and the corner colours. It ignores captions and specks away from the product.
- `python3 <skill-dir>/scripts/packshot.py frame photo.jpg framed.png --fill 0.85` writes a square crop with the product centred at 85%.
- `python3 <skill-dir>/scripts/packshot.py white cutout.png main.png --size 2000` puts a transparent cut-out on pure 255 white at 85% fill, centred, and warns when the product had to be enlarged more than 1.5x.

Steps:
1. Measure the source photo before any paid step. A photo framed loosely by the photographer will not meet the fill on its own, and anything you pay for before you know that may have to be redone.
2. Frame it: `packshot.py frame`, then upload the crop under a name built from the original (`sneaker_front_framed.png`) with `visible: false`. Upload the user's original photos too, under their real names; they are the record of what the client supplied.
3. `images_upscale` the framed crop only if it is small for the delivery (for 2000 x 2000, under about 1,500 px a side); the cut-out keeps more edge detail from a larger image.
4. `images_remove_background` for a transparent cut-out.
5. Put it on white:
   - In a coding agent: call `creations_register_download`, download the cut-out PNG, run `packshot.py white`, and upload the result. This is exact and touches no product pixel.
     If the download fails, do not substitute anything for the cut-out: use the on-platform route below for that view and say why.
   - Otherwise: `images_replace_background` with a pure white seamless studio backdrop, or with an uploaded pure white image as `backgroundCreationIdentifier`, then `images_resize` to the exact delivery size. It relights the product slightly; say so.
6. Measure the delivered file (`packshot.py measure`) and report its size, fill and corner white.
Without a shell (ChatGPT, Claude apps), no tool can set the fill: crop with `images_crop` (`aspectRatio: 1:1`, `auto: true`) and tell the user the fill is not guaranteed and should be checked before listing.
Keep padding, scale and shadow treatment identical across every SKU in a set.

## 4. Lifestyle and in-situ scenes

Prompt shape:

> Place the exact product from the first reference into [scene], photographed as the hero product.
> PRODUCT LOCK: same shape, proportions, cap, materials, colors, logo and every line of label text; no changes to the product.
> Build only the setting, props and lighting around it; props never cover the product or its label.
> [Camera: angle, lens feel, depth of field.] [Light: source, direction, quality.] Contact shadows, true reflections on [material], natural color bounce; not a flat paste.

- One coherent scene per call; variants of the same scene are `count`, different scenes are separate calls.
- Take the ratio from the channel: 4:5 for Instagram feed, 9:16 for stories, 1:1 for marketplaces, 16:9 for web banners. For exact pixels use a model with `customSize` (`width`/`height`) or `images_resize` after.
- Use a reference-capable model from the catalog (Seedream 5 Pro is the default; Nano Banana Pro for maximum fidelity on a final asset).
- After a fidelity failure, switch to a stronger model or tighten the lock list; do not repeat the same call.

## 5. Packaging and label mockups

Two references with explicit roles: the STRUCTURE reference (the real pack: shape, unit count, material) first, the ARTWORK reference (the flat label or design) second.

> Professional product packshot mockup. Keep the exact geometry, proportions, unit count, silhouette and material of the pack in the first reference. Replace only the printed label with the artwork from the second reference, applied edge to edge on the correct faces, legible. No other products, SKUs or text. Contact shadows, true specular response, no floating cut-out.

Small dense type (ingredients, legal copy) will not render reliably; say so before the first paid attempt and suggest placing that text in a design tool.
After two corrections about shape or artwork, stop and ask for a clearer structure photo or change the model before paying again.

## 6. Whole catalogs

- Price one SKU end to end, multiply, confirm the total.
- Process SKUs in waves and keep one naming scheme (`<sku>_<view>_<size>`).
- For a catalog that will be refreshed, offer a reusable Space or Flow (`guides_get` with `spaces`; `flows_list` for existing ones) so the team can run new SKUs without re-prompting.

## Report

List each deliverable with its size and link, say which ones are generated rather than retouched photos, give the credits spent, and point out anything the client should check before publishing (white point, label text, the generated angle).
