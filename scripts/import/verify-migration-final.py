#!/usr/bin/env python3
"""Run once through heavy on a frozen checkout; retain synthetic proof and safe logs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import uuid


def canonical_directory(value):
    directory = Path(value)
    if not directory.is_absolute() or not directory.is_dir() or directory.resolve() != directory:
        raise argparse.ArgumentTypeError("Use an existing absolute canonical directory.")
    return directory


def tracked_snapshot(repo):
    output = subprocess.check_output(["git", "ls-files", "-z"], cwd=repo)
    files = sorted(name for name in output.split(b"\0") if name and not any(
        part.startswith(b".env") for part in name.split(b"/")))
    digest = hashlib.sha256()
    for name in files:
        file = repo / os.fsdecode(name)
        digest.update(name + b"\0")
        if file.is_symlink():
            digest.update(b"symlink\0" + os.fsencode(os.readlink(file)))
        else:
            with file.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
        digest.update(b"\0")
    return {"files": len(files), "sha256": digest.hexdigest()}


def json_result(output, required_key):
    for line in reversed(output.splitlines()):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and required_key in value:
            return value
    raise RuntimeError("Missing machine-readable stage result.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=canonical_directory)
    parser.add_argument("--artifacts", required=True, type=canonical_directory)
    parser.add_argument("--skip-repo-checks", action="store_true", help="Caller runs contracts/typecheck in the same pipeline; this helper does not attest their result.")
    args = parser.parse_args()
    if not str(args.artifacts).startswith("/Volumes/Mad Dog/"):
        parser.error("Retained synthetic artifacts must be on mounted Mad Dog.")
    if not (args.repo / "scripts/import/run-local-migration.mjs").is_file():
        parser.error("Repo must contain the integrated migration runner.")
    gate = args.artifacts / ("final-gate-" + str(uuid.uuid4()))
    gate.mkdir(mode=0o700)
    manifest = {"formatVersion": 1, "scope": "synthetic-only", "clientWrites": 0,
                "repoChecks": "delegated-not-attested" if args.skip_repo_checks else "pending",
                "stages": [], "success": False}

    def save():
        part = gate / "manifest.part"
        with part.open("w", encoding="utf-8") as stream:
            os.chmod(part, 0o600)
            json.dump(manifest, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(part, gate / "manifest.json")

    def stage(name, command, env=None):
        log = gate / (name + ".log")
        fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            child = subprocess.Popen(command, cwd=args.repo, stdout=stream, stderr=subprocess.STDOUT, env=env)
            record = {"stage": name, "command": command, "pid": child.pid, "log": str(log)}
            manifest["stages"].append(record)
            save()
            print(json.dumps({"stage": name, "status": "running", "pid": child.pid}), flush=True)
            code = child.wait()
        record["exitCode"] = code
        record["logSha256"] = hashlib.sha256(log.read_bytes()).hexdigest()
        save()
        print(json.dumps({"stage": name, "exitCode": code}), flush=True)
        if code != 0:
            raise RuntimeError(name + "-failed")
        return log.read_text()

    try:
        manifest["projectBefore"] = tracked_snapshot(args.repo)
        save()
        if not args.skip_repo_checks:
            stage("contracts", ["node", "--import", "tsx", "--test", "tests/local-migration.test.ts"])
            stage("typecheck", ["pnpm", "exec", "tsc", "--noEmit", "--incremental", "false"])
            manifest["repoChecks"] = "passed"
        output = stage("synthetic-proof", ["node", "scripts/import/run-local-migration.mjs", "--prove", str(args.artifacts)])
        proof_root = canonical_directory(json_result(output, "workRoot")["workRoot"])
        if args.artifacts not in proof_root.parents:
            raise RuntimeError("Proof outside retained artifacts.")
        proof_file = proof_root / "proof.json"
        proof = json.loads(proof_file.read_text())
        assert proof["scope"] == "synthetic-only" and proof["clientWrites"] == 0
        assert proof["checks"]["projectFilesUnchanged"] is True
        assert proof["projectBefore"] == proof["projectAfter"]
        manifest["syntheticProof"] = str(proof_file)
        manifest["proofSha256"] = hashlib.sha256(proof_file.read_bytes()).hexdigest()
        save()
        cli_output = stage("default-cli", ["node", "scripts/import/run-local-migration.mjs",
                           "--work-root", str(proof_root), "--package", str(proof_root / "source/migration-package.json"),
                           "--target", str(proof_root / "target"), "--reports", str(proof_root / "reports")],
                           dict(os.environ, PAYLOAD_SECRET=secrets.token_hex(32)))
        summary = json_result(cli_output, "success")
        assert summary["success"] is True and summary["mode"] == "dry-run" and summary["sourceComplete"] is False
        checkpoint = next(file for file in (proof_root / "reports").glob("*.json")
                          if hashlib.sha256(file.read_bytes()).hexdigest() == summary["checkpointSha256"])
        report = json.loads(checkpoint.read_text())
        assert report["stage"] == "finished" and report["mode"] == "dry-run"
        assert report["clientWrites"] == 0 and report["clientCutoverReady"] is False
        assert report["before"]["tablesSha256"] == report["after"]["tablesSha256"]
        assert report["before"]["mediaSha256"] == report["after"]["mediaSha256"]
        assert report["schemaWrites"] == 0 and report["accountsMigration"] == "unsupported" and report["historyMigration"] == "unsupported"
        manifest["projectAfter"] = tracked_snapshot(args.repo)
        assert manifest["projectBefore"] == manifest["projectAfter"], "Gate changed tracked project sources."
        manifest["defaultCliCheckpoint"] = str(checkpoint)
        manifest["projectFilesUnchanged"] = True
        manifest["success"] = True
        save()
        print(json.dumps({"success": True, "manifest": str(gate / "manifest.json"), "syntheticProof": str(proof_file)}), flush=True)
        return 0
    except Exception as error:
        manifest["errorType"] = type(error).__name__
        save()
        print(json.dumps({"success": False, "manifest": str(gate / "manifest.json"), "errorType": type(error).__name__}), flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
