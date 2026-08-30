# Contributing to Peach Butt / 参与贡献

感谢你帮助桃屁屁变得更可靠、更可爱。Bug 报告、跨平台测试、无障碍改进和小而清晰的 Pull Request 都很欢迎。

Thanks for helping Peach Butt become calmer, healthier, and more reliable. Bug reports, cross-platform validation, accessibility improvements, and focused pull requests are welcome.

## Before opening a pull request

1. Create a branch from `main` and keep the change focused.
2. Add or update tests when changing timers, scoring, persistence, or state transitions.
3. Preserve the character proportions, full feet, shared canvas, and bottom anchor when changing motion assets.
4. Run:

```bash
npm run assets:check
npm run videos:check
npm run typecheck
npm test
npm run build
```

5. Do not commit databases, private activity data, build output, secrets, or assets you do not have permission to publish.

For video work, follow [`docs/video-asset-workflow.md`](docs/video-asset-workflow.md). For security issues, follow [`SECURITY.md`](SECURITY.md).
