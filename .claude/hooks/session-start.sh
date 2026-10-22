#!/usr/bin/env bash
# SessionStart hook (.claude/settings.json). Cloud sessions only (CLAUDE_CODE_REMOTE=true): installs the .NET SDK pinned by
# backend/global.json into ~/.dotnet, exposes it to the session through CLAUDE_ENV_FILE, restores the backend and installs
# the front's packages. Every step is skipped when already done, so a resumed session pays almost nothing.
# Never fails the session: a blocked network prints one line naming the domains to allow, and the hook exits 0.
# Details go to ~/.cache/protocoloapp/session-start.log.

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

set -u

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cache="$HOME/.cache/protocoloapp"
log="$cache/session-start.log"
mkdir -p "$cache"
: > "$log"

dotnet_root="$HOME/.dotnet"
dotnet_domains="dot.net, builds.dotnet.microsoft.com, ci.dot.net, api.nuget.org"
npm_domains="registry.npmjs.org"
problems=()

# Runs a step with its output in the log; returns the step's exit code.
step() {
  local name="$1"
  shift
  echo "== $name" >> "$log"
  "$@" >> "$log" 2>&1
}

# True when the hashes saved in $1 still match the listed files (the work they stamp is up to date).
stamp_ok() {
  local stamp="$1"
  shift
  [ -f "$stamp" ] && (cd "$root" && sha256sum "$@" 2>/dev/null) | cmp -s - "$stamp"
}

stamp_save() {
  local stamp="$1"
  shift
  (cd "$root" && sha256sum "$@") > "$stamp" 2>/dev/null || rm -f "$stamp"
}

# The SDK answers `dotnet --version` from backend/ only when it satisfies global.json.
sdk_ready() {
  [ -x "$dotnet_root/dotnet" ] && (cd "$root/backend" && DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 "$dotnet_root/dotnet" --version) > /dev/null 2>&1
}

install_sdk() {
  local script="$cache/dotnet-install.sh"
  # dot.net redirects to builds.dotnet.microsoft.com; the script then downloads from builds.dotnet.microsoft.com
  # (ci.dot.net as fallback). --jsonfile pins the exact version, so aka.ms is not needed.
  step "download dotnet-install.sh" curl -fsSL --retry 2 --max-time 60 -o "$script" https://dot.net/v1/dotnet-install.sh || return 1
  step "dotnet-install.sh" timeout 420 bash "$script" --jsonfile "$root/backend/global.json" --install-dir "$dotnet_root" --no-path
}

# --- .NET SDK ------------------------------------------------------------------------------------------------------------
if ! sdk_ready; then
  if ! install_sdk || ! sdk_ready; then
    problems+=(".NET SDK not installed (allow: $dotnet_domains)")
  fi
fi

if sdk_ready; then
  export DOTNET_ROOT="$dotnet_root" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
  export PATH="$dotnet_root:$dotnet_root/tools:$PATH"
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    {
      echo "export DOTNET_ROOT=\"$dotnet_root\""
      echo 'export DOTNET_CLI_TELEMETRY_OPTOUT=1'
      echo 'export DOTNET_NOLOGO=1'
      echo 'export DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1'
      echo "export PATH=\"$dotnet_root:$dotnet_root/tools:\$PATH\""
    } >> "$CLAUDE_ENV_FILE"
  fi

  # Restore (packages + dotnet-ef) only when a project, the central versions or the tool manifest changed.
  mapfile -t restore_inputs < <(cd "$root" && { ls backend/global.json backend/Directory.Packages.props backend/Directory.Build.props backend/ProtocoloApp.slnx backend/.config/dotnet-tools.json; find backend/src backend/tests -name '*.csproj'; } 2>/dev/null | sort)
  restore_stamp="$cache/backend-restore.sha256"
  if ! stamp_ok "$restore_stamp" "${restore_inputs[@]}" || [ ! -f "$root/backend/src/ProtocoloApp.Api/obj/project.assets.json" ]; then
    rm -f "$restore_stamp"
    if (cd "$root/backend" && step "dotnet restore" timeout 300 dotnet restore ProtocoloApp.slnx && step "dotnet tool restore" timeout 120 dotnet tool restore); then
      stamp_save "$restore_stamp" "${restore_inputs[@]}"
    else
      problems+=("dotnet restore failed (allow: api.nuget.org)")
    fi
  fi
fi

# --- Front packages ------------------------------------------------------------------------------------------------------
npm_stamp="$root/frontend/node_modules/.session-start.sha256"
if [ -f "$root/frontend/package-lock.json" ] && ! stamp_ok "$npm_stamp" frontend/package.json frontend/package-lock.json; then
  if (cd "$root/frontend" && step "npm ci" timeout 300 npm ci --no-fund --no-audit); then
    stamp_save "$npm_stamp" frontend/package.json frontend/package-lock.json
  else
    problems+=("npm ci failed (allow: $npm_domains)")
  fi
fi

# --- Report (stdout reaches Claude's context) ----------------------------------------------------------------------------
if [ ${#problems[@]} -eq 0 ]; then
  if sdk_ready; then
    echo "session-start: .NET SDK $(cd "$root/backend" && dotnet --version) ready (unit tests: cd backend && dotnet test tests/ProtocoloApp.UnitTests; integration tests need Docker/Testcontainers and run in CI)."
  fi
else
  summary="$(printf '%s; ' "${problems[@]}")"
  echo "session-start: ${summary%; }. Details: $log"
fi
exit 0
