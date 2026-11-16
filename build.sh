#!/usr/bin/env bash
# Vercel's build command (see vercel.json). Downloads the hosted MCP server's
# archive that release.txt pins, refuses it unless its SHA-256 is the pinned
# one, and writes the Build Output inside it to .vercel/output, which Vercel
# deploys as is. Any failure exits non-zero with no .vercel/output left, so the
# build fails and nothing is deployed.
#
# RELEASE_DOWNLOAD_BASE (default https://github.com) is the download origin.
set -euo pipefail
cd "$(dirname "$0")"

base="${RELEASE_DOWNLOAD_BASE:-https://github.com}"
output=.vercel/output
rm -rf "$output"

fail() {
  echo "build.sh: $*" >&2
  rm -rf "$output"
  exit 1
}

# release.txt: key=value lines; blank lines and # comments are ignored.
repository="" version="" sha256=""
seen=" "
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  case "$line" in "" | "#"*) continue ;; esac
  case "$line" in *=*) ;; *) fail "release.txt: not key=value: $line" ;; esac
  key="${line%%=*}" value="${line#*=}"
  case "$seen" in *" $key "*) fail "release.txt: $key is set twice" ;; esac
  seen="$seen$key "
  case "$key" in
    repository) repository="$value" ;;
    version) version="$value" ;;
    sha256) sha256="$value" ;;
    *) fail "release.txt: unknown key $key" ;;
  esac
done < release.txt
for key in repository version sha256; do
  case "$seen" in *" $key "*) ;; *) fail "release.txt: $key is missing" ;; esac
done
if [ -z "$version" ] && [ -z "$sha256" ]; then
  fail "release.txt pins no release yet; Promote Release pins one"
fi
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "release.txt: bad repository: $repository"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "release.txt: bad version: $version"
[[ "$sha256" =~ ^[0-9a-f]{64}$ ]] || fail "release.txt: bad sha256: $sha256"

name="fyug-hosted-$version.vercel.tar.xz"
url="$base/$repository/releases/download/v$version/$name"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "Downloading $url"
curl -fsSL --retry 3 -o "$work/$name" "$url" || fail "could not download $url"

if command -v sha256sum >/dev/null; then
  actual="$(sha256sum "$work/$name" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$work/$name" | cut -d' ' -f1)"
fi
[ "$actual" = "$sha256" ] || fail "$name has SHA-256 $actual, but release.txt pins $sha256"

mkdir "$work/archive"
tar -xJf "$work/$name" -C "$work/archive" || fail "could not unpack $name"
grep -qx "product_version=$version" "$work/archive/provenance.txt" 2>/dev/null ||
  fail "$name's provenance.txt does not name product_version=$version"
[ -f "$work/archive/output/config.json" ] || fail "$name has no output/config.json"

mkdir -p .vercel
cp -R "$work/archive/output" "$output" || fail "could not write $output"
echo "Serving fyug hosted $version ($sha256)"
