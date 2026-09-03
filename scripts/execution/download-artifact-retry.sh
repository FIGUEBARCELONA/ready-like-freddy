#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  download-artifact-retry.sh --name <artifact-name> --dest <directory>
  download-artifact-retry.sh --pattern <glob> --dest <directory>

Environment:
  GITHUB_RUN_ID       Workflow run containing the artifact(s)
  GITHUB_REPOSITORY   owner/repository
  GH_TOKEN            GitHub token with actions:read
  RLF_ARTIFACT_DOWNLOAD_ATTEMPTS  Optional, default 5
USAGE
  exit 64
}

artifact_name=""
artifact_pattern=""
destination=""

while (($#)); do
  case "$1" in
    --name)
      [[ $# -ge 2 ]] || usage
      artifact_name="$2"
      shift 2
      ;;
    --pattern)
      [[ $# -ge 2 ]] || usage
      artifact_pattern="$2"
      shift 2
      ;;
    --dest)
      [[ $# -ge 2 ]] || usage
      destination="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      ;;
  esac
done

[[ -n "${GITHUB_RUN_ID:-}" ]] || { echo "GITHUB_RUN_ID is required" >&2; exit 64; }
[[ -n "${GITHUB_REPOSITORY:-}" ]] || { echo "GITHUB_REPOSITORY is required" >&2; exit 64; }
[[ -n "${GH_TOKEN:-}" ]] || { echo "GH_TOKEN is required" >&2; exit 64; }
[[ -n "$destination" ]] || usage

if [[ -n "$artifact_name" && -n "$artifact_pattern" ]]; then
  echo "Use exactly one of --name or --pattern" >&2
  exit 64
fi
[[ -n "$artifact_name" || -n "$artifact_pattern" ]] || usage

attempts="${RLF_ARTIFACT_DOWNLOAD_ATTEMPTS:-5}"
[[ "$attempts" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid attempt count: $attempts" >&2; exit 64; }

parent="$(dirname "$destination")"
base="$(basename "$destination")"
mkdir -p "$parent"

for ((attempt = 1; attempt <= attempts; attempt++)); do
  staging="${parent}/.${base}.download-${GITHUB_RUN_ID}-${attempt}-$$"
  rm -rf "$staging"
  mkdir -p "$staging"

  echo "Artifact download attempt ${attempt}/${attempts}: run=${GITHUB_RUN_ID} repo=${GITHUB_REPOSITORY}" >&2
  set +e
  if [[ -n "$artifact_name" ]]; then
    gh run download "$GITHUB_RUN_ID" \
      --repo "$GITHUB_REPOSITORY" \
      --name "$artifact_name" \
      --dir "$staging"
  else
    gh run download "$GITHUB_RUN_ID" \
      --repo "$GITHUB_REPOSITORY" \
      --pattern "$artifact_pattern" \
      --dir "$staging"
  fi
  status=$?
  set -e

  if [[ $status -eq 0 ]] && find "$staging" -type f -print -quit | grep -q .; then
    rm -rf "$destination"
    mv "$staging" "$destination"
    echo "Artifact download completed on attempt ${attempt}" >&2
    exit 0
  fi

  rm -rf "$staging"
  if ((attempt < attempts)); then
    delay=$((attempt * attempt * 3))
    echo "Artifact download failed; retrying in ${delay}s" >&2
    sleep "$delay"
  fi
done

echo "Artifact download failed after ${attempts} attempts" >&2
exit 1
