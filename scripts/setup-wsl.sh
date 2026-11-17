#!/usr/bin/env bash
# One-time WSL setup for the Film Club project.
# Run it yourself in a WSL terminal (it needs your sudo password and browser logins):
#   bash ~/film-club/scripts/setup-wsl.sh
set -euo pipefail

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

step "1/6 Basic packages (unzip, Docker, gitleaks)"
sudo apt-get update
sudo apt-get install -y curl wget ca-certificates gnupg unzip docker.io
sudo apt-get install -y docker-compose-v2 || echo "(docker-compose-v2 not available; not needed)"
sudo usermod -aG docker "$USER"
# Start Docker now (WSL may not run systemd services automatically)
sudo systemctl enable --now docker 2>/dev/null || sudo service docker start || true

step "2/6 GitHub CLI (official apt repo)"
if ! command -v gh >/dev/null; then
  sudo mkdir -p -m 755 /etc/apt/keyrings
  wget -nv -O- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y gh
fi

step "3/6 Node.js LTS via nvm"
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install --lts
nvm alias default 'lts/*'

step "4/6 GitHub login (opens a browser code flow, choose HTTPS)"
gh auth status >/dev/null 2>&1 || gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git

step "4b/6 gitleaks (secret scanner, official release binary)"
if ! command -v gitleaks >/dev/null; then
  TMP="$(mktemp -d)"
  gh release download -R gitleaks/gitleaks -p '*_linux_x64.tar.gz' -D "$TMP"
  tar -xzf "$TMP"/*_linux_x64.tar.gz -C "$TMP" gitleaks
  sudo install -m 755 "$TMP/gitleaks" /usr/local/bin/gitleaks
  rm -rf "$TMP"
fi

step "5/6 Git identity for commits"
if [ -z "$(git config --global user.name || true)" ]; then
  read -rp "Name for git commits (e.g. Manel): " GIT_NAME
  git config --global user.name "$GIT_NAME"
fi
if [ -z "$(git config --global user.email || true)" ]; then
  echo "Tip: use your GitHub 'noreply' address to keep your email private"
  echo "     (GitHub > Settings > Emails, looks like 12345+manel27@users.noreply.github.com)"
  read -rp "Email for git commits: " GIT_EMAIL
  git config --global user.email "$GIT_EMAIL"
fi
git config --global init.defaultBranch main

step "6/6 Supabase CLI login (opens a browser)"
npx --yes supabase@latest login

step "Done. Versions:"
gh --version | head -1
node -v
docker --version
gitleaks version || true
echo
echo "IMPORTANT: close this terminal and open a new one (so the docker group applies),"
echo "then run:  docker run --rm hello-world"
