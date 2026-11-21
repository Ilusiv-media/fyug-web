#!/usr/bin/env bash
# The Vercel project fyug.fm's build command (see vercel.json; the project's
# root directory is landing/). Downloads the landing site's archive that
# release.txt here pins, refuses it unless its SHA-256 is the pinned one and
# its provenance.txt names the pinned build and commit, and writes the Build
# Output inside it to .vercel/output, which Vercel deploys as is, together with
# static/release.txt: the pin it verified, served at /release.txt so anyone can
# tell which build, and which commit, www.fyug.fm runs. Any failure exits
# non-zero with no .vercel/output left, so the build fails and nothing is
# deployed.
#
# The archive is the one asset of the release tagged landing-<build>. Only
# this directory is read or written: the files at the repository's root are
# the hosted server's site.
#
# RELEASE_DOWNLOAD_BASE (default https://github.com) is the download origin.
set -euo pipefail
cd "$(dirname "$0")"

base="${RELEASE_DOWNLOAD_BASE:-https://github.com}"
output=.vercel/output
rm -rf "$output"

fail() {
  echo "landing/build.sh: $*" >&2
  rm -rf "$output"
  exit 1
}

# release.txt: key=value lines; blank lines and # comments are ignored.
[ -f release.txt ] || fail "no landing/release.txt"
repository="" build="" sha256="" commit=""
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
    build) build="$value" ;;
    sha256) sha256="$value" ;;
    commit) commit="$value" ;;
    *) fail "release.txt: unknown key $key" ;;
  esac
done < release.txt
for key in repository build sha256 commit; do
  case "$seen" in *" $key "*) ;; *) fail "release.txt: $key is missing" ;; esac
done
if [ -z "$build" ] && [ -z "$sha256" ] && [ -z "$commit" ]; then
  fail "release.txt: no landing build is pinned yet; Deploy Landing Site pins one"
fi
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail "release.txt: bad repository: $repository"
[[ "$build" =~ ^[0-9a-z][0-9a-z-]{0,39}$ ]] || fail "release.txt: bad build: $build"
[[ "$sha256" =~ ^[0-9a-f]{64}$ ]] || fail "release.txt: bad sha256: $sha256"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || fail "release.txt: bad commit: $commit"

name="fyug-landing-$build.vercel.tar.xz"
url="$base/$repository/releases/download/landing-$build/$name"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "Downloading $url"
curl -fsSL --retry 3 --connect-timeout 20 --max-time 600 -o "$work/$name" "$url" || fail "could not download $url"

if command -v sha256sum >/dev/null; then
  actual="$(sha256sum "$work/$name" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$work/$name" | cut -d' ' -f1)"
fi
[ "$actual" = "$sha256" ] || fail "$name has SHA-256 $actual, but release.txt pins $sha256"

mkdir "$work/archive"
tar -xJf "$work/$name" -C "$work/archive" || fail "could not unpack $name"
[ -f "$work/archive/provenance.txt" ] || fail "$name has no provenance.txt"
grep -qxF "build=$build" "$work/archive/provenance.txt" ||
  fail "$name's provenance.txt does not name build=$build"
grep -qxF "commit=$commit" "$work/archive/provenance.txt" ||
  fail "$name's provenance.txt does not name commit=$commit"
[ -f "$work/archive/output/config.json" ] || fail "$name has no output/config.json"

mkdir -p .vercel
cp -R "$work/archive/output" "$output" || fail "could not write $output"
mkdir -p "$output/static" || fail "could not write $output/static"
printf 'repository=%s\nbuild=%s\nsha256=%s\ncommit=%s\n' "$repository" "$build" "$sha256" "$commit" \
  > "$output/static/release.txt" || fail "could not write $output/static/release.txt"
echo "Serving the Fyug landing site build $build from $commit ($sha256)"
