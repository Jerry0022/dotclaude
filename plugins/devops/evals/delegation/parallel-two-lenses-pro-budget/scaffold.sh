#!/usr/bin/env bash
set -e
git init -q . 2>/dev/null || true
git checkout -q -b eval/work 2>/dev/null || git switch -q -c eval/work
cat > docker-compose.yml <<'YML'
services:
  db:
    image: postgres:15.8
    volumes: [pgdata:/var/lib/postgresql/data]
  api:
    build: .
    environment: [DATABASE_URL=postgres://app:app@db:5432/app]
volumes: { pgdata: {} }
YML
cat > README.md <<'MD'
# orders-api

Node 22 service, Postgres 15 via docker-compose, ~40 GB data, pg_partman + pg_stat_statements, nightly pg_dump. Deployed on a single VM; no managed DB.
MD
git add -A && git -c user.email=eval@local -c user.name=eval commit -qm fixtures
