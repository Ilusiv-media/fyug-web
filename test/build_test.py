#!/usr/bin/env python3
"""Checks build.sh and the committed tree.

`bash build.sh` runs in a temporary copy of this checkout against a stand-in
release archive served from 127.0.0.1 through RELEASE_DOWNLOAD_BASE. Each test
writes its own release.txt; the committed one is only checked for its form.

Usage: python3 -I test/build_test.py
"""

import hashlib
import io
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CHECKOUT = Path(__file__).resolve().parents[1]
VERSION, REPOSITORY = "2026.11.1", "testorg/fyug"
EXECUTABLE = "functions/mcp.func/executable"
IGNORED = shutil.ignore_patterns(".git", ".vercel", "node_modules")


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def archive_files(version, provenance_version=None, omit=(), build=None):
    """name -> (bytes, mode) for a stand-in of the release's hosted archive,
    or of a hosted-only build's when `build` is given."""
    provenance = f"product_version={provenance_version or version}\n" + (f"build={build}\n" if build else "")
    files = {
        "provenance.txt": (provenance.encode(), 0o644),
        "output/config.json": (b'{\n  "version": 3\n}\n', 0o644),
        "output/functions/mcp.func/.vc-config.json": (b'{"runtime": "executable", "handler": "executable"}', 0o644),
        "output/functions/mcp.func/executable": (b"#!/bin/sh\necho stand-in server\n", 0o755),
        "output/functions/mcp.func/lib/libasound.so.2": (bytes(range(256)) * 8, 0o644),
    }
    return {name: value for name, value in files.items() if name not in omit}


def make_archive(files):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:xz") as archive:
        for name, (data, mode) in sorted(files.items()):
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(data), mode, 0
            archive.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def release_path(repository, version, build=None):
    if build:
        return f"/{repository}/releases/download/hosted-{version}-{build}/fyug-hosted-{version}-{build}.vercel.tar.xz"
    return f"/{repository}/releases/download/v{version}/fyug-hosted-{version}.vercel.tar.xz"


def served_pin(repository, version, sha256, build=None):
    return f"repository={repository}\nversion={version}\nsha256={sha256}\n" + (f"build={build}\n" if build else "")


class Downloads:
    """A stand-in for the release host: the archive sits behind a redirect, as on GitHub."""

    def __init__(self):
        self.routes, self.blobs, self.requests, self.any_release = {}, {}, [], None
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                outer.requests.append(self.path)
                blob = outer.blobs.get(self.path)
                route = outer.routes.get(self.path)
                if route is None and outer.any_release is not None and "/releases/download/" in self.path:
                    route = outer.any_release
                if blob is not None:
                    self.reply(200, blob)
                elif route is not None:
                    outer.blobs["/objects/archive"] = route
                    self.send_response(302)
                    self.send_header("Location", "/objects/archive")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                else:
                    self.reply(404, b"not found")

            def reply(self, status, data):
                self.send_response(status)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def pin(repository=REPOSITORY, version=VERSION, sha256="", extra=""):
    return f"repository={repository}\nversion={version}\nsha256={sha256}\n{extra}"


