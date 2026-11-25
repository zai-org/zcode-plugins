"""Rule table for the PreToolUse guard (hooks/replicate/c2v_guard.py): credential reads and
direct service calls are denied in-session. Plain data only: no imports beyond re, no project
paths.

History: an ASSET_REF / ASSET_EDIT_OPS table (operations that rewrite a hosted-3D product) lived
here for the pipeline's post-run script audit. Removed 2026-11-07 (user decision): a regex over the
agent's Blender code cannot tell a local repair from a rewrite, and 3d.md now allows a decimated
tuning copy of the model. The post-run audit only checks the product files' sha256 now.
"""
import re

# ---- credential / direct-call rules (hook only; the audit does not use them)
SECRET_NAME = re.compile(r"\bVE_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)\b")
SECRET_PATHS = re.compile(r"/run/ve_secrets|/proc/(?:\d+|self)/environ")
# `env`, `printenv`, `set`, `export -p`, `declare -x` in command position with no argument that
# narrows them to one named, harmless variable (`env -i cmd`, `env X=1 cmd`, `set -e` pass).
ENV_DUMP = re.compile(r"(?:^|[;&|(`]|\$\(|&&|\|\|)\s*(?:\w+=\S*\s+)*"
                      r"(?:(?:env|printenv)\s*(?=$|[;&|)>]|\s*$)|export\s+-p\b|declare\s+-x\b|set\s*(?=$|[;&|)]))", re.M)
# python inline: the whole mapping, not one named key
OS_ENVIRON_DUMP = re.compile(r"os\.environ(?!\s*(?:\[|\.get\(|\.setdefault\(|\.pop\(|\[))")
SERVICE_VAR = re.compile(r"\$\{?VE_[A-Z0-9_]*(?:BASE|BASE_URL|ENDPOINT|PROXY)\b")
# service addresses a shell command must not request directly: every generation service is a ToolHub tool route
DEFAULT_GUARD_HOSTS = ("/api/v1/toolhub/",)
