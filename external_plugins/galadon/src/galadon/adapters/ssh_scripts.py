from __future__ import annotations

import re
import shlex
from typing import Any

from .release import (
    ROOT_MARKER,
    shell_lock,
    shell_prune_releases,
    shell_retain_previous,
    shell_switch_current,
)

# Everything the ssh adapter runs on the host, as the bash it sends. A host
# may only have coreutils, systemd and Caddy, so none of this may assume more.
REMOTE_PATH = "export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

SAFE_HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:\[\]-]*$")
SAFE_USER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
SAFE_SERVICE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.@-]*$")
SAFE_DOMAIN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]*$")
SAFE_LISTEN = re.compile(r"^[A-Za-z0-9_.:\[\]-]+$")
SAFE_MARKER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
SAFE_PATH = re.compile(r"^[A-Za-z0-9._/-]+$")


def quote(value: Any) -> str:
    return shlex.quote(str(value))


def unit_text(
    service: str, run_user: str, root: str, exec_start: str, environment_file: str = ""
) -> str:
    environment = f"EnvironmentFile={environment_file}\n" if environment_file else ""
    return f"""[Unit]
Description=Galadon service {service}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User={run_user}
Group={run_user}
WorkingDirectory={root}/current
{environment}ExecStart={exec_start}
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
"""


def caddy_block(domain: str, listen: str, marker: str, search_index: bool) -> str:
    # A managed site stays out of search engines until the project opts in:
    # a deploy tool must not publish a test site to the world by default.
    robots = (
        ""
        if search_index
        else '    header X-Robots-Tag "noindex, nofollow"\n'
        "    respond /robots.txt `User-agent: *\n"
        "Disallow: /` 200\n"
    )
    return (
        f"# galadon:begin {marker}\n"
        f"{domain} {{\n"
        "    import access_log\n"
        f"{robots}"
        f"    reverse_proxy {listen}\n"
        "}\n"
        f"# galadon:end {marker}\n"
    )


def preflight_script(root: str, service: str, unit: str, unit_path: str) -> str:
    drift_check = ""
    if unit:
        drift_check = (
            "expected_unit=$(mktemp)\n"
            "cat > \"$expected_unit\" <<'GALADON_UNIT'\n"
            f"{unit}"
            "GALADON_UNIT\n"
            f'if ! cmp -s "$expected_unit" {quote(unit_path)}; then\n'
            '  rm -f "$expected_unit"\n'
            f'  echo "galadon: systemd unit drift detected: {unit_path}" >&2\n'
            '  echo "galadon: run `galadon bootstrap --env <env>` to converge the unit" >&2\n'
            "  exit 78\n"
            "fi\n"
            'rm -f "$expected_unit"\n'
        )
    return f"""set -euo pipefail
{REMOTE_PATH}
root={quote(root)}
service={quote(service)}
test -d "$root" || {{ echo "galadon: remote_root is missing: $root" >&2; exit 66; }}
test -w "$root" || {{ echo "galadon: remote_root is not writable: $root" >&2; exit 66; }}
command -v systemctl >/dev/null 2>&1 || {{ echo "galadon: systemctl is unavailable" >&2; exit 69; }}
command -v flock >/dev/null 2>&1 || {{ echo "galadon: flock is unavailable" >&2; exit 69; }}
systemctl cat "$service" >/dev/null 2>&1 || {{ echo "galadon: systemd service is not installed: $service" >&2; exit 66; }}
{drift_check}printf 'GALADON_OK=1\\n'
"""


def prepare_script(root: str, release_dir: str) -> str:
    return f"""set -euo pipefail
root={quote(root)}
test -d "$root" || {{ echo "galadon: remote_root is missing: $root" >&2; exit 66; }}
install -d -m 0755 {quote(root + "/releases")} {quote(root + "/shared")}
test ! -e {quote(release_dir)} || {{ echo "galadon: release directory already exists: {release_dir}" >&2; exit 73; }}
printf 'GALADON_OK=1\\n'
"""


