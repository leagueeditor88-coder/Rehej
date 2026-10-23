#!/bin/bash
# Script para publicar Sonora en GitHub (https://github.com/leagueeditor88-coder/Rehej.git)

if [ -z "$1" ]; then
    echo "Uso: ./push_to_github.sh <TU_GITHUB_TOKEN>"
    echo "Ejemplo: ./push_to_github.sh ghp_xxxxxx"
    exit 1
fi

GITHUB_TOKEN="$1"
REPO_URL="https://${GITHUB_TOKEN}@github.com/leagueeditor88-coder/Rehej.git"

echo "==> Compilando proyecto..."
npm run build || exit 1

echo "==> Sincronizando cambios con git..."
git add .
git commit -m "Update Sonora: Smart Music Metadata Parser & Web UI" || true

echo "==> Publicando en GitHub (rama main)..."
git push -u "$REPO_URL" main --force

echo "==> ¡Publicación completada con éxito en https://github.com/leagueeditor88-coder/Rehej!"
