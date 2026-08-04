import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildTaskEpisodeArtifacts, taskEpisodeFingerprint } from "../src/analysis/task-episodes.js";
import {
  readTaskEpisodeArtifacts,
  taskEpisodeArtifactPaths,
  writeTaskEpisodeArtifacts,
} from "../src/storage/task-episodes-writer.js";

const SOURCE = "a".repeat(64);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-episodes-writer-"));
  const harnessHome = path.join(root, "harness-home");
  const projectRoot = path.join(root, "project");
  const project = { projectKey: "project-fixture", projectRoot };
  const config = { harnessHome };
  const analysisRun = {
    runId: "run-task-episode-writer",
    contextFingerprint: "c".repeat(64),
    project: { projectKey: project.projectKey, projectRoot },
    selection: { selectedCount: 1, selectedFingerprint: "d".repeat(64) },
    laneStatus: { consumer: "complete" },
    consumption: { acceptedCount: 1, skippedCount: 0, status: "complete" },
  };
  const runDir = path.join(harnessHome, "projects", project.projectKey, "analysis-runs", analysisRun.runId);
  fs.mkdirSync(runDir, { recursive: true });
  return { root, harnessHome, projectRoot, project, config, analysisRun };
}

function artifacts(f, suffix = "one") {
  const sessionId = `private-${suffix}`;
  const events = [
    { schemaVersion: 1, eventId: `user-${suffix}`, entryId: `entry-user-${suffix}`, ordinal: 1, kind: "user_message", activePath: true, sessionId, projectKey: f.project.projectKey, cwd: f.projectRoot },
    { schemaVersion: 1, eventId: `assistant-${suffix}`, entryId: `entry-assistant-${suffix}`, ordinal: 2, kind: "assistant_message", activePath: true, sessionId, projectKey: f.project.projectKey, cwd: f.projectRoot },
  ];
  return buildTaskEpisodeArtifacts({
    analysisRun: f.analysisRun,
    projectRoot: f.projectRoot,
    sessionResults: [{ sessionId, sourceFingerprint: SOURCE, events }],
  });
}

function write(f, pair) {
  return writeTaskEpisodeArtifacts({
    config: f.config,
    project: f.project,
    analysisRun: f.analysisRun,
    ...pair,
  });
}

function mode(file) {
  return fs.statSync(file).mode & 0o777;
}

function tempFiles(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.includes(".tmp-")) : [];
}

function rebindPrivate(privateArtifact, readerArtifact) {
  const withReaderBinding = {
    ...privateArtifact,
    readerProjectionFingerprint: taskEpisodeFingerprint(readerArtifact),
  };
  const { artifactFingerprint, ...privatePayload } = withReaderBinding;
  return { ...withReaderBinding, artifactFingerprint: taskEpisodeFingerprint(privatePayload) };
}

test("writer publishes canonical private then reader artifacts with 0600 mode and validates their binding", () => {
  const f = fixture();
  const pair = artifacts(f);
  const output = write(f, pair);
  const paths = taskEpisodeArtifactPaths({ config: f.config, project: f.project, runId: f.analysisRun.runId });

  assert.equal(output.status, "complete");
  assert.equal(output.privateStatus, "written");
  assert.equal(output.readerStatus, "written");
  assert.equal(mode(paths.privatePath), 0o600);
  assert.equal(mode(paths.readerPath), 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.privatePath, "utf8")), pair.privateArtifact);
  assert.deepEqual(output.reader, pair.readerArtifact);
  assert.deepEqual(readTaskEpisodeArtifacts({ config: f.config, project: f.project, analysisRun: f.analysisRun }).reader, pair.readerArtifact);
  assert.deepEqual(tempFiles(paths.dir), []);
});

