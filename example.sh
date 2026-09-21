#!/usr/bin/env bash
set -euo pipefail
DB="${1:-./demo-pos.db}"
pos-native init --db "$DB"
pos-native add-entity --db "$DB" --type project --name "Synthetic demo project"
pos-native list-entities --db "$DB"
pos-native audit --db "$DB"
