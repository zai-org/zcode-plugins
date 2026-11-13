# Sounio

[中文文档](./README_CN.md)

Check a Sounio `.sio` source file using a compiler already available in the local project, and keep source checking separate from compilation, execution, CI, and scientific validation.

## Requirements

- ZCode with this plugin installed and enabled.
- A Sounio checkout containing `bin/souc`, or a `souc` command already on `PATH`.
- The `.sio` file to check must be accessible in the current project.

## Use

Invoke `/sounio:check-sio path/to/file.sio` in a Sounio project. The command reads project instructions, checks that the file exists, then asks ZCode to run `souc check` through the project wrapper or an existing compiler on `PATH`. It reports the exit status and diagnostics without claiming that the program compiled or ran.

The `sounio-development` skill is also available when working on Sounio source or compiler diagnostics. It emphasizes the repository's own instructions and evidence boundaries.

## Permissions and side effects

This plugin contains only prompt files: no executable script, hook, MCP server, bundled compiler, or credential requirement. The check command asks ZCode to execute the local compiler on the named file; review that shell action before approving it. The plugin itself does not install software, send data to a network service, or edit project files. The selected compiler or wrapper may create or update temporary files and project-local generated artifacts. In particular, Sounio's `bin/souc` may materialize `bin/madaros-linux-x86_64` and `bin/.madaros-linux-x86_64.verified` in the checkout during startup.

The plugin text is original and released under Apache-2.0. Sounio itself is a separate Apache-2.0 project at [Sounio-lang/sounio](https://github.com/Sounio-lang/sounio).
