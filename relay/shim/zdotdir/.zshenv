# Bismuth terminal: ZDOTDIR is pointed here so we can shadow `claude` after the user's
# rc loads. Load the user's real .zshenv first so nothing in their env is lost.
[[ -f "$HOME/.zshenv" ]] && source "$HOME/.zshenv"
# Pin history to the user's home so zsh never tries to lock a history file inside the
# read-only app bundle (ZDOTDIR points here transiently). Only set if not already chosen.
: "${HISTFILE:=$HOME/.zsh_history}"
export HISTFILE
