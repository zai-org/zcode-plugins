# Contributing to ZCode Plugins

[中文文档](./CONTRIBUTING_CN.md)

Thank you for improving the ZCode Plugins Marketplace. Use GitHub Issues for proposals and questions, and pull requests for focused code or documentation changes.

## Before you start

- Check existing issues and pull requests so the work is not duplicated.
- For a new plugin, start from [`plugins/example-plugin/`](./plugins/example-plugin) and read its [development tutorial](./docs/PLUGIN_DEVELOPMENT.md).
- Keep one pull request focused on one plugin or one repository topic.

## Plugin contract

Every plugin must:

- live in a unique kebab-case directory under `external_plugins/` for partner/community submissions; `plugins/` is reserved for officially maintained plugins;
- include `.zcode-plugin/plugin.json` with `name`, `description`, `version`, and `author`;
- have a matching `name`, `version`, and description in the root [`marketplace.json`](./marketplace.json);
- provide at least one useful component: command, skill, hook, agent, or MCP server;
- include equivalent user-facing `README.md` and `README_CN.md` files; and
- use one supported category: `developer-tools`, `productivity`, `utilities`, `finance`, `guides`, `template`, or `other`.

Document network access, model/API/service dependencies, file writes, command execution, hooks, MCP servers, and other side effects in the plugin README. Identify third-party code, assets, and services together with their licenses.

Do not commit credentials, private endpoints, customer data, machine-specific paths, caches, build output, obfuscated source, or unnecessary prebuilt binaries.

## Development workflow

1. Fork [`zai-org/zcode-plugins`](https://github.com/zai-org/zcode-plugins) and create a branch from the latest `main`.
2. Copy the example plugin, or edit the existing plugin in scope:

   ```shell
   mkdir -p external_plugins
   cp -R plugins/example-plugin external_plugins/<your-plugin-name>
   ```

3. Update the manifest, component files, both language READMEs, and the root marketplace entry. Keep the manifest and marketplace versions identical.
4. Run the repository checks from the root:

   ```shell
   python3 scripts/validate.py
   python3 scripts/build_dist.py
   git diff --check
   ```

5. Exercise the plugin's main behavior in ZCode. Record reproducible steps and include screenshots or a short recording for UI changes.

## Pull request checklist

### Declare the plugin type (required)

Every PR must complete **Plugin type** in the [PR template](.github/PULL_REQUEST_TEMPLATE.md) before requesting review. Select exactly one option and list the affected manifest `name` values:

- **UI Plugin**: an affected plugin provides MCP Apps interactive pages, whether through `ui.surfaces` or a tool's `_meta.ui.resourceUri`. Select this even for changes limited to that plugin's docs or skills, or when adding or removing its interactive page.
- **Standard plugin**: an affected plugin provides no MCP Apps interactive page. MCP tools alone, or a skill that generates Gen UI, do not make a plugin a UI Plugin.
- **Not applicable**: only repository-level documentation, build, or CI changes; no installable plugin content changes.

If more than one plugin is affected, list each name and type, and select UI Plugin if any is affected. This declaration does not replace the marketplace `category` or the Conventional Commits title. Reviewers must confirm it is complete and accurate before approving.

In the pull request description, include:

- what user problem the change solves;
- the visible behavior and how it was tested;
- version changes and marketplace registration;
- dependencies, network requests, permissions, and side effects; and
- licensing or provenance for third-party material.

Before requesting review, confirm:

- [ ] the required plugin type is selected and affected plugin names are listed;
- [ ] the plugin name is unique and kebab-case;
- [ ] required files and both language READMEs are present;
- [ ] the category is correct;
- [ ] no secrets, private data, or machine-specific paths are included;
- [ ] `validate.py`, `build_dist.py`, and `git diff --check` pass; and
- [ ] review feedback has been addressed on the pull request.

Use [Conventional Commits](https://www.conventionalcommits.org/) for the title, for example `feat(example-plugin): add a greeting skill` or `docs: clarify plugin categories`.

## Versions and release

Installed plugin content is immutable once published. If installable content changes, bump the semantic version in both the plugin manifest and the matching `marketplace.json` entry. Never reuse a published version.

Maintainers review functionality, safety, maintainability, compatibility, provenance, and licensing. Accepted changes enter the official release process; the pull request will receive a publication or follow-up status update.
