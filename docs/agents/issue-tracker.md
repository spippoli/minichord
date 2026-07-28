# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in **`spippoli/minichord`**. Use the `gh` CLI for all operations.

## Always pass `-R spippoli/minichord`

This clone has two remotes: `origin` (`spippoli/minichord`, the fork this work happens in) and `upstream` (`BenjaminPoilve/minichord`, the original project). With two remotes configured, `gh` may resolve the wrong repository.

**Every `gh issue`, `gh pr` and `gh api` call must name the repo explicitly**, so that nothing is ever written to `upstream`:

```bash
gh issue list -R spippoli/minichord --state open
```

`upstream` is strictly read-only — never open an issue, a PR or a comment against `BenjaminPoilve/minichord`.

## Conventions

- **Create an issue**: `gh issue create -R spippoli/minichord --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> -R spippoli/minichord --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list -R spippoli/minichord --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> -R spippoli/minichord --body "..."`
- **Apply / remove labels**: `gh issue edit <number> -R spippoli/minichord --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> -R spippoli/minichord --comment "..."`

Issue and PR titles and bodies are written in **English**, like everything else that lands in the repository or on GitHub.

Pull requests opened from an issue target the `dev` branch, never `main`:
`gh pr create -R spippoli/minichord --base dev --title "..." --body "..."`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> -R spippoli/minichord --comments` and `gh pr diff <number> -R spippoli/minichord` for the diff.
- **List external PRs for triage**: `gh pr list -R spippoli/minichord --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close` — each with `-R spippoli/minichord`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42 -R spippoli/minichord` and fall back to `gh issue view 42 -R spippoli/minichord`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `spippoli/minichord`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> -R spippoli/minichord --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create -R spippoli/minichord --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/spippoli/minichord/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/spippoli/minichord/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list -R spippoli/minichord --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> -R spippoli/minichord --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> -R spippoli/minichord --body "<answer>"`, then `gh issue close <n> -R spippoli/minichord`, then append a context pointer (gist + link) to the map's Decisions-so-far.
