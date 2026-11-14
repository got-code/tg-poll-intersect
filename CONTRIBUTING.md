# Development rules

- Agree on a plan before implementation. Keep product copy English and branding neutral.
- Follow established industry practices appropriate to the project: Clean Architecture, SOLID, KISS, YAGNI, DRY, security and privacy by design, accessibility, automated testing and reproducible builds. Keep domain logic independent of UI and infrastructure. Organize code around clear responsibilities and reasons to change, with high cohesion and low coupling. Prefer simple designs; verify these principles during implementation and review.
- Prefer established tools and libraries over custom implementations. Write custom code only when existing solutions demonstrably do not meet the requirements.
- Preserve the privacy and storage contracts, locked dependencies and bundled license notices.
- Keep every necessary test in the repository as automated code; remove temporary scripts. Run checks proportionate to the change and its affected dependencies. Skip checks that demonstrably cannot be affected. Use the full suite for broad or uncertain changes, project-wide validation, or release checks. State what was verified.
- Keep documentation brief and operational; avoid duplicating implementation details or platform documentation.
- Maintain these rules when requirements change. Put shared requirements here and agent-only instructions in `AGENTS.md`.
