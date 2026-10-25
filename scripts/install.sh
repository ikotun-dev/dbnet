#!/bin/sh
set -eu

repository_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
install_dir=${DBNET_INSTALL_DIR:-"${HOME}/.local/bin"}

cd "$repository_dir"
npm ci
npm run build:cli
mkdir -p "$install_dir"
install -m 0755 bin/dbnet "$install_dir/dbnet"

printf 'Installed DBNet at %s\n' "$install_dir/dbnet"
printf 'Run: dbnet run\n'