def finalize_script(
    root: str,
    service: str,
    run_user: str,
    release_dir: str,
    remote_migrate: str,
    keep: int,
) -> str:
    return f"""set -euo pipefail
{REMOTE_PATH}
root={quote(root)}
service={quote(service)}
run_user={quote(run_user)}
release={quote(release_dir)}
remote_migrate={quote(remote_migrate)}
keep_releases={int(keep)}
{shell_lock()}test -d "$release" || {{ echo "galadon: release directory is missing: $release" >&2; exit 66; }}
chown -R "$run_user:$run_user" "$release"
if [ -n "$remote_migrate" ]; then
  echo "galadon: remote migrate in $release" >&2
  migrate_status=0
  ( cd "$release" && eval "$remote_migrate" ) || migrate_status=$?
  if [ "$migrate_status" -ne 0 ]; then
    echo "galadon: remote migrate failed with exit $migrate_status in $release; current was not switched" >&2
    exit 70
  fi
fi
{shell_retain_previous()}{shell_switch_current('"$release"', "new")}if ! systemctl restart "$service"; then
  echo "galadon: service restart failed; restoring previous current" >&2
  if [ -n "$old" ]; then
    ln -sfn "$old" "$root/.current.restore"
    mv -Tf "$root/.current.restore" "$root/current"
    if ! systemctl restart "$service"; then
      echo "galadon: previous release also failed to restart" >&2
    fi
  else
    rm -f "$root/current"
  fi
  exit 1
fi
{shell_prune_releases()}printf 'GALADON_PREVIOUS=%s\\n' "$old"
printf 'GALADON_CURRENT=%s\\n' "$release"
printf 'GALADON_OK=1\\n'
"""


def rollback_script(root: str, service: str) -> str:
    return f"""set -euo pipefail
{REMOTE_PATH}
root={quote(root)}
service={quote(service)}
{shell_lock()}if [ ! -L "$root/previous" ] && [ ! -e "$root/previous" ]; then
  rm -f "$root/current"
  systemctl stop "$service"
  printf 'GALADON_FIRST_RELEASE=1\\n'
  printf 'GALADON_OK=1\\n'
  exit 0
fi
test -L "$root/previous" || {{ echo "galadon: no previous release link" >&2; exit 66; }}
target=$(readlink -f "$root/previous")
test -d "$target" || {{ echo "galadon: previous release is missing: $target" >&2; exit 66; }}
case "$target" in
  "$root/releases/"*) ;;
  *) echo "galadon: previous link does not point into $root/releases: $target" >&2; exit 65 ;;
esac
{shell_switch_current('"$target"', "rollback")}systemctl restart "$service"
printf 'GALADON_ROLLBACK_TO=%s\\n' "$target"
printf 'GALADON_OK=1\\n'
"""


