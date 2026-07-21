---
name: update-skills
description: 'Synchronize a consumer repo with the tdog skills library: pull upstream edits, reconcile consumer changes, discover and install new upstream skills, and apply established consumer wiring. Use when the user says "update my skills", "pull skill updates", "sync skills from tdog", or suspects the library has moved ahead of this repo. Opposite direction of backport-skill.'
---

# Update skills from the library

Skills under `.agents/skills/<name>/` are copies of the **tdog skills library** (`github.com/tylerdurrett/skills`). `backport-skill` pushes consumer edits up; this skill synchronizes library changes down. Treat the library as canonical, but never silently discard consumer-only work.

An update must not degrade into a report-only no-op when actionable upstream changes exist. Apply unambiguous edits to already-installed skills. For ambiguous edits, show the actual incoming diff and recommendation, ask the user to choose, then resume the sync from that decision. Use Git history as internal evidence; missing shared ancestry is not by itself a user-facing conflict. Never add a new top-level skill before the user approves it.

## 1. Resolve, verify, freshen the library

Resolve the library checkout and run the remote safety check exactly as described in [backport-skill](../backport-skill/SKILL.md) (env var → `.tdog-skills-path` → auto-discover; verify `origin` matches `github.com/tylerdurrett/skills`). Record `main` as `<before-fetch>` before fetching.

Then — **the local checkout is routinely stale; a diff against it lies**:

- `git -C <library> fetch origin`
- If the library tree is clean and `main` is strictly behind `origin/main`: `git merge --ff-only origin/main`.
- If the tree is dirty or `main` has diverged: **stop** and tell the user — reconciling the library is their call, not this skill's.

Keep the fetched range `<before-fetch>..<library-head>` for detecting newly added or removed top-level skill directories. Still inventory the full trees when the range is empty; another process may have already freshened the library.

## 2. Inventory the whole sync

Compare top-level directories under `.agents/skills/` and `<library>/skills/`, then classify:

- **Shared, identical** — skip.
- **Shared, different** — classify file history in step 3.
- **Library-only** — installation candidate; handle in step 4.
- **Consumer-only** — backport or intentional-local candidate; report it and do not remove it.

Also detect files removed from an otherwise shared skill. Remove a clean historical copy when the library removed it; ask before removing consumer-edited content.

## 3. Reconcile shared skills

Use file history to distinguish upstream updates from consumer-only work, but keep blob hashes and ancestry mechanics internal unless the user asks or they are necessary to explain unresolved ambiguity.

For each differing file, first test whether the current consumer version exists in library history:

```bash
git -C <library> log --oneline --find-object=$(git hash-object <consumer-file>) -- skills/<name>/
```

- **Hit** — pull the newer library file.
- **No hit** — search the consumer file's earlier blobs for the newest blob also present in the library file's history. Use that shared blob as the three-way base.
- **No shared base** — compare the actual behavior and relevant library commits. Treat this as unverified ancestry, not as a conflict by itself.

Resolve based on behavior:

- If only the library changed, pull it.
- If only the consumer changed, keep it and report a `/backport-skill` candidate.
- If both changed without overlap, merge both changes.
- If the canonical library version clearly preserves or supersedes the consumer behavior, pull it, including when no shared base exists.
- If consumer behavior would be lost, or the relationship remains uncertain, require a decision.

Never report only “diverged — reconcile by hand,” and never pause merely because a shared blob was unavailable. When a real behavioral decision is required, present the affected file, concise behavior-level summary, relevant diff, recommendation, and these choices: **take library**, **keep consumer and backport**, or **reconcile both**. Do not expose blob details unless they materially explain the uncertainty, and do not overwrite ambiguous consumer work before the user chooses.

Files newly added inside a shared skill are clean pulls; preserve their executable bits.

## 4. Install new upstream skills

Treat every library-only top-level skill as an installation candidate:

- If added in `<before-fetch>..<library-head>`, classify it as **new upstream** and recommend whether to install it.
- If it predates `<before-fetch>` or the fetched range is empty, present it as an **uninstalled library skill** with its description and latest commit; do not silently ignore it.
- Read its `SKILL.md` and referenced files before proposing installation. Present its purpose, dependencies, expected consumer wiring, and source commit. Ask the user to approve each proposed top-level skill; never install one merely because the update is otherwise unambiguous.

After approval, copy the complete skill directory into `.agents/skills/<name>/`, preserving file modes. Inspect how the consumer exposes existing skills. If it uses per-skill `.claude/skills/` symlinks, create the matching relative symlink. Apply similarly obvious, established install wiring as part of the approved installation; surface non-routine follow-ons for a separate decision.

## 5. Adaptation and validation

Read the actual diff of every pull, merge, installation, removal, and wiring change:

- **Dangling references** — incoming text that points at a skill, doc, or path this repo doesn't have (e.g. a pointer to a skill the consumer never installed). Flag it; drop or reword with the user rather than shipping a dead reference.
- **Implied follow-ons** — perform routine wiring established by the consumer; surface non-routine actions as recommendations.
- **Repo-specific assumptions** — anything in the incoming text that assumes a layout or convention this consumer doesn't follow.

Confirm verbatim pulls and installations match the library byte-for-byte; that is sufficient validation of the copy and must not depend on an optional YAML parser. Validate frontmatter for merged or adapted skills with the repository's validator when available, otherwise use a structural check. Do not report an unavailable optional validator unless validation cannot be completed. Run `git diff --check` and verify every created symlink resolves.

## 6. Report and commit

Report per skill: **pulled**, **merged**, **installed**, **decision required**, **backport candidate**, **uninstalled library skill**, or **skipped**, plus adaptations and follow-ons. Include the relevant library SHAs.

Commit completed changes to the consumer repo per its landing conventions (for skill/doc/config tweaks, typically straight to `main`), citing the library SHAs. If a decision is required, pause before the commit, ask the concrete question, and resume after the answer rather than ending the workflow early.
