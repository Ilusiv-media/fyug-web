# fyug-web

The site Vercel deploys for Fyug's hosted MCP server, `https://mcp.fyug.fm/mcp`.
It holds no server binary. `release.txt` pins one public archive of the server
and its SHA-256, in one of two forms:

- A product release: `repository=Ilusiv-media/fyug`, its `version` and the
  SHA-256 of that release's `fyug-hosted-<version>.vercel.tar.xz`.
- A hosted-only build: `repository=Ilusiv-media/fyug-web`, the product
  `version` it was built from, its `build` id and the SHA-256 of
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

## Build locally

```sh
bash build.sh   # needs curl, tar with xz, and sha256sum or shasum
```

`RELEASE_DOWNLOAD_BASE` (default `https://github.com`) changes where the
archive is downloaded from. `python3 -I test/build_test.py` checks the script
against a stand-in release; CI runs it with `shellcheck build.sh` on every pull
request.
