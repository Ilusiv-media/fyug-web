#!/usr/bin/env python3
"""Checks landing/build.sh and the committed tree around it.

`bash landing/build.sh` runs in a temporary copy of this checkout against a
stand-in landing archive served from 127.0.0.1 through RELEASE_DOWNLOAD_BASE.
Each test writes its own landing/release.txt; the committed one is only
checked for its form. The hosted server's build.sh, release.txt and
vercel.json at the root are the other site, which this one never reads and
never changes (build_test.py checks them).

Usage: python3 -I test/landing_build_test.py
"""

import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CHECKOUT = Path(__file__).resolve().parents[1]
REPOSITORY = "testorg/fyug-web"
BUILD = "20261116153012-450d154"
COMMIT = "450d154" + "0123456789abcdef0123456789abcdef0"[:33]
NAME = f"fyug-landing-{BUILD}.vercel.tar.xz"
IGNORED = shutil.ignore_patterns(".git", ".vercel", "node_modules")
KEYS = ("repository", "build", "sha256", "commit")
sys.dont_write_bytecode = True  # leave no cache beside the tests
_spec = importlib.util.spec_from_file_location("hosted_build_test", Path(__file__).with_name("build_test.py"))
HOSTED = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(HOSTED)


def sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def archive_files(build=BUILD, commit=COMMIT, omit=(), provenance=None):
    """name -> bytes of a stand-in landing archive."""
    config = {"version": 3, "routes": [
        {"src": "^/play$", "headers": {"Content-Security-Policy": "frame-ancestors 'none'",
                                         "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"}, "continue": True},
        {"handle": "filesystem"},
        {"src": "^/play$", "dest": "https://mcp.fyug.fm/play", "check": True},
    ]}
    files = {
        "provenance.txt": (provenance if provenance is not None else f"build={build}\ncommit={commit}\nvercel_cli=39.1.2\n").encode(),
        "output/config.json": json.dumps(config).encode(),
        "output/static/index.html": b"<!doctype html><title>Fyug</title>\n",
        "output/static/assets/index-3f9a.js": b"console.log('fyug');\n",
        "output/functions/api/signup.func/.vc-config.json": b'{"runtime":"nodejs22.x","handler":"index.js"}',
        "output/functions/api/signup.func/index.js": b"module.exports = () => {};\n",
        "licenses/THIRD_PARTY_LICENSES.txt": b"lit 3.2.0 (BSD-3-Clause)\n",
    }
    return {name: data for name, data in files.items() if name not in omit}


def make_archive(files):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:xz") as archive:
        for name, data in sorted(files.items()):
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.mtime = len(data), 0o644, 0
            archive.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def release_path(repository=REPOSITORY, build=BUILD):
    return f"/{repository}/releases/download/landing-{build}/fyug-landing-{build}.vercel.tar.xz"


def pin(sha256="", build=BUILD, commit=COMMIT, repository=REPOSITORY):
    return f"repository={repository}\nbuild={build}\nsha256={sha256}\ncommit={commit}\n"


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


def parse_keys(text):
    found = {}
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            key, equals, value = line.partition("=")
            assert equals, f"not key=value: {line!r}"
            assert key not in found, f"{key} appears twice"
            found[key] = value
    return found


