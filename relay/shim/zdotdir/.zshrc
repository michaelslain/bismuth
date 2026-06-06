# Bismuth terminal zsh init. Loads the user's real config, then defines a `claude`
# function so a bare `claude` in an app terminal transparently loads the agent-graph
# relay plugin. A function shadows PATH lookup, so this survives a .zshrc that re-prepends
# PATH (which a plain PATH shim can't). Restore ZDOTDIR first so the user's own config and
# any nested shells behave normally.
export ZDOTDIR="$HOME"
[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc"
if [[ -n "$BISMUTH_REAL_CLAUDE" && -n "$BISMUTH_RELAY_PLUGIN" ]]; then
  claude() { command "$BISMUTH_REAL_CLAUDE" --plugin-dir "$BISMUTH_RELAY_PLUGIN" "$@"; }
fi
