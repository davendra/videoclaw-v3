# Publishing

How to cut a release of `videoclaw` to npm and propagate it to the
Homebrew tap. Keep this doc aligned with the actual release workflow.

## Versioning

Semantic versioning. Bump the `version` field in `package.json` and commit the
bump as its own commit (`release: v0.2.0`) so the tag and the commit line up.

## 1. npm publish

Prereqs:

- npm account with two-factor enabled
- `npm login` on the release machine

Release:

```bash
# Ensure clean state
git status --porcelain           # must be empty
git pull --rebase

# Full gate before publish
npm run check:release-readiness-lite

# Bump version + tag (creates the v<ver> tag locally)
npm version <patch|minor|major> -m "release: v%s"

# Publish (runs prepublishOnly: npm test)
npm publish

# Push the commit + tag
git push && git push --tags
```

The `files` field in `package.json` controls what ships:

```
AGENTS.md
CLAUDE.md
tsconfig.json
docs/*.md
docs/assets/*
dist/cli/
dist/video/
dist/index.*
schemas/
src/video/
skills/README.md
skills/catalog.json
skills/*/README.md
skills/*/SKILL.md
tmp/review-station/index.html
```

Plus npm always includes `README.md`, `LICENSE`, and `package.json`. The Review
UI HTML is intentionally shipped because `vclaw video review-ui` defaults to the
bundled package asset; `--ui-path` is only an override for local UI development.
The package also ships `src/video/` because operator docs link to the domain
modules for source-available inspection. Compiled tests, source tests, project
workspaces, generated verification artifacts, and bulky skill assets/scripts
must stay out of the package. Do **not** add a `.npmignore` — keep `files`
authoritative.

Verify:

```bash
npm view videoclaw version
npx videoclaw@latest video providers
npm pack --dry-run --json
```

The dry-run package should include `README.md`, `LICENSE`, `package.json`,
`docs/PRODUCTION_WORKFLOW.md`, `docs/CLI_REFERENCE.md`, `docs/MIGRATION.md`,
`docs/assets/demo-quickstart.{cast,gif}`, `dist/cli/vclaw.js`,
`dist/video/review-ui.js`, schemas, and skills. It should exclude `projects/`,
compiled/source tests, generated verification artifacts, and any nested `.tgz`
archive.

Latest local dry-run evidence on 2026-05-08:

```json
{
  "entryCount": 521,
  "hasReadme": true,
  "hasLicense": true,
  "hasPackage": true,
  "hasCliReference": true,
  "hasProductionWorkflow": true,
  "hasMigration": true,
  "hasPublishing": true,
  "hasDemoGif": true,
  "hasDemoCast": true,
  "hasReviewUi": true,
  "hasProjects": false,
  "hasTests": false,
  "hasTgz": false
}
```

## 2. GitHub release

After `git push --tags`:

```bash
gh release create v<ver> \
  --title "v<ver>" \
  --notes-file CHANGELOG.md \
  # or --generate-notes
```

## 3. Homebrew tap

A Homebrew tap is just a GitHub repo named `homebrew-<name>` that holds formula
files under `Formula/`. Recommended: `davendra/homebrew-vclaw`.

### One-time: create the tap repo

```bash
gh repo create davendra/homebrew-vclaw --public \
  --description "Homebrew tap for videoclaw"
git clone https://github.com/davendra/homebrew-vclaw.git
mkdir -p homebrew-vclaw/Formula
cp packaging/homebrew/vclaw.rb homebrew-vclaw/Formula/vclaw.rb
cd homebrew-vclaw
git add Formula/vclaw.rb
git commit -m "add vclaw formula"
git push
```

### Each release: bump the formula

After `npm publish` succeeds:

```bash
VERSION=0.2.0
TARBALL_URL="https://registry.npmjs.org/videoclaw/-/videoclaw-${VERSION}.tgz"
SHA=$(curl -sL "$TARBALL_URL" | shasum -a 256 | awk '{print $1}')

# In the tap repo, update Formula/vclaw.rb:
#   url   "$TARBALL_URL"
#   sha256 "$SHA"

git commit -am "vclaw ${VERSION}"
git push
```

### User install

```bash
brew tap davendra/vclaw
brew install vclaw
vclaw video providers
```

## 4. Post-publish smoke

On a fresh machine or clean dir:

```bash
npx videoclaw@latest video providers
# and
brew tap davendra/vclaw && brew install vclaw && vclaw video providers
```

Both should produce a JSON provider report and exit `0`.

## Rollback

npm: `npm unpublish videoclaw@<ver>` within 72h, or publish a new patch.

Homebrew tap: revert the formula commit — users will get the prior version on
their next `brew update && brew upgrade vclaw`.
