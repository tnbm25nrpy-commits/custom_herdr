#!/usr/bin/env bash
# sec-scan.sh - deterministic pre-review security scan: secrets (gitleaks) + vulnerable deps (osv-scanner).
# Scans only what changed, so the reviewer gets a short, relevant report.
#
# Usage: sec-scan.sh [-C DIR] [-b BASE] [-a] [-o REPORT] [FILE...]
#   -C DIR     project dir (default: cwd)
#   -b BASE    git ref to diff against (default: HEAD = uncommitted + untracked changes).
#              If the implementer commits, pass the commit recorded before it started.
#   -a         scan the whole dir instead of the changed files
#   -o REPORT  write the report there (default: stdout)
#   FILE...    explicit files (relative to DIR); overrides git detection
# Non-git dir without FILEs: whole dir.
# Exit: 0 clean, 1 findings, 2 a scanner failed (and nothing found).
set -u

DIR=. BASE=HEAD ALL=0 OUT=
while getopts "C:b:ao:h" opt; do
  case $opt in
    C) DIR=$OPTARG ;; b) BASE=$OPTARG ;; a) ALL=1 ;; o) OUT=$OPTARG ;;
    *) sed -n 2,14p "$0"; exit 2 ;;
  esac
done
shift $((OPTIND - 1))
[ -n "$OUT" ] && case $OUT in /*|[A-Za-z]:*) ;; *) OUT=$PWD/$OUT ;; esac
cd "$DIR" || { echo "sec-scan: cannot cd to $DIR" >&2; exit 2; }

find_tool() {
  command -v "$1" 2>/dev/null && return
  ls "$HOME"/AppData/Local/Microsoft/WinGet/Packages/*/"$1".exe 2>/dev/null | head -1
}
GITLEAKS=$(find_tool gitleaks)
OSV=$(find_tool osv-scanner)
PY=$(command -v python3 2>/dev/null || command -v python)

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
ERRORS=()

