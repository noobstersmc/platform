#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

host="${MC_CONTROL_HOST:-127.0.0.1}"
port="${MC_CONTROL_PORT:-30077}"
token="${MC_CONTROL_TOKEN:-}"
base_url="http://${host}:${port}"

auth_args=()
if [[ -n "${token}" ]]; then
  auth_args=(-H "Authorization: Bearer ${token}")
fi

usage() {
  cat <<'TXT'
Usage:
  ./mc-botctl.sh status
  ./mc-botctl.sh goal [new goal text]
  ./mc-botctl.sh autonomy
  ./mc-botctl.sh autonomy-start
  ./mc-botctl.sh autonomy-stop
  ./mc-botctl.sh memory [limit]
  ./mc-botctl.sh send <command>
  ./mc-botctl.sh action <name> [payload_json]
  ./mc-botctl.sh observe
  ./mc-botctl.sh reconnect
  ./mc-botctl.sh quit
TXT
}

request() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local response
  local code

  if [[ -n "${data}" ]]; then
    response="$(curl -sS -w $'\n%{http_code}' -X "${method}" "${auth_args[@]}" --data-binary "${data}" "${base_url}${path}")"
  else
    response="$(curl -sS -w $'\n%{http_code}' -X "${method}" "${auth_args[@]}" "${base_url}${path}")"
  fi

  code="${response##*$'\n'}"
  printf '%s\n' "${response%$'\n'*}"

  if [[ "${code}" -lt 200 || "${code}" -ge 300 ]]; then
    exit 1
  fi
}

cmd="${1:-}"
case "${cmd}" in
  status)
    request GET /status
    ;;
  goal)
    shift
    if [[ $# -eq 0 ]]; then
      request GET /goal
    else
      escaped_goal="${*//\"/\\\"}"
      request POST /goal "{\"goal\":\"${escaped_goal}\"}"
    fi
    ;;
  autonomy)
    request GET /autonomy
    ;;
  autonomy-start)
    request POST /autonomy/start
    ;;
  autonomy-stop)
    request POST /autonomy/stop
    ;;
  memory)
    limit="${2:-50}"
    request GET "/memory?limit=${limit}"
    ;;
  send)
    shift
    if [[ $# -eq 0 ]]; then
      echo "Missing command for 'send'" >&2
      usage >&2
      exit 1
    fi
    request POST /command "$*"
    ;;
  action)
    action_name="${2:-}"
    if [[ -z "${action_name}" ]]; then
      echo "Missing action name" >&2
      usage >&2
      exit 1
    fi
    if [[ $# -ge 3 ]]; then
      payload="${3}"
      request POST /action "{\"action\":\"${action_name}\",\"payload\":${payload}}"
    else
      request POST /action "{\"action\":\"${action_name}\"}"
    fi
    ;;
  observe)
    request POST /action '{"action":"observe"}'
    ;;
  reconnect)
    request POST /reconnect
    ;;
  quit)
    request POST /quit
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
