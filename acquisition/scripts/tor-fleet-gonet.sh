#!/usr/bin/env bash
# tor-fleet-gonet.sh — ENABLER: massify GoNet (goazimut GOnet6) zones extraction
# on datacenter k8s pods by giving every municipality a FRESH Tor exit, so the
# goazimut reCAPTCHA-v3 never flags a shared exit IP.
#
# THE WALL (measured): goazimut/reCAPTCHA flags the Scaleway datacenter IP →
# 0 deposits from a pod on its native IP. One SHARED Tor exit across a fleet also
# gets flagged in bursts (90/90 no-zonage). PROVEN: one FRESH Tor exit for ONE
# ville deposits fine (saint-pie-de-guire, 25 zones).
#
# APPROACH (Option A + B combined): launch N independent `tor` daemons (one per
# lane, distinct SocksPort/ControlPort/DataDirectory = N independent exits), then
# per ville SIGNAL NEWNYM on that lane's ControlPort so EACH ville egresses through
# a fresh circuit/exit. Lanes run in parallel; villes within a lane run
# sequentially (one fresh exit each). No code change to zones-obscura-run.ts —
# it already reads CHROME_PROXY → chromium --proxy-server (commit 149ded0).
#
# Usage (in pod, after `apt-get install -y tor chromium`):
#   SEEDS="slug=municode,slug=municode,..." LANES=6 NAVMS=14000 DEPOSIT=1 \
#     bash acquisition/scripts/tor-fleet-gonet.sh
#
# Env:
#   SEEDS        comma/space/newline separated "slug=municode" pairs (required)
#   LANES        number of tor daemons / parallel lanes (default 6)
#   NAVMS        --nav-ms passed to the tool (default 14000)
#   DEPOSIT      1 => --deposit (S3), 0 => --no-deposit probe (default 1)
#   WAIT_BOOT    seconds to wait for each tor to bootstrap (default 75)
#   NEWNYM_WAIT  seconds to wait after NEWNYM before a ville (default 12)
#   OUTDIR       per-lane logs + per-ville report JSONs (default $ROOT/work/delegation-mass/tor-fleet-out)
set -uo pipefail

LANES="${LANES:-6}"
NAVMS="${NAVMS:-14000}"
DEPOSIT="${DEPOSIT:-1}"
WAIT_BOOT="${WAIT_BOOT:-75}"
NEWNYM_WAIT="${NEWNYM_WAIT:-12}"
SEEDS="${SEEDS:?need SEEDS=\"slug=municode,...\"}"

# Repo root: this script lives at $ROOT/acquisition/scripts/tor-fleet-gonet.sh
SELF="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SELF/../.." && pwd)"
ACQ="$ROOT/acquisition"
OUTDIR="${OUTDIR:-$ROOT/work/delegation-mass/tor-fleet-out}"
mkdir -p "$OUTDIR"

export CHROME_BIN="${CHROME_BIN:-$(command -v chromium || command -v chromium-browser || echo /usr/bin/chromium)}"
DEPFLAG="--no-deposit"; [ "$DEPOSIT" = "1" ] && DEPFLAG="--deposit"

echo "TOR-FLEET start lanes=$LANES navMs=$NAVMS deposit=$DEPOSIT chrome=$CHROME_BIN tor=$(command -v tor)"

# Normalize SEEDS → one pair per line.
printf '%s\n' "$SEEDS" | tr ', \t' '\n\n\n\n' | grep -E '^[a-z0-9-]+=[0-9]{4,5}$' > "$OUTDIR/all.seeds" || true
NPAIRS=$(wc -l < "$OUTDIR/all.seeds")
echo "TOR-FLEET pairs=$NPAIRS"
[ "$NPAIRS" -gt 0 ] || { echo "TOR-FLEET no valid pairs in SEEDS"; exit 2; }
[ "$LANES" -gt "$NPAIRS" ] && LANES="$NPAIRS"

