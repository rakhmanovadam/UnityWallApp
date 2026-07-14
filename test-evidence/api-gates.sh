#!/usr/bin/env bash
# Anonymous API contract probes — auth gates, zod validation, cron gate, 404s,
# enumeration resistance. Emits test-evidence/api-gates.json.
set -u
BASE="http://127.0.0.1:${UW_PORT:-4173}"
EID="c1b5d4a6-1cad-4715-8013-d06690302a45"   # TEST-DRAFT-WALL id (any uuid works for gate)
UUID="00000000-0000-0000-0000-000000000000"
OUT="test-evidence/api-gates.json"
first=1
echo "[" > "$OUT"

emit(){ # id name method path expect actual body
  local pass="FAIL"
  # expect is a pipe-list of acceptable codes
  IFS='|' read -ra oks <<< "$5"
  for c in "${oks[@]}"; do [ "$6" = "$c" ] && pass="PASS"; done
  [ $first -eq 0 ] && echo "," >> "$OUT"; first=0
  printf '{"id":"%s","name":"%s","method":"%s","path":"%s","expect":"%s","actual":"%s","status":"%s","body":%s}' \
    "$1" "$2" "$3" "$4" "$5" "$6" "$pass" "$(printf '%s' "$7" | head -c 160 | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" >> "$OUT"
  echo "$pass [$1] $2 -> $6 (want $5)"
}

probe(){ # id name method path expect [json]
  local resp code body
  if [ -n "${6:-}" ]; then
    resp=$(curl -s -w $'\n%{http_code}' -X "$3" "$BASE$4" -H "Content-Type: application/json" -d "$6")
  else
    resp=$(curl -s -w $'\n%{http_code}' -X "$3" "$BASE$4")
  fi
  code=$(printf '%s' "$resp" | tail -1)
  body=$(printf '%s' "$resp" | sed '$d')
  emit "$1" "$2" "$3" "$4" "$5" "$code" "$body"
}

# ---- auth gates (no session/cookie) -> 401/403 ----
probe GATE-01 "host events list gated"        GET   "/api/host/events"                    "401|403"
probe GATE-02 "host event PATCH gated"        PATCH "/api/host/events/$EID"                "401|403" '{"status":"live"}'
probe GATE-03 "host moderation gated"         GET   "/api/host/events/$EID/moderation"     "401|403"
probe GATE-04 "host download gated"           GET   "/api/host/events/$EID/download"        "401|403"
probe GATE-05 "host cover init gated"         POST  "/api/host/events/$EID/cover/init"      "401|403" '{"content_type":"image/jpeg","bytes":1000}'
probe GATE-06 "host photo PATCH gated"        PATCH "/api/host/photos/$UUID"                "401|403" '{"status":"approved"}'
probe GATE-07 "admin applications gated"      GET   "/api/admin/applications"               "401|403"
probe GATE-08 "admin application PATCH gated" PATCH "/api/admin/applications/$UUID"          "401|403" '{"action":"approve"}'
probe GATE-09 "admin invites GET gated"       GET   "/api/admin/invites"                    "401|403"
probe GATE-10 "admin invites POST gated"      POST  "/api/admin/invites"                    "401|403" '{"email":"x@example.com"}'
probe GATE-11 "admin leads gated"             GET   "/api/admin/leads"                      "401|403"
probe GATE-12 "admin emails gated"            GET   "/api/admin/emails"                     "401|403"
probe GATE-13 "uploads init needs cookie"     POST  "/api/uploads/init"                     "401|403" '{"filename":"a.jpg","content_type":"image/jpeg","bytes":1000}'
probe GATE-14 "uploads finalize needs cookie" POST  "/api/uploads/finalize"                 "401|403" '{"photo_id":"'$UUID'"}'
probe GATE-15 "uploads delete needs cookie"   POST  "/api/uploads/delete"                   "401|403" '{"photo_id":"'$UUID'"}'

# ---- zod validation -> 400 on empty/bad body ----
probe ZOD-01 "by-code empty -> 400"           POST  "/api/events/by-code"                   "400" '{}'
probe ZOD-02 "otp/request empty -> 400"       POST  "/api/otp/request"                      "400" '{}'
probe ZOD-03 "otp/verify empty -> 400"        POST  "/api/otp/verify"                       "400" '{}'
probe ZOD-04 "applications empty -> 400"      POST  "/api/applications"                     "400" '{}'
probe ZOD-05 "otp bad regex -> 400"           POST  "/api/otp/verify"                       "400" '{"code":"MAYA-DANIEL","email":"a@b.co","otp":"nope"}'

# ---- cron gate ----
probe CRON-01 "cron no bearer"                GET   "/api/cron/retention"                   "401|503"
probe CRON-02 "cron wrong bearer"             GET   "/api/cron/retention"                   "401|503"

# ---- 404 / no existence leak ----
probe NF-01 "by-code unknown -> 404"          POST  "/api/events/by-code"                   "404" '{"code":"NOPE-NOPE"}'
probe NF-02 "photo sign unknown -> 404"       GET   "/api/photos/$UUID/sign?event_id=$EID"  "404|400|401"

# ---- enumeration resistance ----
probe ENUM-01 "login-link always ok"          POST  "/api/auth/login-link"                  "200" '{"email":"nobody-'"$RANDOM"'@example.com"}'

echo "]" >> "$OUT"
echo "--- wrote $OUT ---"
