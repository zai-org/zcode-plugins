# Third-party notices

## ws 8.22.0

- Upstream: https://github.com/websockets/ws
- Distribution: https://registry.npmjs.org/ws/-/ws-8.22.0.tgz
- npm integrity: `sha512-Ydggc987+RO0AnWtZ/7Wq9FtNvcrL1b/RO0ud9mWjUPgDrsAAwQSF51sm2hm1XofbU/4jkpGEsLFsZZxU+1DOg==`
- Location: `server/vendor/ws/`
- License: MIT. The original copyright notices and license text are retained in `server/vendor/ws/LICENSE`.

Files are copied without modification from the installed npm distribution pinned by `server/package-lock.json`. No native optional acceleration module is bundled or required. Browser Bridge's bridge imports this vendored copy directly, so installation and startup do not run npm or download a dependency.

Browser Bridge's own source, documentation, and original icons are licensed separately under Apache-2.0. Chrome browser APIs are used at runtime; Chrome itself is not bundled.
