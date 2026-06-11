# Bismuth terminal: ZDOTDIR points at this dir, so for a login shell zsh reads THIS
# .zprofile and would skip the user's ~/.zprofile — losing the PATH set up there
# (Homebrew `brew shellenv`, bun, nvm, …). Source it so the embedded terminal's PATH
# matches a normal login terminal. (.zshrc, read next, restores ZDOTDIR=$HOME, so
# ~/.zlogin and any nested shells resolve to the user's own files.)
[[ -f "$HOME/.zprofile" ]] && source "$HOME/.zprofile"