def bootstrap_script(
    root: str,
    service: str,
    run_user: str,
    domain: str,
    listen: str,
    marker: str,
    unit_path: str,
    unit: str,
    block: str,
    manage_user: bool,
) -> str:
    return f"""set -euo pipefail
{REMOTE_PATH}
root={quote(root)}
service={quote(service)}
run_user={quote(run_user)}
domain={quote(domain)}
listen={quote(listen)}
marker={quote(marker)}
unit_path={quote(unit_path)}

marker_file="$root/{ROOT_MARKER}"
if [ -d "$root" ]; then
  if [ -f "$marker_file" ]; then
    existing=$(cat "$marker_file")
    if [ "$existing" != "$marker" ]; then
      echo "galadon: refusing to bootstrap $root: it belongs to marker $existing" >&2
      exit 65
    fi
  elif [ -n "$(ls -A "$root" 2>/dev/null)" ]; then
    echo "galadon: refusing to bootstrap $root: directory is not empty and carries no {ROOT_MARKER}" >&2
    exit 65
  fi
fi

manage_user={1 if manage_user else 0}
user_created=0
if [ "$manage_user" -eq 1 ]; then
  if ! getent group "$run_user" >/dev/null 2>&1; then
    groupadd --system "$run_user"
  fi
  if id -u "$run_user" >/dev/null 2>&1; then
    user_created=0
  else
    useradd --system --gid "$run_user" --no-create-home --shell /usr/sbin/nologin "$run_user"
    user_created=1
  fi
else
  id -u "$run_user" >/dev/null 2>&1 || {{
    echo "galadon: manage_user is false but $run_user does not exist" >&2
    exit 66
  }}
fi
install -d -m 0755 "$root"
install -d -m 0755 -o "$run_user" -g "$run_user" "$root/releases" "$root/shared"
printf '%s\\n' "$marker" > "$root/{ROOT_MARKER}"
chmod 0644 "$root/{ROOT_MARKER}"

unit_tmp=$(mktemp)
cat > "$unit_tmp" <<'GALADON_UNIT'
{unit}GALADON_UNIT
if [ -f "$unit_path" ] && cmp -s "$unit_tmp" "$unit_path"; then
  unit_changed=0
else
  install -m 0644 "$unit_tmp" "$unit_path"
  unit_changed=1
fi
rm -f "$unit_tmp"
if [ "$unit_changed" -eq 1 ]; then
  systemctl daemon-reload
fi
systemctl enable "$service" >/dev/null
if [ -L "$root/current" ]; then
  if [ "$unit_changed" -eq 1 ]; then
    systemctl restart "$service"
  else
    systemctl start "$service"
  fi
fi

caddyfile=/etc/caddy/Caddyfile
block_file=$(mktemp)
cat > "$block_file" <<'GALADON_CADDY_BLOCK'
{block}GALADON_CADDY_BLOCK
begin="# galadon:begin $marker"
end="# galadon:end $marker"
new_file=$(mktemp)
has_begin=0
has_end=0
if [ -f "$caddyfile" ]; then
  if grep -Fqx "$begin" "$caddyfile"; then has_begin=1; fi
  if grep -Fqx "$end" "$caddyfile"; then has_end=1; fi
fi
if [ "$has_begin" -ne "$has_end" ]; then
  echo "galadon: incomplete Caddy marker block for $marker" >&2
  exit 65
fi
if [ -f "$caddyfile" ] && [ "$has_begin" -eq 1 ]; then
  awk -v begin="$begin" -v end="$end" -v blockfile="$block_file" '
    BEGIN {{ while ((getline line < blockfile) > 0) block = block line "\\n" }}
    $0 == begin {{ printf "%s", block; skip=1; next }}
    skip == 1 && $0 == end {{ skip=0; next }}
    skip == 1 {{ next }}
    {{ print }}
  ' "$caddyfile" > "$new_file"
elif [ -f "$caddyfile" ]; then
  cp "$caddyfile" "$new_file"
  printf '\\n' >> "$new_file"
  cat "$block_file" >> "$new_file"
else
  : > "$new_file"
  cat "$block_file" >> "$new_file"
fi

backup=""
caddy_changed=0
if [ -f "$caddyfile" ] && cmp -s "$new_file" "$caddyfile"; then
  caddy_changed=0
else
  if [ -f "$caddyfile" ]; then
    backup="$caddyfile.galadon-bak.$(date -u +%Y%m%dT%H%M%SZ).$$"
    cp -p "$caddyfile" "$backup"
  fi
  if [ -f "$caddyfile" ]; then
    cat "$new_file" > "$caddyfile"
  else
    install -m 0644 "$new_file" "$caddyfile"
  fi
  if ! caddy validate --config "$caddyfile" --adapter caddyfile; then
    if [ -n "$backup" ]; then
      cp -p "$backup" "$caddyfile"
    else
      rm -f "$caddyfile"
    fi
    rm -f "$block_file" "$new_file"
    echo "galadon: caddy validate failed; previous config restored and caddy was not reloaded" >&2
    exit 1
  fi
  if ! systemctl reload caddy; then
    if [ -n "$backup" ]; then
      cp -p "$backup" "$caddyfile"
      if ! systemctl reload caddy; then
        echo "galadon: previous Caddyfile restored but caddy reload still failed" >&2
      fi
    else
      rm -f "$caddyfile"
    fi
    rm -f "$block_file" "$new_file"
    exit 1
  fi
  caddy_changed=1
fi
rm -f "$block_file" "$new_file"

printf 'GALADON_USER_CREATED=%s\\n' "$user_created"
printf 'GALADON_UNIT_CHANGED=%s\\n' "$unit_changed"
printf 'GALADON_CADDY_CHANGED=%s\\n' "$caddy_changed"
printf 'GALADON_CADDY_BACKUP=%s\\n' "$backup"
printf 'GALADON_OK=1\\n'
"""