# ---- scope ----
FILES=()
if [ $# -gt 0 ]; then
  FILES=("$@"); SCOPE="$# file(s) given explicitly"
elif [ $ALL -eq 0 ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mapfile -t FILES < <( { git diff --name-only --diff-filter=ACMR "$BASE" -- ; git ls-files --others --exclude-standard; } | sort -u)
  SCOPE="${#FILES[@]} changed file(s) vs $BASE (incl. untracked)"
else
  ALL=1; SCOPE="whole dir $(pwd)"
fi

if [ $ALL -eq 0 ] && [ ${#FILES[@]} -eq 0 ]; then
  REPORT=$'SCAN: clean\nSECRETS: 0\nVULNS: 0\nSCOPE: '"$SCOPE"$'\n---\nNothing changed, nothing scanned.'
  if [ -n "$OUT" ]; then printf '%s\n' "$REPORT" > "$OUT"; else printf '%s\n' "$REPORT"; fi
  exit 0
fi

# ---- secrets: gitleaks on a staged copy of the changed files (keeps relative paths) ----
GL_JSON=$TMP/gitleaks.json
if [ -z "$GITLEAKS" ]; then
  ERRORS+=("gitleaks not found (winget install Gitleaks.Gitleaks)")
else
  if [ $ALL -eq 1 ]; then
    TARGET=.
  else
    TARGET=$TMP/stage
    for f in "${FILES[@]}"; do
      [ -f "$f" ] || continue
      mkdir -p "$TARGET/$(dirname "$f")" && cp "$f" "$TARGET/$f"
    done
    mkdir -p "$TARGET"
  fi
  if ! "$GITLEAKS" dir --no-banner --log-level error --redact -f json -r "$GL_JSON" --exit-code 0 "$TARGET" 2>"$TMP/gl.err"; then
    ERRORS+=("gitleaks failed: $(head -c 400 "$TMP/gl.err")")
  fi
fi

# ---- deps: osv-scanner on dirs whose manifest/lockfile changed ----
OSV_JSON=$TMP/osv.json
DEP_RE='(^|/)(package-lock\.json|npm-shrinkwrap\.json|package\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lock|composer\.(json|lock)|Cargo\.(toml|lock)|go\.(mod|sum)|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|Pipfile(\.lock)?|uv\.lock|Gemfile(\.lock)?|pubspec\.lock|packages\.lock\.json|[^/]*\.csproj|gradle\.lockfile|pom\.xml|mix\.lock)$'
DEP_DIRS=()
if [ $ALL -eq 1 ]; then
  DEP_DIRS=(-r .)
else
  mapfile -t DEP_DIRS < <(printf '%s\n' "${FILES[@]}" | grep -E "$DEP_RE" | xargs -r -d '\n' -n1 dirname | sort -u)
fi
OSV_NOTE="no dependency manifest or lockfile changed"
if [ ${#DEP_DIRS[@]} -gt 0 ]; then
  if [ -z "$OSV" ]; then
    ERRORS+=("osv-scanner not found (winget install Google.OSVScanner)")
  else
    "$OSV" scan source --format json --output-file "$OSV_JSON" "${DEP_DIRS[@]}" >/dev/null 2>"$TMP/osv.err"
    rc=$?
    case $rc in
      0|1) OSV_NOTE= ;;
      128) OSV_NOTE="no lockfile found to scan (deps unchecked; a manifest without lockfile can't be resolved)" ;;
      *) ERRORS+=("osv-scanner exit $rc: $(grep -v '^Scanning\|^Starting' "$TMP/osv.err" | head -c 400)") ;;
    esac
  fi
fi

# ---- report ----
STAGE_W=
[ $ALL -eq 0 ] && command -v cygpath >/dev/null && STAGE_W=$(cygpath -m "$TMP/stage")
ERR_TXT=$(printf '%s\n' "${ERRORS[@]+"${ERRORS[@]}"}")
REPORT=$("$PY" -I - "$GL_JSON" "$OSV_JSON" "$STAGE_W" "$SCOPE" "$OSV_NOTE" "$ERR_TXT" <<'PY'
import json, os, sys
gl_path, osv_path, stage, scope, osv_note, err_txt = sys.argv[1:7]
errors = [e for e in err_txt.splitlines() if e.strip()]

def load(p):
    if not os.path.isfile(p) or os.path.getsize(p) == 0:
        return None
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as e:
        errors.append(f"cannot parse {os.path.basename(p)}: {e}")
        return None

def rel(f):
    f = f.replace("\\", "/")
    s = stage.replace("\\", "/").rstrip("/")
    if s and f.lower().startswith(s.lower() + "/"):
        f = f[len(s) + 1:]
    return f[2:] if f.startswith("./") else f

secrets = []
for x in load(gl_path) or []:
    secrets.append(f"- {rel(x.get('File', '?'))}:{x.get('StartLine', '?')}  {x.get('RuleID', '?')}  {x.get('Description', '')}")

vulns = []
for res in (load(osv_path) or {}).get("results", []):
    src = rel(res.get("source", {}).get("path", "?"))
    try:
        src = os.path.relpath(src).replace("\\", "/")
    except ValueError:
        pass
    for pkg in res.get("packages", []):
        p = pkg.get("package", {})
        sev = {}
        for g in pkg.get("groups", []):
            for i in g.get("ids", []):
                sev[i] = g.get("max_severity", "")
        for v in pkg.get("vulnerabilities", []):
            vid = v.get("id", "?")
            s = f" [CVSS {sev[vid]}]" if sev.get(vid) else ""
            summary = (v.get("summary") or "").strip()
            vulns.append(f"- {src}: {p.get('name')}@{p.get('version')} ({p.get('ecosystem')}) {vid}{s} {summary}".rstrip())

status = "findings" if secrets or vulns else ("error" if errors else "clean")
out = [f"SCAN: {status}", f"SECRETS: {len(secrets)}", f"VULNS: {len(vulns)}", f"SCOPE: {scope}", "---",
       "Scanner hits are leads, not verdicts: confirm or dismiss each one in the code.", "",
       "## Secrets (gitleaks, redacted)"] + (secrets or ["none"])
out += ["", "## Vulnerable dependencies (osv-scanner)"] + (vulns or [osv_note or "none"])
if errors:
    out += ["", "## Scanner errors"] + [f"- {e}" for e in errors]
print("\n".join(out))
PY
)
[ -n "$REPORT" ] || { REPORT="SCAN: error"$'\n'"report generation failed"; }
if [ -n "$OUT" ]; then printf '%s\n' "$REPORT" > "$OUT"; else printf '%s\n' "$REPORT"; fi

case $(printf '%s\n' "$REPORT" | head -1) in
  "SCAN: findings") exit 1 ;; "SCAN: error") exit 2 ;; *) exit 0 ;;
esac
