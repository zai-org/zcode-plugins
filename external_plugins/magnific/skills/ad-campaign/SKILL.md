---
name: ad-campaign
description: Make static campaign creative with Magnific - key visuals, social posts, stories, banners, posters and display ads, on-brand with a brand kit, adapted to every format and safe zone, with A/B test variants and localized versions. Use it when the user wants Magnific to make any ad, campaign, key visual, social post, carousel, banner, poster, thumbnail or "make variations of this ad" request from a marketing team or agency, including when they want a layout copied from an existing ad.
---

# Campaign creative

Agencies and in-house teams need a master that is right, then many exact adaptations of it, fast and on budget.
The common failures are drifting off-brand, re-inventing the layout in every format, and burning credits on variants that test nothing.

Follow `magnific-essentials` for pricing, project folders and waiting.
Prompt craft is in [image-prompt-craft.md](../magnific-essentials/references/image-prompt-craft.md).

## 1. Brief and project

From the request, settle: product or offer, audience, single message, mandatory elements (logo, legal line, price, CTA), channels and formats, languages, client, budget.
Find or create the client's project and pass `folderReference` on every call; agencies bill and review per project.

## 2. On-brand: use the brand kit

If the client has a kit, it owns colors, type, logo and imagery.
- Find it with `brand_kit_list` (`search` by name), read it with `brand_kit_get`. Several matches: ask; never guess.
- `images_generate` with `brandKitId` always runs Magnific One. Keep the prompt short: the subject plus hard constraints ("winter blend on a cabin table, snow outside, no text"). Do not restate palette, fonts, logo or tone.
- Use `templateSlug` (from the kit's `templates`) when the user asked for that format, and `channel` (for example `instagram_post`, `instagram_story`, `linkedin_post`, `youtube_thumbnail`, `print`) when you know the destination, so the kit's channel rules apply.
- Read `brandCheck` on the finished image (via `creations_wait` or `creations_get`) before calling it on-brand.
- Kit rules the client set (bans) are applied by the server; do not fight them in the prompt.
The full brand-kit procedure, including building a kit from a website, is in `guides_get` with `brand-kit`.

No kit: write the brand cues into a reusable style line (palette in words or hex, type feel, photographic tone) and repeat it in every prompt; offer to build a kit (`brand_kit_create` + `brand_kit_scrape_url`) if the client will come back.

## 3. Formats and safe zones

| Placement | Ratio | Notes |
|---|---|---|
| Instagram and Facebook feed | 4:5 (or 1:1) | 1080 x 1350 |
| Stories, Reels, TikTok | 9:16 | keep text out of the top 14% and bottom 20% |
| LinkedIn and X posts | 1:1 or 1.91:1 (use 16:9 if 1.91 is unavailable) | |
| YouTube thumbnail | 16:9 | 1280 x 720, readable at small size |
| Web hero, display leaderboard | 16:9, 3:1, 8:1 | very wide shapes need a `customSize` model (up to 8:1, or 16:1 on Seedream 5 Pro) |
| Print | per the printer's spec | deliver `tiff16` |

Not every model offers every ratio (Magnific One, for example, has no 4:5); use the closest supported ratio and adapt with `images_expand` or `images_crop`, or set exact `width` and `height` on a `customSize` model.
To adapt a finished ad to 4:5 (or any ratio `images_expand` and `images_crop` lack), use `design_auto_resize` with that ratio in `aspectRatios`: it keeps the layout as editable layers. In a coding agent, expanding to 3:4 and cropping to 4:5 locally also works. Do not regenerate the winner for a new ratio.

## 4. Master first, then adaptations

- Generate the master in its main format and get it approved (or pick the best of a `count` set).
- Adapt the approved master instead of regenerating per format:
  - `images_expand` to a wider or taller ratio keeps the art and generates the margins;
  - `images_crop` (with `auto: true` for subject-aware crops) for tighter ratios;
  - `design_auto_resize` turns a design into resized pages for many aspect ratios at once, with editable layers when it can;
  - `images_resize` for exact pixels.
- Regenerate per format only when the composition must truly change (a 9:16 story with the subject in a different place), and then pass the master as an `image` reference.
- Exception, brand kits: when the kit has a template or channel for a format, generate that format with its `templateSlug` and `channel` and the master as an `image` reference, so the kit's channel rules (logo position, safe zones) apply and each file gets its own `brandCheck`. A crop of another format skips both.
  Then crop or resize the result to the platform's exact size (for example 4:5 at 1080 x 1350 when the model has no 4:5).

## 5. Copy a reference layout

When the user wants "the same design with new copy" or "keep the layout":
- Pass the reference ad as the first `image` reference and write the layout explicitly: "Same layout as the reference: headline top left, product centered, logo top left, CTA button bottom right. New headline text: \"...\". New background: ...".
- Text-and-layout heavy designs render best on GPT image models (catalog `useFor` typography, text_layout); check `images_models_list`.
- For an edit that must keep everything except the copy, use the whole-image edit route of `precise-image-edits` with the ad as the first reference (`preciseEdit` when the edit model supports it).
- Quote exact copy, keep it short, and proofread the result. Long legal lines belong in the design tool.

## 6. Variants for testing

- Each variant should test one hypothesis (hook, headline angle, background scene, product framing, CTA), and the reply should say which.
- Six variants that differ randomly teach the team nothing; vary one dimension per test cell and hold the rest.
- Variants of one prompt = one call with `count`; different hypotheses = different calls, in parallel.
- In a grid that holds one dimension fixed while another varies (3 headlines on 2 scenes), the fixed one must be identical across its cells, or the test measures noise: make each scene once, then change only the headline on it with the whole-image edit route.
  Make each scene base from the original ad with that route, changing only the background, so the product, props, logo and button stay as approved; a base rebuilt from a prompt drifts (props and backgrounds get swapped).
  Without `preciseEdit` the edit model also redraws the rest of the ad, so compare each base with the original before you use it; for copy-only cells, setting the headline in a design tool keeps the cells identical.
- Keep variants in one format for the test; adapt only the winner.
- When the layout, logo and button must stay exactly as in the original ad, edit the original per variant (the whole-image edit route, see section 5) rather than regenerating the whole ad.
- Show the variants together (`creations_show` with all identifiers in chat apps) so the team compares them side by side.

## 7. Localization

Generate the text-free master once, then put each market's copy on it (in a design tool, or with the whole-image edit route of `precise-image-edits` for short headlines), rather than regenerating the image per language.
Quote the translated copy exactly; for right-to-left or CJK scripts, prefer models with strong typography and proofread.

## 8. Review and delivery

- For client review, follow the review rule in `magnific-essentials`.
- Deliver `png16` or `tiff16` for print and retouching, the generated PNG for digital.
- Report: each asset by format with its link, the credits spent, what each variant tests, and what still needs a human (final type, legal lines).