class FyugWebBuild(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.site = self.tmp / "site"
        shutil.copytree(CHECKOUT, self.site, ignore=IGNORED)
        self.downloads = Downloads()
        self.addCleanup(self.downloads.close)
        self.files = archive_files(VERSION)
        self.data = make_archive(self.files)
        self.sha = sha256_hex(self.data)

    def build(self, release_txt):
        """Runs `bash build.sh` with this pin, after leaving a stale output as an earlier build would."""
        if release_txt is None:
            (self.site / "release.txt").unlink(missing_ok=True)
        else:
            (self.site / "release.txt").write_text(release_txt)
        stale = self.site / ".vercel" / "output"
        shutil.rmtree(stale, ignore_errors=True)
        stale.mkdir(parents=True)
        (stale / "stale.txt").write_text("from an earlier build\n")
        environment = {k: v for k, v in os.environ.items() if "proxy" not in k.lower() and k != "RELEASE_DOWNLOAD_BASE"}
        environment.update(RELEASE_DOWNLOAD_BASE=self.downloads.url, NO_PROXY="127.0.0.1,localhost", no_proxy="127.0.0.1,localhost")
        return subprocess.run(["bash", "build.sh"], cwd=self.site, capture_output=True, text=True, env=environment, timeout=180)

    def serve(self, data=None, repository=REPOSITORY, version=VERSION, build=None):
        self.downloads.routes[release_path(repository, version, build)] = data if data is not None else self.data

    def assert_output(self, files, pin_text):
        """.vercel/output is the archive's output/ tree byte for byte, plus the served pin."""
        output = self.site / ".vercel" / "output"
        found = {p.relative_to(output).as_posix(): p.read_bytes() for p in output.rglob("*") if p.is_file()}
        expected = {name[len("output/"):]: data for name, (data, _) in files.items() if name.startswith("output/")}
        expected["static/release.txt"] = pin_text.encode()
        self.assertEqual(found, expected)
        self.assertTrue(os.stat(output / EXECUTABLE).st_mode & 0o100, "the function's executable bit survives")

    def assert_refused(self, done):
        self.assertNotEqual(done.returncode, 0, done.stdout)
        self.assertTrue(done.stderr.strip(), "a refusal explains itself on stderr")
        self.assertFalse((self.site / ".vercel" / "output").exists(), "no output is left for Vercel to deploy")

    # --- a build serves the pinned release's output -----------------------
    def test_the_build_installs_the_archives_output_tree_exactly(self):
        """Downloads the pinned release's archive; .vercel/output is its output/ tree, byte for byte."""
        self.serve(repository="testorg/fyug-releases")
        # Comments, blank lines and any key order are fine.
        text = f"# the pin\n\nsha256={self.sha}\n\nversion={VERSION}\nrepository=testorg/fyug-releases\n"
        done = self.build(text)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn(release_path("testorg/fyug-releases", VERSION), self.downloads.requests)
        self.assert_output(self.files, served_pin("testorg/fyug-releases", VERSION, self.sha))

    def test_a_build_pin_serves_that_builds_archive_and_names_the_build(self):
        build = "20261116153012-450d154"
        files = archive_files(VERSION, build=build)
        data = make_archive(files)
        self.serve(data, repository="testorg/fyug-web", build=build)
        done = self.build(pin("testorg/fyug-web", sha256=sha256_hex(data), extra=f"build={build}\n"))
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.downloads.requests[0], release_path("testorg/fyug-web", VERSION, build))
        self.assert_output(files, served_pin("testorg/fyug-web", VERSION, sha256_hex(data), build))

    def test_a_build_pin_needs_an_archive_made_for_that_build(self):
        build = "20261116153012-450d154"
        for label, made_for in (("another build", "20261116153012-aaaaaaa"), ("no build", None)):
            with self.subTest(label):
                data = make_archive(archive_files(VERSION, build=made_for))
                self.serve(data, repository="testorg/fyug-web", build=build)
                self.assert_refused(self.build(pin("testorg/fyug-web", sha256=sha256_hex(data), extra=f"build={build}\n")))

    def test_a_build_with_the_same_pin_run_twice_gives_the_same_output(self):
        self.serve()
        text = pin(sha256=self.sha)
        self.assertEqual(self.build(text).returncode, 0)
        self.assertEqual(self.build(text).returncode, 0)
        output = self.site / ".vercel" / "output"
        self.assertFalse((output / "stale.txt").exists())
        self.assertEqual((output / "config.json").read_bytes(), self.files["output/config.json"][0])

    # --- a build that cannot trust its archive deploys nothing -------------
    def test_a_download_with_another_hash_fails_and_names_the_pinned_hash(self):
        self.serve()
        pinned = "0123456789abcdef" * 4
        done = self.build(pin(sha256=pinned))
        self.assert_refused(done)
        self.assertIn(pinned, done.stderr)

    def test_a_missing_release_fails(self):
        done = self.build(pin(sha256=self.sha))  # nothing is served: HTTP 404
        self.assert_refused(done)
        self.assertIn(release_path(REPOSITORY, VERSION), self.downloads.requests)

    def test_an_archive_built_for_another_version_fails(self):
        data = make_archive(archive_files(VERSION, provenance_version="2026.11.0"))
        self.serve(data)
        self.assert_refused(self.build(pin(sha256=sha256_hex(data))))

    def test_an_archive_without_a_build_output_fails(self):
        data = make_archive(archive_files(VERSION, omit=("output/config.json",)))
        self.serve(data)
        self.assert_refused(self.build(pin(sha256=sha256_hex(data))))

    # --- the pin file's form ----------------------------------------------
    def test_an_unpinned_checkout_fails(self):
        self.downloads.any_release = self.data
        self.assert_refused(self.build(pin(version="", sha256="")))

    def test_a_malformed_pin_fails_even_when_a_download_would_succeed(self):
        """The server answers any release path with an archive that matches the hash and the version written."""
        cases = {
            "no repository": f"version={VERSION}\nsha256={self.sha}\n",
            "no version": f"repository={REPOSITORY}\nsha256={self.sha}\n",
            "no sha256": f"repository={REPOSITORY}\nversion={VERSION}\n",
            "duplicate key": pin(sha256=self.sha, extra=f"version={VERSION}\n"),
            "unknown key": pin(sha256=self.sha, extra="channel=stable\n"),
            "empty build": pin(sha256=self.sha, extra="build=\n"),
            "build twice": pin(sha256=self.sha, extra="build=b1\nbuild=b2\n"),
            "uppercase build": pin(sha256=self.sha, extra="build=B1\n"),
            "build with a slash": pin(sha256=self.sha, extra="build=b/1\n"),
            "uppercase hash": pin(sha256=self.sha.upper()),
            "hash too long": pin(sha256=self.sha + "0"),
            "empty file": "",
        }
        for label, text in cases.items():
            with self.subTest(label):
                self.downloads.any_release = self.data
                self.assert_refused(self.build(text))
        for version in ("2026.11", "v2026.11.1", "2026.11.1-rc1", "2026.11.1.2", "2026.11.x"):
            with self.subTest(version=version):
                data = make_archive(archive_files(version))
                self.downloads.any_release = data
                self.assert_refused(self.build(pin(version=version, sha256=sha256_hex(data))))

    def test_a_checkout_without_a_pin_file_fails(self):
        self.downloads.any_release = self.data
        self.assert_refused(self.build(None))