class LandingBuild(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.site = self.tmp / "site"
        shutil.copytree(CHECKOUT, self.site, ignore=IGNORED)
        self.downloads = Downloads()
        self.addCleanup(self.downloads.close)
        self.files = archive_files()
        self.data = make_archive(self.files)
        self.sha = sha256_hex(self.data)
        self.output = self.site / "landing" / ".vercel" / "output"

    def build(self, release_txt, cwd=None, script=("bash", "landing/build.sh")):
        """Runs the landing build with this pin, after leaving a stale output as an earlier build would."""
        pin_file = self.site / "landing" / "release.txt"
        pin_file.parent.mkdir(exist_ok=True)
        if release_txt is None:
            pin_file.unlink(missing_ok=True)
        else:
            pin_file.write_text(release_txt)
        shutil.rmtree(self.output, ignore_errors=True)
        self.output.mkdir(parents=True)
        (self.output / "stale.txt").write_text("from an earlier build\n")
        environment = {k: v for k, v in os.environ.items() if "proxy" not in k.lower() and k != "RELEASE_DOWNLOAD_BASE"}
        environment.update(RELEASE_DOWNLOAD_BASE=self.downloads.url, NO_PROXY="127.0.0.1,localhost", no_proxy="127.0.0.1,localhost")
        return subprocess.run(list(script), cwd=cwd or self.site, capture_output=True, text=True, env=environment, timeout=180)

    def serve(self, data=None, repository=REPOSITORY, build=BUILD):
        self.downloads.routes[release_path(repository, build)] = data if data is not None else self.data

    def assert_output(self, files, served):
        """landing/.vercel/output is the archive's output/ tree byte for byte, plus the pin it was built from at /release.txt."""
        found = {p.relative_to(self.output).as_posix(): p.read_bytes() for p in self.output.rglob("*") if p.is_file()}
        expected = {name[len("output/"):]: data for name, data in files.items() if name.startswith("output/")}
        released = found.pop("static/release.txt", None)
        self.assertEqual(found, expected)
        self.assertIsNotNone(released, "the output serves release.txt")
        self.assertEqual(parse_keys(released.decode()), served)

    def assert_refused(self, done):
        self.assertTrue((self.site / "landing" / "build.sh").is_file(), "landing/build.sh exists")
        self.assertNotEqual(done.returncode, 0, done.stdout)
        self.assertTrue(done.stderr.strip(), "a refusal explains itself on stderr")
        self.assertFalse(self.output.exists(), "no output is left for Vercel to deploy")

    def served(self, sha=None, build=BUILD, commit=COMMIT, repository=REPOSITORY):
        return {"repository": repository, "build": build, "sha256": sha or self.sha, "commit": commit}

    # --- a build serves the pinned archive's output ------------------------
    def test_the_build_installs_the_archives_output_tree_and_serves_the_pin_with_the_commit(self):
        self.serve()
        # Comments, blank lines and any key order are fine.
        text = f"# the landing pin\n\ncommit={COMMIT}\n\nsha256={self.sha}\nbuild={BUILD}\nrepository={REPOSITORY}\n"
        done = self.build(text)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.downloads.requests[0], release_path())
        self.assert_output(self.files, self.served())

    def test_the_built_commit_can_be_read_from_the_served_release_file(self):
        self.serve()
        self.assertEqual(self.build(pin(self.sha)).returncode, 0)
        served = parse_keys((self.output / "static" / "release.txt").read_text())
        self.assertEqual(served["commit"], COMMIT)
        self.assertEqual(sorted(served), sorted(KEYS))

    def test_it_runs_from_the_landing_directory_too(self):
        self.serve()
        done = self.build(pin(self.sha), cwd=self.site / "landing", script=("bash", "build.sh"))
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assert_output(self.files, self.served())

    def test_the_archive_comes_from_the_release_the_pin_names(self):
        for repository, build in ((REPOSITORY, BUILD), ("testorg/other-site", "0"), ("testorg/other-site", "a" + "-" * 38 + "9")):
            with self.subTest(repository=repository, build=build):
                files = archive_files(build=build)
                data = make_archive(files)
                self.serve(data, repository, build)
                self.downloads.requests.clear()
                done = self.build(pin(sha256_hex(data), build=build, repository=repository))
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertEqual(self.downloads.requests[0], release_path(repository, build))
                self.assert_output(files, self.served(sha256_hex(data), build, COMMIT, repository))

    def test_the_same_pin_built_twice_gives_the_same_output(self):
        self.serve()
        for _ in range(2):
            done = self.build(pin(self.sha))
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assert_output(self.files, self.served())  # the stale file an earlier build left is gone too

    # --- a build that cannot trust its archive deploys nothing -------------
    def test_a_download_with_another_hash_fails_and_names_the_pinned_hash(self):
        self.serve()
        pinned = "0123456789abcdef" * 4
        done = self.build(pin(pinned))
        self.assert_refused(done)
        self.assertIn(pinned, done.stderr)

    def test_a_missing_release_fails(self):
        done = self.build(pin(self.sha))  # nothing is served: HTTP 404
        self.assert_refused(done)
        self.assertIn(release_path(), self.downloads.requests)

    def test_an_archive_whose_provenance_names_another_build_or_commit_fails(self):
        cases = {
            "another build": archive_files(build="20261116153012-aaaaaaa"),
            "another commit": archive_files(commit="9" * 40),
            "no commit line": archive_files(provenance=f"build={BUILD}\nvercel_cli=39.1.2\n"),
            "no build line": archive_files(provenance=f"commit={COMMIT}\nvercel_cli=39.1.2\n"),
            "empty provenance": archive_files(provenance=""),
            "no provenance": archive_files(omit=("provenance.txt",)),
        }
        for label, files in cases.items():
            with self.subTest(label):
                data = make_archive(files)
                self.serve(data)
                self.assert_refused(self.build(pin(sha256_hex(data))))

    def test_an_archive_without_a_build_output_fails(self):
        for omit in (("output/config.json",), tuple(n for n in archive_files() if n.startswith("output/"))):
            with self.subTest(omit=omit):
                data = make_archive(archive_files(omit=omit))
                self.serve(data)
                self.assert_refused(self.build(pin(sha256_hex(data))))

    # --- the pin file ------------------------------------------------------
    def test_the_initial_pin_with_no_build_yet_fails_and_says_so(self):
        self.downloads.any_release = self.data
        done = self.build("repository=Ilusiv-media/fyug-web\nbuild=\nsha256=\ncommit=\n")
        self.assert_refused(done)
        self.assertRegex(done.stderr, r"(?i)no landing build|pinned yet|no build")
        self.assertEqual([r for r in self.downloads.requests if "/releases/download/" in r], [], "nothing is downloaded")

    def test_a_pin_with_none_of_its_keys_fails(self):
        self.downloads.any_release = self.data
        for label, text in (("empty file", ""), ("comments only", "# nothing pinned yet\n")):
            with self.subTest(label):
                self.assert_refused(self.build(text))

    def test_a_malformed_pin_fails_even_when_a_download_would_succeed(self):
        """The server answers any release path with an archive that matches the hash and the values written."""
        cases = {
            "no repository": f"build={BUILD}\nsha256={self.sha}\ncommit={COMMIT}\n",
            "no build": f"repository={REPOSITORY}\nsha256={self.sha}\ncommit={COMMIT}\n",
            "no sha256": f"repository={REPOSITORY}\nbuild={BUILD}\ncommit={COMMIT}\n",
            "no commit": f"repository={REPOSITORY}\nbuild={BUILD}\nsha256={self.sha}\n",
            "duplicate key": pin(self.sha) + f"build={BUILD}\n",
            "uppercase hash": pin(self.sha.upper()),
            "hash too long": pin(self.sha + "0"),
            "hash too short": pin(self.sha[:63]),
            "bad repository": pin(self.sha, repository="not a repository"),
            "empty file": "",
        }
        for label, text in cases.items():
            with self.subTest(label):
                self.downloads.any_release = self.data
                self.assert_refused(self.build(text))
        # A bad build id or commit, with an archive made for it that would otherwise pass.
        for build in ("UPPER", "has space", "-leading", "a" * 41, "a/b", "..", "a_b", "a.b"):
            with self.subTest(build=build):
                data = make_archive(archive_files(build=build))
                self.downloads.any_release = data
                self.assert_refused(self.build(pin(sha256_hex(data), build=build)))
        for commit in (COMMIT[:39], COMMIT + "0", COMMIT.upper(), "g" * 40, "main"):
            with self.subTest(commit=commit):
                data = make_archive(archive_files(commit=commit))
                self.downloads.any_release = data
                self.assert_refused(self.build(pin(sha256_hex(data), commit=commit)))

    def test_a_checkout_without_a_landing_pin_file_fails(self):
        self.downloads.any_release = self.data
        self.assert_refused(self.build(None))


