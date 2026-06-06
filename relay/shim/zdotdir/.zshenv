# Bismuth terminal: ZDOTDIR is pointed here so we can shadow `claude` after the user's
# rc loads. Load the user's real .zshenv first so nothing in their env is lost.
[[ -f "$HOME/.zshenv" ]] && source "$HOME/.zshenv"