class FyugWebTree(unittest.TestCase):
    """The checkout as committed: what Vercel's Git build is handed."""

    def test_the_tree_holds_no_server_binary(self):
        elves = []
        for root, directories, names in os.walk(CHECKOUT):
            directories[:] = [d for d in directories if d not in (".git", ".vercel", "node_modules")]
            for name in names:
                path = Path(root) / name
                if path.is_symlink() or not path.is_file():
                    continue
                with open(path, "rb") as handle:
                    if handle.read(4) == b"\x7fELF":
                        elves.append(str(path.relative_to(CHECKOUT)))
        self.assertEqual(elves, [])

    def test_vercel_runs_the_build_script(self):
        config = json.loads((CHECKOUT / "vercel.json").read_text())
        self.assertRegex(config.get("buildCommand", ""), r"\bbuild\.sh\b")

    def test_the_committed_pin_is_unpinned_or_well_formed(self):
        keys = {}
        for line in (CHECKOUT / "release.txt").read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                key, equals, value = line.partition("=")
                self.assertTrue(equals, f"not key=value: {line!r}")
                self.assertNotIn(key, keys, f"{key} appears twice")
                keys[key] = value
        # Promote Release pins a product release; Deploy Hosted Server pins a
        # hosted-only build published here.
        if "build" in keys:
            self.assertEqual(sorted(keys), ["build", "repository", "sha256", "version"])
            self.assertEqual(keys["repository"], "Ilusiv-media/fyug-web")
            self.assertRegex(keys["build"], r"^[0-9a-z][0-9a-z-]{0,39}$")
        else:
            self.assertEqual(sorted(keys), ["repository", "sha256", "version"])
            self.assertEqual(keys["repository"], "Ilusiv-media/fyug")
        if keys["version"] or keys["sha256"] or "build" in keys:
            self.assertRegex(keys["version"], r"^\d+\.\d+\.\d+$")
            self.assertRegex(keys["sha256"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main(verbosity=2)