class TwoSites(unittest.TestCase):
    """The landing site and the hosted server's share a repository and nothing else."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.site = self.tmp / "site"
        shutil.copytree(CHECKOUT, self.site, ignore=IGNORED)
        self.downloads = Downloads()
        self.addCleanup(self.downloads.close)
        environment = {k: v for k, v in os.environ.items() if "proxy" not in k.lower() and k != "RELEASE_DOWNLOAD_BASE"}
        self.environment = {**environment, "RELEASE_DOWNLOAD_BASE": self.downloads.url, "NO_PROXY": "127.0.0.1,localhost",
                            "no_proxy": "127.0.0.1,localhost"}
        self.landing = make_archive(archive_files())
        self.downloads.routes[release_path()] = self.landing
        self.landing_pin = pin(sha256_hex(self.landing))
        (self.site / "landing").mkdir(exist_ok=True)
        (self.site / "landing" / "release.txt").write_text(self.landing_pin)

    def run_build(self, *script):
        return subprocess.run(["bash", *script], cwd=self.site, capture_output=True, text=True, env=self.environment, timeout=180)

    def root_files(self):
        return {name: (self.site / name).read_bytes() for name in ("build.sh", "release.txt", "vercel.json")}

    def test_the_landing_build_never_reads_or_writes_the_hosted_servers_files(self):
        before = self.root_files()
        done = self.run_build("landing/build.sh")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.root_files(), before)
        self.assertFalse((self.site / ".vercel").exists(), "the hosted server's output is not written")
        # Without the hosted server's pin, or with one that could not build, the landing builds the same.
        for text in (None, "this is not a pin\n"):
            with self.subTest(root_pin=text):
                shutil.rmtree(self.site / "landing" / ".vercel")
                if text is None:
                    (self.site / "release.txt").unlink()
                else:
                    (self.site / "release.txt").write_text(text)
                done = self.run_build("landing/build.sh")
                self.assertEqual(done.returncode, 0, done.stderr)
                self.assertTrue((self.site / "landing" / ".vercel" / "output" / "static" / "index.html").is_file())

    def test_the_hosted_servers_build_neither_reads_nor_writes_the_landing_site(self):
        version = HOSTED.VERSION
        files = HOSTED.archive_files(version, build=HOSTED.BUILD, hosted_version=version)
        data = HOSTED.make_archive(files)
        self.downloads.routes[HOSTED.release_path(HOSTED.SITE, version, HOSTED.BUILD)] = data
        (self.site / "release.txt").write_text(HOSTED.pin(HOSTED.SITE, sha256=sha256_hex(data), extra=f"build={HOSTED.BUILD}\n"))
        shutil.rmtree(self.site / "landing")  # the other site is not there at all
        done = self.run_build("build.sh")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertTrue((self.site / ".vercel" / "output" / "config.json").is_file())
        self.assertFalse((self.site / "landing").exists())


class Tree(unittest.TestCase):
    """The checkout as committed: what Vercel's Git build of each project is handed."""

    def test_the_hosted_servers_files_do_not_mention_the_landing_site(self):
        for name in ("build.sh", "release.txt", "vercel.json"):
            self.assertNotRegex((CHECKOUT / name).read_text(), r"(?i)landing", name)

    def test_the_landing_site_has_its_own_config_build_script_and_pin(self):
        for name in ("vercel.json", "build.sh", "release.txt"):
            self.assertTrue((CHECKOUT / "landing" / name).is_file(), f"landing/{name}")
        config = json.loads((CHECKOUT / "landing" / "vercel.json").read_text())
        self.assertIsNone(config.get("framework"))
        self.assertEqual(config.get("installCommand"), "true")
        self.assertEqual(config.get("buildCommand"), "bash build.sh")

    def test_the_hosted_servers_vercel_config_still_runs_its_own_build_script(self):
        config = json.loads((CHECKOUT / "vercel.json").read_text())
        self.assertEqual(config.get("buildCommand"), "bash build.sh")
        self.assertIsNone(config.get("framework"))

    def test_the_committed_landing_pin_is_unpinned_or_well_formed(self):
        keys = parse_keys((CHECKOUT / "landing" / "release.txt").read_text(encoding="utf-8"))
        self.assertLessEqual(set(keys), set(KEYS))
        self.assertEqual(keys.get("repository"), "Ilusiv-media/fyug-web")
        if any(keys.get(key) for key in ("build", "sha256", "commit")):
            self.assertRegex(keys.get("build", ""), r"^[0-9a-z][0-9a-z-]{0,39}$")
            self.assertRegex(keys.get("sha256", ""), r"^[0-9a-f]{64}$")
            self.assertRegex(keys.get("commit", ""), r"^[0-9a-f]{40}$")

    def test_the_landing_directory_holds_no_server_binary_or_source_map(self):
        for root, directories, names in os.walk(CHECKOUT / "landing"):
            directories[:] = [d for d in directories if d not in (".vercel", "node_modules")]
            for name in names:
                path = Path(root) / name
                self.assertFalse(name.endswith(".map"), str(path))
                if path.is_file() and not path.is_symlink():
                    with open(path, "rb") as handle:
                        self.assertNotEqual(handle.read(4), b"\x7fELF", str(path))

    def test_ci_checks_the_landing_script_and_runs_its_test(self):
        workflow = "".join(line for line in (CHECKOUT / ".github" / "workflows" / "build.yml").read_text().splitlines(keepends=True)
                           if not line.lstrip().startswith("#"))
        self.assertRegex(workflow, r"shellcheck[^\n]*landing/build\.sh")
        self.assertRegex(workflow, r"landing_build_test\.py")
        self.assertRegex(workflow, r"shellcheck[^\n]*(?<![/\w])build\.sh", "the hosted server's script is still checked")
        self.assertRegex(workflow, r"build_test\.py", "the hosted server's test still runs")


if __name__ == "__main__":
    unittest.main(verbosity=2)
