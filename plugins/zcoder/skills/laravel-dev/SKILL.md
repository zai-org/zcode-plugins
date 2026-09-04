---
name: laravel-dev
description: Laravel development conventions — database migrations (Schema column methods, foreignId/constrained/cascadeOnDelete, decimal money columns), artisan scaffolding (make:model -a, make:migration naming), Eloquent model structure, and testing via artisan test. Use whenever working in a Laravel or PHP artisan project: writing or reviewing migrations, generating models, controllers, policies, or seeders, or choosing artisan commands — even for one column.
---

# Laravel Development

Conventions for Laravel apps (validated against the v13 framework line).
Modern column methods are preferred because they encode semantics —
constraints, indexes, and intent — that the old spell-outs left implicit.

## Migrations

- Anonymous migration class: `return new class extends Migration { ... };`
  with `up()` and `down()`.
- Create tables inside `Schema::create('table', function (Blueprint $table) {
  ... })`; `down()` is `Schema::dropIfExists('table')`.
- Table names: plural snake_case of the model (`Product` → `products`).
- Column conventions:
  - PK: `$table->id();`
  - FK: `$table->foreignId('user_id')->constrained()->cascadeOnDelete();`
    (NOT `unsignedBigInteger` + a separate `foreign()` call — the shorthand
    creates, names, and indexes the constraint in one chain)
  - money: `$table->decimal('price', 8, 2);` — arguments are
    (total digits, decimal places)
  - flags: `$table->boolean('active')->default(true);`
  - soft deletes: `$table->softDeletes();`
  - timestamps: `$table->timestamps();`
- Column modifiers chain after the type call: `->nullable()`, `->default(x)`,
  `->unsigned()`, `->unique()`.

## Artisan scaffolding

- One command scaffolds the full suite around a model:
  `php artisan make:model Product -a` (long form `--all`) → model +
  migration + factory + seeder + policy + resource controller.
- Migration file naming drives table-name inference:
  `create_products_table` → table `products`.
- Run the suite: `php artisan test [path]`.

## Eloquent

- `class Product extends Model`; mass-assignment guard via
  `protected $fillable = [...]` (or `protected $guarded = [];`).
- Attribute casts via the `casts()` method:
  `protected function casts(): array { return ['active' => 'boolean']; }`
- Relations: `hasMany` / `belongsTo`; pass the foreign key only when it is
  not the conventional `<model>_id`.

## Validation

- Request validation belongs in FormRequest classes with a `rules(): array`
  method, not inline in controllers.

## Testing

- Feature tests use the `RefreshDatabase` trait; assert database state and
  responses, not rendered strings.
