#!/bin/zsh
set -eu
cd -- "${0:A:h}"
if ! command -v npm >/dev/null 2>&1; then
  print 'Node.js と npm が必要です。インストール後にもう一度開いてください。'
  read -r '?Enterで閉じる'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci
fi
npm start
open 'http://127.0.0.1:4173/'
