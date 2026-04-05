# TASK

Traverse the repository given to you and generate a comprehensive **context.md** document that maps out the project's deployment specifications.

## STRICT PROHIBITION

**You must NOT read, parse, or infer from application source code.** Application source code includes files like `.js`, `.ts`, `.py`, `.go`, `.java`, `.rb`, `.rs`, `.c`, `.cpp`, `.cs`, `.swift`, `.kt`, and similar runtime code files.

**You ARE allowed to read any file that describes how the application is built, configured, deployed, or operated.** This includes (but is not limited to) configuration files, manifest files, infrastructure definitions, dependency lockfiles, environment templates, build scripts, CI/CD pipelines, documentation, and API specifications.

When in doubt, apply this test: **"Does this file describe what the app needs or how it runs, rather than what the app does?"** 

## What You Must Find

For each category below, look for relevant files — the examples listed are common ones, but every repository is different. If you encounter a file that clearly belongs to a category but isn't listed as an example, read it.

### 1. Language, Framework & Runtime
Identify what the project is built with.

Common sources: `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Cargo.toml`, `composer.json`, `mix.exs`, `pubspec.yaml`, `.tool-versions`, `.node-version`, `.python-version`, `.nvmrc`, `runtime.txt`, and their corresponding lockfiles.

Extract: languages, frameworks, runtime versions, key dependencies (production and development).

### 2. Containerization & Infrastructure Definitions
Identify how the project is currently packaged and what infrastructure is already defined.

Common sources: `Dockerfile`, `docker-compose.yml`, `docker-compose.*.yml`, Kubernetes manifests (in `k8s/`, `kubernetes/`, `deploy/`, `manifests/`, or any directory containing `.yaml`/`.yml` with K8s resource kinds), `serverless.yml`, `template.yaml` (SAM), Terraform files (`*.tf`), Pulumi configs, Helm charts (`Chart.yaml`, `values.yaml`), `skaffold.yaml`, `Procfile`, `.ebextensions/`, `appspec.yml`, `buildspec.yml`, `nixpacks.toml`, `fly.toml`, `render.yaml`, `railway.json`, `vercel.json`, `netlify.toml`, and any other deployment platform configuration.

Extract: how the app is containerized, what services are defined, what infrastructure is codified.

### 3. Data Layer
Identify every database, cache, message broker, search engine, and object storage dependency.

Common sources: migration directories (`migrations/`, `db/migrate/`, `alembic/`, `prisma/`), ORM config files, database config files (`database.yml`, `ormconfig.*`), `redis.conf`, connection strings in environment templates, and service definitions in docker-compose files.

Extract: which data stores are used, their versions if detectable, replication or clustering hints, and migration tooling.

### 4. Environment & Secrets
Identify every environment variable the application expects and how secrets are managed.

Common sources: `.env.example`, `.env.sample`, `.env.template`, `.env.development`, `.env.production`, secret management references in config files (AWS Secrets Manager, Vault, SSM Parameter Store, SOPS, sealed-secrets).

Extract: full list of expected environment variables with any comments or default values, and the secrets management strategy.

### 5. Build, Test & CI/CD
Identify how the project is built, tested, and deployed.

Common sources: `Makefile`, `Rakefile`, `Taskfile.yml`, `justfile`, `turbo.json`, `nx.json`, `lerna.json`, `moon.yml`, build scripts in `scripts/` or `bin/`, `package.json` scripts section, `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `.circleci/config.yml`, `bitbucket-pipelines.yml`, `azure-pipelines.yml`, and any CI/CD configuration.

Extract: build commands, test commands, deployment steps, pipeline stages, monorepo tooling.

### 6. Frontend & Static Assets
Identify frontend build tooling, output directories, and static asset handling.

Common sources: `webpack.config.*`, `vite.config.*`, `rollup.config.*`, `next.config.*`, `nuxt.config.*`, `astro.config.*`, `remix.config.*`, `angular.json`, `vue.config.js`, `svelte.config.*`, `tsconfig.json`, `tailwind.config.*`, `postcss.config.*`, static asset directories (`public/`, `static/`, `assets/`, `dist/`).

Extract: build tool, output directory, SSR vs static, asset pipeline.

### 7. Networking & Operational Profile
Identify how the application exposes itself and how it's observed.

Common sources: port definitions (in Dockerfiles, docker-compose, Procfiles, config files, environment templates), reverse proxy configs (`nginx.conf`, `Caddyfile`, `traefik.yml`), health check definitions, logging configuration, monitoring configuration (Prometheus, Grafana, Datadog, New Relic, Sentry), and APM setup files.

Extract: ports, health check paths, logging strategy, monitoring integrations.

### 8. Documentation & API Specifications
Read any documentation that describes how the project is deployed or operated, and any API contracts.

Common sources: `README.md`, `CONTRIBUTING.md`, `DEPLOYMENT.md`, `INSTALL.md`, `ARCHITECTURE.md`, `docs/` directory, `openapi.yaml`, `openapi.json`, `swagger.*`, `API.md`, `CHANGELOG.md`, `ADR/` (architecture decision records).

Extract: deployment instructions, architecture decisions, API surface area.

---

### Beyond These Categories

If you encounter files that don't fit neatly into the categories above but clearly contain information about how the project is built, configured, deployed, or operated — **read them and include your findings.** Create a new section in the output if necessary.

## Output Format

Write the context.md file with the following structure. **Include a section only if you found relevant information. If a section has no findings, note "None detected" — but do not pad the document with empty sections.**
```markdown
# Repository Context Analysis

## Project Overview
- **Primary Language(s):**
- **Framework(s):**
- **Runtime Version(s):**
- **Project Type:** (monorepo / single app / microservices)

## Dependencies
### Production Dependencies
(key dependencies with versions)

### Development Dependencies
(key dev dependencies)

## Infrastructure
### Containerization
(Dockerfile details, docker-compose services)

### Orchestration & Platform Configuration
(Kubernetes, ECS, serverless, PaaS configs)

### Infrastructure as Code
(Terraform, Pulumi, CloudFormation, CDK)

## Data Layer
### Databases
(types detected, versions, migration tooling)

### Caches & Message Brokers
(Redis, RabbitMQ, Kafka, etc.)

### Object Storage
(S3 references, file upload patterns)

## Environment Configuration
### Required Environment Variables
(full list from env templates)

### Secrets Management
(strategy and references)

## Build & CI/CD
### Build Commands & Scripts
(from Makefile, package.json scripts, monorepo tooling, etc.)

### CI/CD Pipelines
(existing pipeline details)

## Frontend
### Build Tool & Configuration
### Output Directory
### Static Assets

## Networking & Operations
### Ports & Exposure
### Health Checks
### Logging
### Monitoring & Observability

## API Specifications
(OpenAPI/Swagger details if present)

## Documentation Notes
(relevant deployment/architecture instructions)
```

If you discovered something that doesn't fit these sections, add your own section for it.

!!!
Rules

- Be thorough — every downstream agent depends on the accuracy and completeness of your analysis
- Read the ENTIRE directory tree before writing anything, so you don't miss files in unexpected locations
- When listing file findings, include the file path so downstream agents can reference the source
- **If you are uncertain whether a file is configuration or source code, check its content briefly — if it primarily defines configuration, settings, or infrastructure, read it fully**
!!!
