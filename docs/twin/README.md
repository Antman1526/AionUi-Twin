# AionUi Twin Documentation Index

Last updated: 2026-06-10.

This folder is the local, downloadable reconstruction pack requested for
`/Users/Antman/Desktop/AionUi_TWIN/AionUi-Twin-main`. It is stored inside the
project so the same documents are available locally and after pushing to GitHub.

## Reconstruction Set

1. [Project Overview and Architecture](01-project-overview-architecture.md)
2. [Environment Setup and Dependencies](02-environment-setup-dependencies.md)
3. [Database Schema and Data Models](03-database-schema-data-models.md)
4. [Backend API Specifications](04-backend-api-specifications.md)
5. [Frontend Architecture and Components](05-frontend-architecture-components.md)
6. [Authentication and Authorization](06-authentication-authorization.md)
7. [Business Logic and Core Algorithms](07-business-logic-core-algorithms.md)
8. [Integration Points and External Services](08-integration-points-external-services.md)
9. [Configuration and Environment Variables](09-configuration-environment.md)
10. [Testing Strategy and Test Cases](10-testing-strategy-test-cases.md)
11. [Build and Deployment Pipeline](11-build-deployment-pipeline.md)
12. [Error Handling and Logging](12-error-handling-logging.md)
13. [Performance Optimization and Caching](13-performance-optimization-caching.md)
14. [Security Implementation and Best Practices](14-security-implementation.md)
15. [File Structure and Code Organization](15-file-structure-code-organization.md)

## AI Review Pack

- [AI Review Page 1: Overview and Architecture](ai-review-page-1-overview.md)
- [AI Review Page 2: Key Code Walkthrough and Data Flow](ai-review-page-2-code-data-flow.md)
- [AI Review Page 3: Pain Points and Areas for Review](ai-review-page-3-pain-points.md)

## Audit

- [Technology Audit](technology-audit.md)
- [SkillOpt Integration Notes](../integrations/skillopt.md)

## How To Use This Set

Start with documents 1, 2, 3, 4, 5, and 15 to understand the shape of the system. Use the AI review pack when asking another model for optimization/refactoring ideas. Use the technology audit to understand every meaningful technology, framework, library, service, and tool detected from package manifests, configs, source structure, scripts, and workflows.

For local model behavior, read documents 1, 4, 7, 8, 9, 10, 11, and 14 together.
The managed GGUF flow crosses renderer settings, IPC contracts, llama.cpp process
management, provider persistence, model selection, packaging assumptions, and
security boundaries.

For agent skill optimization behavior, read document 8, document 10, and
`docs/integrations/skillopt.md` together. The packaged `skillopt-sleep` skill is
an optional workflow skill, not a vendored Python runtime.
