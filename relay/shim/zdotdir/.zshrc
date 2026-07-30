# Bismuth terminal zsh init. Loads the user's real config, then defines one shell function per
# agent-CLI backend described in BISMUTH_SHIM_SPECS (core/src/terminal.ts shimSpecsFor) — e.g. a
# bare `claude` in an app terminal transparently loads the agent-graph relay plugin, and a
# "wrapper"-mode backend (when enabled) transparently reports its session to the relay. A function
# shadows PATH lookup, so this survives a .zshrc that re-prepends PATH (which a plain PATH shim
# can't). Restore ZDOTDIR first so the user's own config and any nested shells behave normally.
_bismuth_shim_zdotdir="$ZDOTDIR"
export ZDOTDIR="$HOME"
# Repair HISTFILE: macOS's /etc/zshrc — sourced for interactive shells just BEFORE this
# file, while ZDOTDIR still pointed at our transient shim dir — unconditionally runs
# `HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history`, routing history (and so zsh-autosuggestions'
# history-based suggestions) into the shim dir instead of the user's real ~/.zsh_history.
# That made history — and suggestions — vanish between sessions. Undo it (only when it
# actually landed in the shim dir) so the embedded terminal persists history like a normal
# one. Done BEFORE sourcing ~/.zshrc so an explicit user HISTFILE there still wins.
[[ "$HISTFILE" == "$_bismuth_shim_zdotdir"/* ]] && HISTFILE="$HOME/.zsh_history"
unset _bismuth_shim_zdotdir
[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"
# Define one shell function per BISMUTH_SHIM_SPECS entry (core/src/terminal.ts shimSpecsFor +
# serializeShimSpecs — SHIM_FIELD_SEP/SHIM_RECORD_SEP are the ASCII Unit/Record Separators, chosen
# because they never legitimately appear in a filesystem path and zsh's `(ps:...:)` split flag
# parses them with zero jq/python dependency).
#
# Per entry: prefer the path core pre-resolved; otherwise resolve it from the now-rc-loaded PATH
# (`whence -p` = the real binary, ignoring any alias/function of the same name) — the fallback
# `claude` always relied on, generalized to every entry, so relay attaches even when the bundled
# sidecar's minimal PATH couldn't find a given binary. A backend that resolves NOWHERE gets no
# function at all. `command "$path"` (or `command bun run …`) can't recurse into the function
# being defined, so there's no infinite loop.
if [[ -n "$BISMUTH_RELAY_PLUGIN" && -n "$BISMUTH_SHIM_SPECS" ]]; then
  local __bismuth_rec __bismuth_id __bismuth_bin __bismuth_path __bismuth_mode
  local -a __bismuth_fields
  for __bismuth_rec in "${(@ps:\x1e:)BISMUTH_SHIM_SPECS}"; do
    [[ -z "$__bismuth_rec" ]] && continue
    __bismuth_fields=("${(@ps:\x1f:)__bismuth_rec}")
    __bismuth_id="${__bismuth_fields[1]}"
    __bismuth_bin="${__bismuth_fields[2]}"
    __bismuth_path="${__bismuth_fields[3]}"
    __bismuth_mode="${__bismuth_fields[4]}"
    [[ -z "$__bismuth_path" ]] && __bismuth_path="$(whence -p "$__bismuth_bin" 2>/dev/null)"
    # Never define a function for a binary that resolved nowhere — nothing to wrap.
    [[ -z "$__bismuth_path" ]] && continue
    if [[ "$__bismuth_mode" == "hooks" ]]; then
      eval "${__bismuth_bin}() { command \"$__bismuth_path\" --plugin-dir \"\$BISMUTH_RELAY_PLUGIN\" \"\$@\"; }"
    elif [[ "$__bismuth_mode" == "wrapper" ]]; then
      eval "${__bismuth_bin}() { command bun run \"\$BISMUTH_RELAY_PLUGIN/bin/wrap.ts\" \"$__bismuth_id\" \"$__bismuth_path\" \"\$@\"; }"
    fi
  done
  unset __bismuth_rec __bismuth_id __bismuth_bin __bismuth_path __bismuth_mode __bismuth_fields
fi
