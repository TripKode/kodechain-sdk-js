#!/usr/bin/env bash
# Re-publica @kodechain/sdk-ts en npm con bump automático de versión.
# Uso: npm run release[:patch|:minor|:major]   (default: patch)
# Requiere token npm en ~/.npmrc (chmod 600).
set -euo pipefail
cd "$(dirname "$0")/.."

KIND="${1:-patch}"
case "$KIND" in
  patch|minor|major) ;;
  *) echo "uso: $0 [patch|minor|major]" >&2; exit 1 ;;
esac

echo "==> 1/4 tests"
npm test -- --silent
echo "==> 2/4 build"
npm run build --silent
echo "==> 3/4 bump ($KIND)"
npm version "$KIND" --no-git-tag-version --silent
VER="$(node -p "require('./package.json').version")"
echo "==> 4/4 publish @kodechain/sdk-ts@$VER"
npm publish --access public
echo ""
echo "✅ @kodechain/sdk-ts@$VER publicado (propagación del CDN: unos minutos)"
