# Releasing Zotana

## What runs on GitHub (the "robots")

GitHub runs commands for you on a fresh cloud machine whenever something happens
in the repo. The instructions live in `.github/workflows/`.

- **Build** (`build.yml`) — runs on every push to `main` and every PR.
  Checks formatting + tests (`vp run verify`), then builds the plugin. It
  **publishes nothing**; it's a smoke detector that tells you the commit is
  clean and actually builds on a clean machine. This is the one that goes red on
  formatting issues.
- **Release** (`release.yml`) — runs **only** when you push a tag like `v0.2.0`.
  Runs the same checks first, then packages the `.xpi` and posts it as a public
  GitHub Release (marked "latest") plus an update manifest. **This is the only
  thing that reaches real users** and lets their Zotero auto-update.
- **CodeQL** — automatic security scan, unrelated.

Both Build and Release start with the same `vp run verify` step, so one
formatting issue takes down both.

## The one rule

**Tag the release LAST, only after the build is already green.**

Tagging should be the final blessing of a commit that already passed, not the
trigger that discovers problems. Keep these two acts separate and in order:

1. Get `main` healthy — push fix commits until the Build robot is green ✅.
2. Then tag that green commit as a version — the Release robot runs on a commit
   that already passed, so it passes too.

If a release ever fails, **nothing got published** (verify runs before the
package/publish steps). The only leftover is a tag pointing at a bad commit. You
fix it; users were never exposed.

## Cutting a release (the clean way)

```sh
# 1. Make the fix as an ordinary commit
git commit -m "..."
git push                 # triggers the Build robot

# 2. Wait for Build to go GREEN before tagging
gh run watch             # or watch the Actions tab in the browser

# 3. Only once green, tag and push the tag -> triggers Release -> publishes
git tag v0.2.0
git push origin v0.2.0
```

## If a tag is already on a bad commit (never-published fix)

Safe ONLY because the failed release never published, so no user has that
version. Delete the unpublished tag and recreate it on the green commit:

```sh
git push origin :v0.2.0   # delete the tag on GitHub
git tag -d v0.2.0         # delete it locally
git tag v0.2.0            # recreate on the current (green) commit
git push origin v0.2.0    # triggers Release
```

## Once a version has actually shipped to users

**Never reuse or move a published version tag.** A version number is a permanent
label — "v0.2.0 IS this exact code, forever." If you find a bug after shipping,
bump the number instead:

```sh
# bump package.json to 0.2.1, commit, push, wait for green, then:
git tag v0.2.1
git push origin v0.2.1
```

Old `v0.2.0` stays frozen as the historical record.

## About `pnpm release:retag`

It does `git commit --amend` + force-moves the version/`release` tags +
force-pushes everything. That **rewrites history** and **moves a version tag** —
both bad habits in general. It's tolerable as a one-off only for a tag that
never published (solo repo, nobody has it). Once a real release is out, retire it
in favor of bumping the patch version.
