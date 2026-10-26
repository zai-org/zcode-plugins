import hashlib
import io
import json
import re
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "github"

EXPECTED_SKILLS = {
    "codespace",
    "commit",
    "gist",
    "issue",
    "pr",
    "release",
    "repo",
    "secret",
    "setup",
    "workflow-run",
}


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_secret_sync_module():
    module_path = PLUGIN / "scripts" / "secret_sync.py"
    module = types.ModuleType("github_secret_sync")
    source = module_path.read_text(encoding="utf-8")
    exec(compile(source, str(module_path), "exec"), module.__dict__)
    return module


class GitHubPluginTests(unittest.TestCase):
    def test_zcode_and_compatibility_manifests_match(self) -> None:
        zcode_manifest = load_json(PLUGIN / ".zcode-plugin" / "plugin.json")
        claude_manifest = load_json(PLUGIN / ".claude-plugin" / "plugin.json")

        self.assertEqual(zcode_manifest, claude_manifest)
        self.assertEqual(zcode_manifest["name"], "github")
        self.assertEqual(
            zcode_manifest["author"],
            {"name": "Z.ai", "url": "https://z.ai"},
        )
        self.assertEqual(set(zcode_manifest["description_i18n"]), {"en", "zh-CN"})

    def test_marketplace_entry_matches_manifest(self) -> None:
        marketplace = load_json(ROOT / "marketplace.json")
        entry = next(
            item for item in marketplace["plugins"] if item["name"] == "github"
        )
        manifest = load_json(PLUGIN / ".zcode-plugin" / "plugin.json")

        self.assertEqual(entry["source"], "./plugins/github")
        self.assertEqual(entry["version"], manifest["version"])
        self.assertEqual(entry["description"], manifest["description"])
        self.assertEqual(entry["description_i18n"], manifest["description_i18n"])
        self.assertEqual(entry["author"], manifest["author"])

    def test_all_workflow_skills_are_packaged(self) -> None:
        skill_dirs = {
            path.parent.name
            for path in (PLUGIN / "skills").glob("*/SKILL.md")
        }
        self.assertEqual(skill_dirs, EXPECTED_SKILLS)

    def test_skill_frontmatter_and_namespaced_examples(self) -> None:
        bare_command = re.compile(
            r"^/(?:codespace|commit|gist|issue|pr|release|repo|"
            r"secret|setup|workflow-run)(?:\s|$)",
            re.MULTILINE,
        )
        descriptions = set()

        for skill_file in sorted((PLUGIN / "skills").glob("*/SKILL.md")):
            text = skill_file.read_text(encoding="utf-8")
            frontmatter = text.split("---", 2)[1]
            name_match = re.search(r"^name:\s*(\S+)\s*$", frontmatter, re.MULTILINE)
            description_match = re.search(
                r"^description:\s*(.+)\s*$",
                frontmatter,
                re.MULTILINE,
            )
            with self.subTest(skill=skill_file.parent.name):
                self.assertTrue(text.startswith("---\n"))
                self.assertIsNotNone(name_match)
                self.assertEqual(name_match.group(1), skill_file.parent.name)
                self.assertIsNotNone(description_match)
                self.assertIn("Use when", description_match.group(1))
                self.assertNotIn(description_match.group(1), descriptions)
                self.assertIsNone(bare_command.search(text))
                descriptions.add(description_match.group(1))

    def test_github_skills_require_install_and_authentication_preflight(self) -> None:
        reference_path = "../../references/github-cli-preflight.md"

        for skill_name in sorted(EXPECTED_SKILLS - {"commit"}):
            skill_text = (PLUGIN / "skills" / skill_name / "SKILL.md").read_text(
                encoding="utf-8"
            )
            with self.subTest(skill=skill_name):
                self.assertIn(reference_path, skill_text)
                self.assertNotIn("Error: Run 'gh auth login' first", skill_text)

        preflight = (PLUGIN / "references" / "github-cli-preflight.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("command -v gh", preflight)
        self.assertIn("gh auth status --hostname <host>", preflight)
        self.assertIn(
            "gh auth login --hostname <host> --git-protocol https --web",
            preflight,
        )
        self.assertIn("Never ask the user to paste a personal access token", preflight)
        self.assertIn("After the user reports completion, run `gh auth status", preflight)
        self.assertIn("GH_HOST", preflight)
        self.assertIn("GH_REPO", preflight)
        self.assertIn("GH_PROMPT_DISABLED=1", preflight)
        self.assertIn("Never paste an untrusted value directly", preflight)

    def test_known_invalid_or_unsafe_command_templates_are_absent(self) -> None:
        skill_text = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted((PLUGIN / "skills").glob("*/SKILL.md"))
        )

        for forbidden in (
            "gh browse --actions",
            "gh run list --web",
            "gh pr diff <pr_number> --stat",
            'gh pr create --base <base_branch> --head <head_branch> --title "<title>" --body "<description>"',
            'gh issue create --title "<title>" --body "<body>"',
            'gh secret set <name> -b "<value>"',
            'echo "<content>" | gh gist create',
            'gh pr merge <pr_number> --squash|--rebase|--merge',
            'gh pr review <pr_number> --approve',
            'gh pr review <pr_number> --comment',
            'gh pr review <pr_number> --request-changes',
            'gh gist edit <gist_id>',
            'gh gist delete <gist_id>\n',
            'gh run list --workflow <workflow> --limit 1',
            'git stash push -m "Auto-stash before PR checkout"',
            "git branch --list <head_branch>",
            "git branch --list <base_branch>",
            "gh secret set --env-file .env.production",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, skill_text)

        for forbidden_pattern in (
            r'--(?:title|desc|description)\s+"<',
            r'-f\s+(?:title|description|due_on)="<',
            r"gh\s+pr\s+merge[^\n]*--squash\|--rebase",
        ):
            with self.subTest(forbidden_pattern=forbidden_pattern):
                self.assertIsNone(re.search(forbidden_pattern, skill_text))

    def test_destructive_workflows_have_explicit_confirmation_and_safe_modes(self) -> None:
        required_confirmation_phrases = {
            "pr": ("explicitly confirms", "--match-head-commit"),
            "gist": ("explicit confirmation", "--yes"),
            "release": ("explicitly confirms", "--target <target_sha>"),
            "workflow-run": ("explicitly confirms", "--event workflow_dispatch"),
            "codespace": ("explicit confirmation", "gh api --method DELETE"),
            "issue": (
                "explicit confirmation",
                "--reason <completed_or_not_planned>",
                "gh label delete",
                "-X DELETE",
            ),
            "secret": ("explicit confirmation", "scripts/secret_sync.py apply"),
        }

        for skill_name, required in required_confirmation_phrases.items():
            skill_text = (PLUGIN / "skills" / skill_name / "SKILL.md").read_text(
                encoding="utf-8"
            )
            with self.subTest(skill=skill_name):
                for phrase in required:
                    self.assertIn(phrase, skill_text)

    def test_secret_sync_preview_and_apply_share_one_parser(self) -> None:
        secret_sync = load_secret_sync_module()
        dotenv = """
        # ignored
        export API_KEY="alpha beta"
        CACHE_HOST=cache.internal # comment
        EMPTY=
        """

        entries = secret_sync.parse_dotenv(dotenv)
        self.assertEqual(
            entries,
            [
                ("API_KEY", "alpha beta"),
                ("CACHE_HOST", "cache.internal"),
                ("EMPTY", ""),
            ],
        )

        with (
            mock.patch.object(secret_sync.subprocess, "run") as run,
            mock.patch("builtins.print"),
        ):
            secret_sync.apply(entries, "github.com/owner/repo")

        self.assertEqual(run.call_count, len(entries))
        for call, (name, value) in zip(run.call_args_list, entries):
            self.assertEqual(
                call.args[0],
                [
                    "gh",
                    "secret",
                    "set",
                    name,
                    "--repo",
                    "github.com/owner/repo",
                ],
            )
            self.assertEqual(call.kwargs["input"], value)
            self.assertTrue(call.kwargs["check"])
            self.assertEqual(call.kwargs["env"]["GH_PROMPT_DISABLED"], "1")

    def test_secret_sync_rejects_ambiguous_or_unsafe_files(self) -> None:
        secret_sync = load_secret_sync_module()

        with self.assertRaises(secret_sync.DotenvError):
            secret_sync.parse_dotenv("TOKEN=first\nTOKEN=second\n")
        with self.assertRaises(secret_sync.DotenvError):
            secret_sync.parse_dotenv('TOKEN="unterminated\n')
        with self.assertRaises(secret_sync.DotenvError):
            secret_sync.parse_dotenv("GITHUB_TOKEN=value\n")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "secrets.env"
            target.write_text("TOKEN=value\n", encoding="utf-8")
            link = root / "linked.env"
            link.symlink_to(target)
            with self.assertRaises(secret_sync.DotenvError):
                secret_sync.read_regular_file(str(link))

    def test_secret_sync_rejects_case_insensitive_duplicates_before_submission(self) -> None:
        secret_sync = load_secret_sync_module()
        dotenv = "TOKEN=first\ntoken=second\n"

        with self.assertRaisesRegex(secret_sync.DotenvError, "duplicate secret name token"):
            secret_sync.parse_dotenv(dotenv)

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "secrets.env"
            path.write_text(dotenv, encoding="utf-8")
            for action in ("preview", "apply"):
                argv = ["secret_sync.py", action, "--file", str(path)]
                if action == "apply":
                    argv.extend([
                        "--repo", "example/repo",
                        "--expect-sha256", secret_sync.content_sha256(dotenv),
                    ])
                with (
                    self.subTest(action=action),
                    mock.patch("sys.argv", argv),
                    mock.patch("sys.stderr", new_callable=io.StringIO) as stderr,
                    mock.patch.object(secret_sync.subprocess, "run") as run,
                ):
                    self.assertEqual(secret_sync.main(), 2)
                    self.assertIn("duplicate secret name token", stderr.getvalue())
                    run.assert_not_called()

    def test_secret_sync_digest_binds_preview_to_apply(self) -> None:
        secret_sync = load_secret_sync_module()
        original = "TOKEN=first\n"
        changed = "TOKEN=second\n"

        self.assertNotEqual(
            secret_sync.content_sha256(original),
            secret_sync.content_sha256(changed),
        )

    def test_legacy_git_plugin_namespace_is_absent(self) -> None:
        plugin_bytes = b"\n".join(
            path.read_bytes()
            for path in sorted(PLUGIN.rglob("*"))
            if path.is_file()
        )
        marketplace = load_json(ROOT / "marketplace.json")

        self.assertNotIn(b"/git:", plugin_bytes)
        self.assertIsNone(re.search(rb"plugins/git(?!hub)", plugin_bytes))
        self.assertNotIn("git", {entry["name"] for entry in marketplace["plugins"]})
        self.assertFalse((ROOT / "plugins" / "git").exists())


if __name__ == "__main__":
    unittest.main()
