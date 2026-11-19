#!/usr/bin/env bash
# Vercel's build command (see vercel.json). Downloads the hosted MCP server's
# archive that release.txt pins, refuses it unless its SHA-256 is the pinned
# one, and writes the Build Output inside it to .vercel/output, which Vercel
# deploys as is, together with static/release.txt: the pin it verified, served
# at /release.txt so anyone can tell which archive a deployment runs. Any
# failure exits non-zero with no .vercel/output left, so the build fails and
# nothing is deployed.
#
# A pin with a `build` key names a hosted-only build, published as an asset of
# the release tagged hosted-<version>-<build>; one without names a product
# release's archive, published with the release tagged v<version>.
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
[ -f release.txt ] || fail "no release.txt"
repository="" version="" sha256="" build=""
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
    build) build="$value" ;;
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

case "$seen" in
  *" build "*)
    [[ "$build" =~ ^[0-9a-z][0-9a-z-]{0,39}$ ]] || fail "release.txt: bad build: $build"
    name="fyug-hosted-$version-$build.vercel.tar.xz"
    url="$base/$repository/releases/download/hosted-$version-$build/$name"
    ;;
  *)
    name="fyug-hosted-$version.vercel.tar.xz"
    url="$base/$repository/releases/download/v$version/$name"
    ;;
esac
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
# The hosted server has its own version, which an archive records as
# hosted_version. An archive from before it did records only the product's.
[ -f "$work/archive/provenance.txt" ] || fail "$name has no provenance.txt"
if grep -q '^hosted_version=' "$work/archive/provenance.txt"; then
  recorded=hosted_version
else
  recorded=product_version
fi
grep -qxF "$recorded=$version" "$work/archive/provenance.txt" ||
  fail "$name's provenance.txt does not name $recorded=$version"
if [ -n "$build" ]; then
  grep -qxF "build=$build" "$work/archive/provenance.txt" ||
    fail "$name's provenance.txt does not name build=$build"
fi
[ -f "$work/archive/output/config.json" ] || fail "$name has no output/config.json"

mkdir -p .vercel
cp -R "$work/archive/output" "$output" || fail "could not write $output"
mkdir -p "$output/static" || fail "could not write $output/static"
{
  printf 'repository=%s\nversion=%s\nsha256=%s\n' "$repository" "$version" "$sha256"
  if [ -n "$build" ]; then printf 'build=%s\n' "$build"; fi
} > "$output/static/release.txt" || fail "could not write $output/static/release.txt"
echo "Serving fyug hosted $version${build:+ build $build} ($sha256)"