test("same-fingerprint replay is idempotent and mismatched collision fails closed", () => {
  const f = fixture();
  const firstPair = artifacts(f, "first");
  write(f, firstPair);
  const paths = taskEpisodeArtifactPaths({ config: f.config, project: f.project, runId: f.analysisRun.runId });
  const beforePrivate = fs.readFileSync(paths.privatePath, "utf8");
  const beforeReader = fs.readFileSync(paths.readerPath, "utf8");

  const replay = write(f, firstPair);
  assert.equal(replay.privateStatus, "existing");
  assert.equal(replay.readerStatus, "existing");

  const collision = artifacts(f, "different");
  assert.throws(
    () => write(f, collision),
    (error) => error.code === "TASK_EPISODE_PUBLICATION_FAILED"
      && error.reason === "private-artifact-collision-mismatch",
  );
  assert.equal(fs.readFileSync(paths.privatePath, "utf8"), beforePrivate);
  assert.equal(fs.readFileSync(paths.readerPath, "utf8"), beforeReader);
  assert.deepEqual(tempFiles(paths.dir), []);
});

test("an interrupted private-first publication is incomplete until exact replay publishes reader", () => {
  const f = fixture();
  const pair = artifacts(f);
  const paths = taskEpisodeArtifactPaths({ config: f.config, project: f.project, runId: f.analysisRun.runId });
  fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(paths.privatePath, `${JSON.stringify(pair.privateArtifact, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(paths.privatePath, 0o600);

  assert.throws(
    () => readTaskEpisodeArtifacts({ config: f.config, project: f.project, analysisRun: f.analysisRun }),
    (error) => error.code === "TASK_EPISODE_PUBLICATION_FAILED"
      && error.reason === "reader-artifact-missing",
  );

  const recovered = write(f, pair);
  assert.equal(recovered.privateStatus, "existing");
  assert.equal(recovered.readerStatus, "written");
  assert.deepEqual(recovered.reader, pair.readerArtifact);
  assert.deepEqual(tempFiles(paths.dir), []);
});

test("orphan reader, tampered private binding and unsafe modes are never treated as complete", () => {
  const orphan = fixture();
  const orphanPair = artifacts(orphan);
  const orphanPaths = taskEpisodeArtifactPaths({ config: orphan.config, project: orphan.project, runId: orphan.analysisRun.runId });
  fs.mkdirSync(orphanPaths.dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(orphanPaths.readerPath, `${JSON.stringify(orphanPair.readerArtifact)}\n`, { mode: 0o600 });
  fs.chmodSync(orphanPaths.readerPath, 0o600);
  assert.throws(
    () => write(orphan, orphanPair),
    (error) => error.reason === "orphan-reader-artifact",
  );

  const tampered = fixture();
  const tamperedPair = artifacts(tampered);
  write(tampered, tamperedPair);
  const tamperedPaths = taskEpisodeArtifactPaths({ config: tampered.config, project: tampered.project, runId: tampered.analysisRun.runId });
  const privateValue = JSON.parse(fs.readFileSync(tamperedPaths.privatePath, "utf8"));
  privateValue.counts.retained += 1;
  fs.writeFileSync(tamperedPaths.privatePath, `${JSON.stringify(privateValue)}\n`);
  fs.chmodSync(tamperedPaths.privatePath, 0o600);
  assert.throws(
    () => readTaskEpisodeArtifacts({ config: tampered.config, project: tampered.project, analysisRun: tampered.analysisRun }),
    (error) => error.reason === "private-fingerprint-mismatch",
  );

  const unsafeMode = fixture();
  const unsafePair = artifacts(unsafeMode);
  write(unsafeMode, unsafePair);
  const unsafePaths = taskEpisodeArtifactPaths({ config: unsafeMode.config, project: unsafeMode.project, runId: unsafeMode.analysisRun.runId });
  fs.chmodSync(unsafePaths.readerPath, 0o644);
  assert.throws(
    () => readTaskEpisodeArtifacts({ config: unsafeMode.config, project: unsafeMode.project, analysisRun: unsafeMode.analysisRun }),
    (error) => error.reason === "reader-artifact-mode",
  );
});

test("writer rejects traversal-shaped run IDs and task-episode directory symlinks", () => {
  const f = fixture();
  assert.throws(
    () => taskEpisodeArtifactPaths({ config: f.config, project: f.project, runId: "../escape" }),
    (error) => error.code === "TASK_EPISODE_PUBLICATION_FAILED" && error.reason === "invalid-run-id",
  );
  assert.throws(
    () => taskEpisodeArtifactPaths({ config: f.config, project: { projectKey: "../escape" }, runId: f.analysisRun.runId }),
    (error) => error.code === "TASK_EPISODE_PUBLICATION_FAILED" && error.reason === "invalid-project-key",
  );

  const pair = artifacts(f);
  const paths = taskEpisodeArtifactPaths({ config: f.config, project: f.project, runId: f.analysisRun.runId });
  const outside = path.join(f.root, "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, paths.dir);
  assert.throws(
    () => write(f, pair),
    (error) => error.reason === "task-episode-directory-unsafe",
  );
  assert.equal(fs.readdirSync(outside).length, 0);

  const ancestor = fixture();
  const ancestorPair = artifacts(ancestor);
  const analysisRunsDir = path.join(
    ancestor.harnessHome,
    "projects",
    ancestor.project.projectKey,
    "analysis-runs",
  );
  const outsideRuns = path.join(ancestor.root, "outside-runs");
  fs.rmSync(analysisRunsDir, { recursive: true });
  fs.mkdirSync(path.join(outsideRuns, ancestor.analysisRun.runId), { recursive: true });
  fs.symlinkSync(outsideRuns, analysisRunsDir);
  assert.throws(
    () => write(ancestor, ancestorPair),
    (error) => error.reason === "analysis-run-directory-unsafe",
  );
  assert.equal(fs.existsSync(path.join(outsideRuns, ancestor.analysisRun.runId, "task-episodes")), false);
});

test("exclusive-link failure cleans its temporary file and exact retry recovers", () => {
  const f = fixture();
  const cleanPair = artifacts(f);
  const pairWithCollisionHook = { ...cleanPair, privateArtifact: { ...cleanPair.privateArtifact } };
  const paths = taskEpisodeArtifactPaths({ config: f.config, project: f.project, runId: f.analysisRun.runId });
  Object.defineProperty(pairWithCollisionHook.privateArtifact, "toJSON", {
    enumerable: false,
    value() {
      fs.writeFileSync(paths.privatePath, "{}\n", { mode: 0o600 });
      fs.chmodSync(paths.privatePath, 0o600);
      return cleanPair.privateArtifact;
    },
  });

  assert.throws(
    () => write(f, pairWithCollisionHook),
    (error) => error.reason === "artifact-collision",
  );
  assert.deepEqual(tempFiles(paths.dir), []);
  assert.equal(fs.existsSync(paths.readerPath), false);

  fs.unlinkSync(paths.privatePath);
  const recovered = write(f, cleanPair);
  assert.equal(recovered.privateStatus, "written");
  assert.equal(recovered.readerStatus, "written");
  assert.deepEqual(tempFiles(paths.dir), []);
});

test("writer binds the run to destination project identity and rejects same-run cross-project writes", () => {
  const f = fixture();
  const pair = artifacts(f);
  const otherProject = { projectKey: "other-project", projectRoot: path.join(f.root, "other-project") };
  assert.throws(
    () => writeTaskEpisodeArtifacts({ config: f.config, project: otherProject, analysisRun: f.analysisRun, ...pair }),
    (error) => error.reason === "analysis-run-destination-project-key",
  );

  const privateMismatch = structuredClone(pair.privateArtifact);
  privateMismatch.runBinding.projectKey = "other-project";
  const reboundPrivate = rebindPrivate(privateMismatch, pair.readerArtifact);
  assert.throws(
    () => write(f, { privateArtifact: reboundPrivate, readerArtifact: pair.readerArtifact }),
    (error) => error.reason === "private-project-key-binding",
  );
});

test("writer recomputes nested session and candidate totals instead of trusting private counts", () => {
  const f = fixture();
  const pair = artifacts(f);
  const privateArtifact = structuredClone(pair.privateArtifact);
  const readerArtifact = structuredClone(pair.readerArtifact);
  privateArtifact.counts.retained += 1;
  readerArtifact.counts.retained += 1;
  const reboundReader = { ...readerArtifact };
  const reboundPrivate = rebindPrivate(privateArtifact, reboundReader);
  assert.throws(
    () => write(f, { privateArtifact: reboundPrivate, readerArtifact: reboundReader }),
    (error) => error.reason === "private-count-reconciliation",
  );
});

test("writer fails closed for unsafe task directory mode, final symlink, and descriptor binding failures", () => {
  const modeFixture = fixture();
  const modePair = artifacts(modeFixture);
  const modePaths = taskEpisodeArtifactPaths({ config: modeFixture.config, project: modeFixture.project, runId: modeFixture.analysisRun.runId });
  fs.mkdirSync(modePaths.dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(modePaths.dir, 0o755);
  assert.throws(() => write(modeFixture, modePair), (error) => error.reason === "task-episode-directory-mode");

  const symlinkFixture = fixture();
  const symlinkPair = artifacts(symlinkFixture);
  write(symlinkFixture, symlinkPair);
  const symlinkPaths = taskEpisodeArtifactPaths({ config: symlinkFixture.config, project: symlinkFixture.project, runId: symlinkFixture.analysisRun.runId });
  fs.unlinkSync(symlinkPaths.readerPath);
  const outside = path.join(symlinkFixture.root, "outside-reader.json");
  fs.writeFileSync(outside, "{}\n", { mode: 0o600 });
  fs.symlinkSync(outside, symlinkPaths.readerPath);
  assert.throws(
    () => readTaskEpisodeArtifacts({ config: symlinkFixture.config, project: symlinkFixture.project, analysisRun: symlinkFixture.analysisRun }),
    (error) => error.reason === "reader-artifact-unsafe",
  );

  const unavailable = fixture();
  const unavailablePair = artifacts(unavailable);
  assert.throws(
    () => writeTaskEpisodeArtifacts({
      config: unavailable.config,
      project: unavailable.project,
      analysisRun: unavailable.analysisRun,
      ...unavailablePair,
      verificationHooks: { descriptorRealPath: () => undefined },
    }),
    (error) => error.reason === "secure-binding-unavailable",
  );
});

test("descriptor-bound reads reject pathname replacement and in-place mutation and clean temps", () => {
  const replacement = fixture();
  const replacementPair = artifacts(replacement);
  write(replacement, replacementPair);
  let replaced = false;
  assert.throws(
    () => readTaskEpisodeArtifacts({
      config: replacement.config,
      project: replacement.project,
      analysisRun: replacement.analysisRun,
      verificationHooks: {
        afterArtifactOpen({ filePath, label }) {
          if (label !== "private" || replaced) return;
          replaced = true;
          fs.renameSync(filePath, `${filePath}.old`);
          fs.writeFileSync(filePath, "{}\n", { mode: 0o600 });
        },
      },
    }),
    (error) => error.reason === "private-artifact-binding-mismatch",
  );
  const mutation = fixture();
  const mutationPair = artifacts(mutation);
  write(mutation, mutationPair);
  const mutationPaths = taskEpisodeArtifactPaths({ config: mutation.config, project: mutation.project, runId: mutation.analysisRun.runId });
  assert.throws(
    () => readTaskEpisodeArtifacts({
      config: mutation.config,
      project: mutation.project,
      analysisRun: mutation.analysisRun,
      verificationHooks: {
        afterArtifactRead({ filePath, label }) {
          if (label === "private") fs.appendFileSync(filePath, " ");
        },
      },
    }),
    (error) => error.reason === "private-artifact-mutated-during-read",
  );
  assert.deepEqual(tempFiles(mutationPaths.dir), []);
});

test("reader collision recovery leaves no temporary files and preserves valid private artifact", () => {
  const f = fixture();
  const pair = artifacts(f);
  const paths = taskEpisodeArtifactPaths({ config: f.config, project: f.project, runId: f.analysisRun.runId });
  fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(paths.privatePath, `${JSON.stringify(pair.privateArtifact, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(paths.privatePath, 0o600);
  fs.mkdirSync(paths.readerPath);

  assert.throws(
    () => write(f, pair),
    (error) => error.reason === "reader-artifact-unsafe",
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.privatePath, "utf8")), pair.privateArtifact);
  assert.deepEqual(tempFiles(paths.dir), []);

  fs.rmdirSync(paths.readerPath);
  const recovered = write(f, pair);
  assert.equal(recovered.readerStatus, "written");
  assert.equal(mode(paths.readerPath), 0o600);
  assert.deepEqual(tempFiles(paths.dir), []);
});
