---
output_ext: php
---

Task: write a Laravel database migration, following the SKILL GUIDANCE below exactly.

SKILL GUIDANCE:
{{SKILL_GUIDANCE}}

REPO CONTEXT: a real Laravel application (laravel/laravel skeleton, framework ^13, PHP 8.3) with the standard `users` table present.

SPEC (in the developer's words): create the `products` table — auto-increment primary key; unique SKU string; name string; optional long description; price as a money decimal with 2 decimal places, unsigned, defaulting to zero; integer stock count defaulting to zero; boolean active flag defaulting to true; the owning user as a foreign key to `users` that cascades on delete; timestamps. Include the `down()` method.

Respond with the complete migration PHP file between these markers, and nothing else:
OUTPUT_BEGIN
OUTPUT_END