def teardown_script(
    root: str, service: str, marker: str, unit_path: str, run_user: str, manage_user: bool
) -> str:
    return f"""set -euo pipefail
{REMOTE_PATH}
root={quote(root)}
service={quote(service)}
marker={quote(marker)}
unit_path={quote(unit_path)}
run_user={quote(run_user)}
manage_user={1 if manage_user else 0}

marker_file="$root/{ROOT_MARKER}"
if [ ! -f "$marker_file" ]; then
  echo "galadon: refusing to remove $root: $marker_file is missing" >&2
  exit 65
fi
if [ "$(cat "$marker_file")" != "$marker" ]; then
  echo "galadon: refusing to remove $root: marker file does not match $marker" >&2
  exit 65
fi

service_removed=0
if [ -f "$unit_path" ]; then
  systemctl disable --now "$service"
  rm -f "$unit_path"
  systemctl daemon-reload
  service_removed=1
fi

caddyfile=/etc/caddy/Caddyfile
begin="# galadon:begin $marker"
end="# galadon:end $marker"
backup=""
caddy_changed=0
has_begin=0
has_end=0
if [ -f "$caddyfile" ]; then
  if grep -Fqx "$begin" "$caddyfile"; then has_begin=1; fi
  if grep -Fqx "$end" "$caddyfile"; then has_end=1; fi
fi
if [ "$has_begin" -ne "$has_end" ]; then
  echo "galadon: incomplete Caddy marker block for $marker" >&2
  exit 65
fi
if [ "$has_begin" -eq 1 ]; then
  new_file=$(mktemp)
  awk -v begin="$begin" -v end="$end" '
    $0 == begin {{ skip=1; next }}
    skip == 1 && $0 == end {{ skip=0; next }}
    skip == 1 {{ next }}
    {{ print }}
  ' "$caddyfile" > "$new_file"
  backup="$caddyfile.galadon-bak.$(date -u +%Y%m%dT%H%M%SZ).$$"
  cp -p "$caddyfile" "$backup"
  cat "$new_file" > "$caddyfile"
  rm -f "$new_file"
  if ! caddy validate --config "$caddyfile" --adapter caddyfile; then
    cp -p "$backup" "$caddyfile"
    echo "galadon: caddy validate failed; previous config restored and caddy was not reloaded" >&2
    exit 1
  fi
  if ! systemctl reload caddy; then
    cp -p "$backup" "$caddyfile"
    if ! systemctl reload caddy; then
      echo "galadon: previous Caddyfile restored but caddy reload still failed" >&2
    fi
    exit 1
  fi
  caddy_changed=1
fi

rm -rf "$root"
user_removed=0
user_skipped=""
if [ "$manage_user" -eq 1 ] && id -u "$run_user" >/dev/null 2>&1; then
  if userdel "$run_user" 2>/dev/null; then
    user_removed=1
  elif pgrep -u "$run_user" >/dev/null 2>&1; then
    user_skipped="still in use by another service"
    echo "galadon: left $run_user in place: still in use by another service" >&2
  else
    echo "galadon: could not remove system user $run_user" >&2
    exit 1
  fi
fi
printf 'GALADON_SERVICE_REMOVED=%s\\n' "$service_removed"
printf 'GALADON_CADDY_CHANGED=%s\\n' "$caddy_changed"
printf 'GALADON_CADDY_BACKUP=%s\\n' "$backup"
printf 'GALADON_ROOT_REMOVED=1\\n'
printf 'GALADON_USER_REMOVED=%s\\n' "$user_removed"
printf 'GALADON_USER_SKIPPED=%s\\n' "$user_skipped"
printf 'GALADON_OK=1\\n'
"""
