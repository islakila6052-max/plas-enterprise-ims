#!/usr/bin/env bash
# supabase/tests/local-stack.sh
# Start a throwaway local Supabase Postgres + GoTrue + PostgREST stack,
# apply supabase/migrations in order, and print the env vars for
# `npm run test:db`. Everything binds to 127.0.0.1 only.
#
# Usage:  bash supabase/tests/local-stack.sh        # start (or restart)
#         bash supabase/tests/local-stack.sh down   # remove the containers
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: do not rewrite /tmp paths

PG_IMAGE=public.ecr.aws/supabase/postgres:17.6.1.127
AUTH_IMAGE=public.ecr.aws/supabase/gotrue:v2.194.0
REST_IMAGE=public.ecr.aws/supabase/postgrest:v14.5
JWT_SECRET=local-test-only-jwt-secret-at-least-32-chars
# `pwd -W` gives a Windows path in Git Bash, which `docker cp` needs there.
HERE="$(cd "$(dirname "$0")" && (pwd -W 2>/dev/null || pwd))"
MIGRATIONS="$HERE/../migrations"

docker rm -f ims-test-rest ims-test-auth ims-test-pg >/dev/null 2>&1 || true
if [ "${1:-}" = "down" ]; then
  docker network rm ims-test-net >/dev/null 2>&1 || true
  echo "Local test stack removed."
  exit 0
fi

docker network inspect ims-test-net >/dev/null 2>&1 || docker network create ims-test-net >/dev/null

docker run -d --name ims-test-pg --network ims-test-net -e POSTGRES_PASSWORD=postgres \
  -p 127.0.0.1:54399:5432 "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec ims-test-pg pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 2
done
sleep 4
docker exec ims-test-pg psql -U supabase_admin -d postgres -qc \
  "alter role supabase_auth_admin with login password 'postgres'; alter role authenticator with login password 'postgres'; alter role postgres with password 'postgres';"

docker run -d --name ims-test-auth --network ims-test-net -p 127.0.0.1:54398:9999 \
  -e GOTRUE_API_HOST=0.0.0.0 -e PORT=9999 -e API_EXTERNAL_URL=http://localhost:54398 \
  -e GOTRUE_DB_DRIVER=postgres \
  -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:postgres@ims-test-pg:5432/postgres" \
  -e GOTRUE_SITE_URL=http://localhost:5173 -e GOTRUE_JWT_SECRET="$JWT_SECRET" \
  -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
  -e GOTRUE_JWT_ADMIN_ROLES=service_role -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
  -e GOTRUE_MAILER_AUTOCONFIRM=true -e GOTRUE_DISABLE_SIGNUP=false \
  "$AUTH_IMAGE" >/dev/null
for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:54398/health >/dev/null && break
  sleep 2
done

docker cp "$HERE/storage-stub.sql" ims-test-pg:/tmp/storage-stub.sql
docker exec ims-test-pg psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qf /tmp/storage-stub.sql

# Apply migrations in order. 0023 is a seed that needs a real password.
# Some older migrations fail on a blank database (audit finding S3); they are
# reported here and the run continues, as the live database was built.
failed=()
for f in $(ls "$MIGRATIONS"/0*.sql | sort); do
  name="$(basename "$f")"
  [ "$name" = "0023_seed_admin.sql" ] && continue
  docker cp "$f" ims-test-pg:/tmp/m.sql
  if ! docker exec ims-test-pg psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f /tmp/m.sql >/dev/null 2>&1; then
    failed+=("$name")
  fi
done
[ ${#failed[@]} -gt 0 ] && echo "Warning: these migrations failed on a blank database: ${failed[*]}"

docker run -d --name ims-test-rest --network ims-test-net -p 127.0.0.1:54397:3000 \
  -e PGRST_DB_URI="postgres://authenticator:postgres@ims-test-pg:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="$JWT_SECRET" \
  "$REST_IMAGE" >/dev/null
for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:54397/ >/dev/null && break
  sleep 2
done
curl -sf http://127.0.0.1:54397/ >/dev/null

cat <<EOF
Local test stack is ready. Run the tests with:

  TEST_DB_URL=postgres://postgres:postgres@127.0.0.1:54399/postgres \\
  TEST_AUTH_URL=http://127.0.0.1:54398 \\
  TEST_REST_URL=http://127.0.0.1:54397 \\
  TEST_JWT_SECRET=$JWT_SECRET \\
  npm run test:db
EOF