# Talk to a tor ControlPort via bash /dev/tcp (no nc/socat dependency).
newnym() { # $1 = control port
  local cp="$1"
  exec 8<>"/dev/tcp/127.0.0.1/$cp" 2>/dev/null || return 1
  printf 'AUTHENTICATE ""\r\nSIGNAL NEWNYM\r\nQUIT\r\n' >&8
  timeout 5 cat <&8 >/dev/null 2>&1 || true
  exec 8>&- 2>/dev/null || true
  exec 8<&- 2>/dev/null || true
}
exit_ip() { # $1 = socks port -> prints check.torproject.org json (or empty)
  curl -s --max-time 18 --socks5-hostname "127.0.0.1:$1" https://check.torproject.org/api/ip 2>/dev/null
}

socks_of() { echo $((9050 + $1 * 2)); }
ctrl_of()  { echo $((9051 + $1 * 2)); }

# 1) Launch N tor daemons.
for ((i=0; i<LANES; i++)); do
  s=$(socks_of "$i"); c=$(ctrl_of "$i"); dd="/tmp/tor-lane-$i"
  rm -rf "$dd"; mkdir -p "$dd"; chmod 700 "$dd"
  cat > "/tmp/torrc-$i" <<EOF
SocksPort $s
ControlPort $c
DataDirectory $dd
CookieAuthentication 0
MaxCircuitDirtiness 10
EOF
  tor -f "/tmp/torrc-$i" > "$OUTDIR/tor-$i.log" 2>&1 &
done

# 2) Wait each tor bootstrap (exit IP via its own socks).
for ((i=0; i<LANES; i++)); do
  s=$(socks_of "$i"); ok=0
  for ((t=0; t<WAIT_BOOT; t+=3)); do
    r="$(exit_ip "$s")"
    if printf '%s' "$r" | grep -q '"IsTor":true'; then echo "[lane $i] UP socks=$s $r"; ok=1; break; fi
    sleep 3
  done
  [ "$ok" = "1" ] || echo "[lane $i] WARN tor socks=$s not confirmed up after ${WAIT_BOOT}s"
done

# 3) Round-robin seeds across lanes.
for ((i=0; i<LANES; i++)); do : > "$OUTDIR/lane-$i.seeds"; done
idx=0
while IFS= read -r pair; do
  [ -z "$pair" ] && continue
  echo "$pair" >> "$OUTDIR/lane-$((idx % LANES)).seeds"
  idx=$((idx + 1))
done < "$OUTDIR/all.seeds"

# 4) Per lane: fresh exit per ville (NEWNYM) then run the tool for that one ville.
run_lane() {
  local i="$1" s c log
  s=$(socks_of "$i"); c=$(ctrl_of "$i"); log="$OUTDIR/lane-$i.log"; : > "$log"
  while IFS= read -r pair; do
    [ -z "$pair" ] && continue
    local slug="${pair%%=*}"
    newnym "$c"; sleep "$NEWNYM_WAIT"
    local ip; ip="$(exit_ip "$s")"
    echo "=== lane $i :: $pair :: exit=$ip" >> "$log"
    ( cd "$ACQ" && CHROME_PROXY="socks5://127.0.0.1:$s" \
        timeout 220 npx tsx src/zones-obscura-run.ts --gonet "$pair" \
        --nav-ms "$NAVMS" $DEPFLAG --out "$OUTDIR/report-$slug.json" ) >> "$log" 2>&1
    echo "--- lane $i :: $pair :: rc=$?" >> "$log"
  done < "$OUTDIR/lane-$i.seeds"
}

for ((i=0; i<LANES; i++)); do run_lane "$i" & done
wait

# 5) Aggregate from the per-ville report JSONs (only real deposits count).
node -e '
const fs=require("fs"),path=require("path");
const dir=process.argv[1];
let dep=[],status={},seen=0;
for(const f of fs.readdirSync(dir)){
  if(!/^report-.*\.json$/.test(f))continue;
  try{
    const r=JSON.parse(fs.readFileSync(path.join(dir,f),"utf8"));
    seen++;
    for(const s of (r.deposited||[]))dep.push(s);
    for(const k of Object.keys(r.byStatus||{}))status[k]=(status[k]||0)+r.byStatus[k];
  }catch(e){}
}
dep=[...new Set(dep)].sort();
console.log("=== TOR-FLEET SUMMARY reports="+seen);
console.log("byStatus="+JSON.stringify(status));
console.log("deposited="+dep.length+" ["+dep.join(",")+"]");
' "$OUTDIR"
echo "TOR-FLEET done outdir=$OUTDIR"
