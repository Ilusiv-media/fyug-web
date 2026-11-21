# fyug-web

The sites Vercel deploys for Fyug, each from a pin of public built output:

- The hosted MCP server, `https://mcp.fyug.fm/mcp`: Vercel project `fyug-web`,
  from this repository's root (`build.sh`, `release.txt`, `vercel.json`).
- The landing site, `https://www.fyug.fm`: Vercel project `fyug.fm`, from
  [`landing/`](#the-landing-site).

Neither reads or changes the other's files. The rest of this section, up to
[The landing site](#the-landing-site), is the hosted server's.

It holds no server binary. `release.txt` pins one public archive of the server
and its SHA-256, in one of two forms:

- A product release: `repository=Ilusiv-media/fyug`, its `version` and the
  SHA-256 of that release's `fyug-hosted-<version>.vercel.tar.xz`.
- A hosted-only build: `repository=Ilusiv-media/fyug-web`, the hosted
  server's own `version`, its `build` id and the SHA-256 of
  `fyug-hosted-<version>-<build>.vercel.tar.xz`, an asset of this repository's
  release tagged `hosted-<version>-<build>`.

On every push, Vercel runs `bash build.sh` (see `vercel.json`). The script
downloads the pinned archive from the release, refuses it unless its SHA-256
is the pinned one, checks that the archive names the pinned version, and
writes the Vercel Build Output inside it to `.vercel/output`, which Vercel
deploys as is. Any failure fails the build, so nothing is deployed.

Every deployment also serves the pin it was built from at `/release.txt`
(for example `https://mcp.fyug.fm/release.txt`), so the archive a deployment
runs can be told apart from another build of the same version.

- A merge to `main` deploys production.
- Every other branch gets a preview at
  `https://fyug-web-git-<branch>-ilusiv.vercel.app/mcp`.

## How a release gets here

Fyug's release workflow, or its workflow that builds only the hosted server,
opens a pull request here that changes only `release.txt`, from a branch named
`hosted-<version with dashes>`, and checks that its preview answers MCP
`initialize` as the new version (and, for a hosted-only build, serves its
`release.txt`). For a production deployment it then merges the pull request
and checks the public URL the same way.

## Rollback

Revert the pin commit on `main` (the merged pull request's Revert button, then
merge the revert). Vercel builds the previous pin and serves it. Merge pin pull
requests with "Rebase and merge", as the release workflow does, so each pin
commit lands on `main` as written.

## The landing site

`landing/release.txt` pins one build of the landing site:
`repository=Ilusiv-media/fyug-web`, its `build` id, the SHA-256 of
`fyug-landing-<build>.vercel.tar.xz` (the one asset of this repository's
release tagged `landing-<build>`) and the product `commit` it was built from.
The Vercel project `fyug.fm` has `landing` as its root directory and runs
`bash build.sh` there (see `landing/vercel.json`), which downloads the pinned
archive, refuses it unless its SHA-256 is the pinned one and its provenance
names the pinned build and commit, and writes its Build Output to
`landing/.vercel/output`. Every deployment serves its pin at
`https://www.fyug.fm/release.txt`.

Fyug's Deploy Landing Site workflow writes the pin: a commit that changes only
`landing/release.txt`, on branch `landing-preview` for a preview or
`landing-production`, which it then fast-forwards `main` to. To roll back,
revert that pin commit on `main`. Until the first pin, the committed pin names
no build and the landing build fails on purpose, so production keeps serving
what it served before.

## Build locally

```sh
bash build.sh           # the hosted server; needs curl, tar with xz, and sha256sum or shasum
bash landing/build.sh   # the landing site, the same way
```

`RELEASE_DOWNLOAD_BASE` (default `https://github.com`) changes where the
archive is downloaded from. `python3 -I test/build_test.py` and
`python3 -I test/landing_build_test.py` check the scripts against stand-in
releases; CI runs them with `shellcheck` on every pull request.
