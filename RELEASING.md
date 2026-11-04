# Releasing

A release is not done until all four steps are:

1. Open a PR titled `chore: release X.Y.Z` that bumps `version` in `.claude-plugin/plugin.json` and adds a `## X.Y.Z — YYYY-MM-DD` entry at the top of `CHANGELOG.md`, then merge it. If the release changes what the mod keeps in `$.store` or `$.state`, make the new code read the older shape too.
2. Create the GitHub release on that merge commit, with the changelog entry as its notes:
   `gh release create vX.Y.Z --repo SummerRiversound/plan-flow --target <merge sha> --title vX.Y.Z --notes-file <the entry>`
3. `claude plugin marketplace update plan-flow`
4. `claude plugin update plan-flow@plan-flow`, which applies after a restart.
