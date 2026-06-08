# Bismuth terminal zsh init. Loads the user's real config, then defines a `claude`
# function so a bare `claude` in an app terminal transparently loads the agent-graph
# relay plugin. A function shadows PATH lookup, so this survives a .zshrc that re-prepends
# PATH (which a plain PATH shim can't). Restore ZDOTDIR first so the user's own config and
# any nested shells behave normally.
export ZDOTDIR="$HOME"
[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"
# Prefer the binary the core process resolved ($BISMUTH_REAL_CLAUDE); otherwise resolve it
# from the now-rc-loaded PATH (`whence -p` = the real binary, ignoring any alias/function),
# so relay attaches even when the bundled sidecar's minimal PATH couldn't find claude.
# `command "$...path"` can't recurse into the function, so there's no infinite loop.
if [[ -n "$BISMUTH_RELAY_PLUGIN" ]]; then
  [[ -z "$BISMUTH_REAL_CLAUDE" ]] && BISMUTH_REAL_CLAUDE="$(whence -p claude 2>/dev/null)"
  if [[ -n "$BISMUTH_REAL_CLAUDE" ]]; then
    claude() { command "$BISMUTH_REAL_CLAUDE" --plugin-dir "$BISMUTH_RELAY_PLUGIN" "$@"; }
  fi
fi
