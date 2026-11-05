#!/bin/bash
# AWS 환경에 부하 테스트를 실행한다. Grafana 주소·비밀번호는 Infra terraform output에서 읽어 이 실행에만 넘긴다.
#   ./bin/aws.sh scenarios/capacity.js
#   ./bin/aws.sh -e HOLD=2m scenarios/capacity.js
set -euo pipefail

INFRA_ENV="$(cd "$(dirname "$0")/../../Infra/env" && pwd)"
GRAFANA_URL=$(terraform -chdir="$INFRA_ENV" output -raw grafana_url)
GRAFANA_PASSWORD=$(eval "$(terraform -chdir="$INFRA_ENV" output -raw grafana_password_command)")
PG_URL=$(terraform -chdir="$INFRA_ENV" output -raw pg_url)

GRAFANA_URL="$GRAFANA_URL" GRAFANA_PASSWORD="$GRAFANA_PASSWORD" \
  k6 run -e BASE_URL="$PG_URL" "$@"
