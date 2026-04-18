# Task

Traverse the given repository and analyze its contents, structure, and configuration related to deployment.

# Objective

Generate a comprehensive `project-profile.md` document that clearly outlines all deployment specifications required to successfully deploy the project to AWS.

## What You Must Find

For each category below, look for relevant files.
The examples listed are common ones, but every repository is different. If you encounter a file that clearly belongs to a category but isn't listed as an example, read it.

### 1. Project Directory Structure

Extract: The full directory tree of the repository to give downstream agents a clear picture of how the project is organized.

### 2. Language, Framework & Runtime
Identify what the project is built with.

Common sources: `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Cargo.toml`, `composer.json`, `mix.exs`, `pubspec.yaml`, `.tool-versions`, `.node-version`, `.python-version`, `.nvmrc`, `runtime.txt`, and their corresponding lockfiles.

Extract: languages, frameworks, runtime versions, key dependencies (production and development).

### 3. Infrastructure Definitions
Identify how the project is currently packaged and what infrastructure is already defined.

Common sources: `Dockerfile`, `docker-compose.yml`, `docker-compose.*.yml`, Kubernetes manifests (in `k8s/`, `kubernetes/`, `deploy/`, `manifests/`, or any directory containing `.yaml`/`.yml` with K8s resource kinds), `serverless.yml`, `template.yaml` (SAM), Terraform files (`*.tf`), Pulumi configs, Helm charts (`Chart.yaml`, `values.yaml`), `skaffold.yaml`, `Procfile`, `.ebextensions/`, `appspec.yml`, `buildspec.yml`, `nixpacks.toml`, `fly.toml`, `render.yaml`, `railway.json`, `vercel.json`, `netlify.toml`, and any other deployment platform configuration.

Extract: how the app is containerized, what services are defined, what infrastructure is codified.

### 4. Data Layer
Identify every database, cache, message broker, search engine, and object storage dependency.

Common sources: migration directories (`migrations/`, `db/migrate/`, `alembic/`, `prisma/`), ORM config files, database config files (`database.yml`, `ormconfig.*`, `redis.conf`), connection strings in environment templates, service definitions in docker-compose files.


### 5. Data Flow
Trace how data moves through the application — from ingestion points to storage and external outputs.

Read source code, configuration, and documentation to identify: API endpoints or event listeners that receive data, how data is processed or transformed between services, which databases/caches/queues data is written to and read from, external service integrations that send or receive data (third-party APIs, webhooks, email services, payment providers, etc.), and file upload/download flows.

Extract: a clear map of data ingress → processing → storage → egress for each major flow in the application.

### 6. Control Flow
Trace the application's execution paths — how requests are handled, how services communicate, and how background work is orchestrated.

Read source code, configuration, and documentation to identify: request lifecycle (entry point → middleware → routing → handlers → response), inter-service communication patterns, background job and task queue processing, scheduled tasks and cron jobs, authentication and authorization flow, and error handling and retry strategies.

Extract: a clear description of how the application processes requests, coordinates between services, and handles background work.

### 7. Environment & Secrets
Identify every environment variable the application expects and how secrets are managed.

Common sources: `.env.example`, `.env.sample`, `.env.template`, `.env.development`, `.env.production`, secret management references in config files (AWS Secrets Manager, Vault, SSM Parameter Store, SOPS, sealed-secrets).

Extract: full list of expected environment variables with any comments or default values, and the secrets management strategy.

#### **CRITICAL**: Never include actual secret values in the output. Record only the variable name, its purpose, and the file path where it was found. If a file contains real credentials, note the variable name and mark the value as [REDACTED].


### 8. Build, Test
Identify how the project is built, tested, and deployed.

Common sources: `Makefile`, `Rakefile`, `Taskfile.yml`, `justfile`, `turbo.json`, `nx.json`, `lerna.json`, `moon.yml`, build scripts in `scripts/` or `bin/`, `package.json` scripts section, `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `.circleci/config.yml`, `bitbucket-pipelines.yml`, `azure-pipelines.yml`.

Extract: build commands, test commands, deployment steps, pipeline stages, monorepo tooling.

### 9. Frontend & Static Assets
Identify frontend build tooling, output directories, and static asset handling.

Common sources: `webpack.config.*`, `vite.config.*`, `rollup.config.*`, `next.config.*`, `nuxt.config.*`, `astro.config.*`, `remix.config.*`, `angular.json`, `vue.config.js`, `svelte.config.*`, `tsconfig.json`, `tailwind.config.*`, `postcss.config.*`, static asset directories (`public/`, `static/`, `assets/`, `dist/`).

Extract: build tool, output directory, SSR vs static, asset pipeline.

### 10. Networking & Operational Profile
Identify how the application exposes itself and how it's observed.

Common sources: port definitions (in Dockerfiles, docker-compose, Procfiles, config files, environment templates), reverse proxy configs (`nginx.conf`, `Caddyfile`, `traefik.yml`), health check definitions, logging configuration, monitoring configuration (Prometheus, Grafana, Datadog, New Relic, Sentry), and APM setup files.

Extract: ports, health check paths, logging strategy, monitoring integrations.

### 11. Documentation & API Specifications
Read any documentation that describes how the project is deployed or operated, and any API contracts.

Common sources: `README.md`, `CONTRIBUTING.md`, `DEPLOYMENT.md`, `INSTALL.md`, `ARCHITECTURE.md`, `docs/` directory, `openapi.yaml`, `openapi.json`, `swagger.*`, `API.md`, `CHANGELOG.md`, `ADR/` (architecture decision records).

Extract: deployment instructions, architecture decisions, API surface area.

---

### Beyond These Categories

If you encounter files that don't fit neatly into the categories above but clearly contain information about how the project is built, configured, deployed, or operated — **read them and include your findings.** Create a new section in the output if necessary.

## Output Format

Write the project-profile.md file with the following structure. **Include a section only if you found relevant information. If a section has no findings, note "None detected" — but do not pad the document with empty sections.**
```markdown
# Repository Context Analysis

## Project Overview

## Project Directory Structure

## Dependencies
### Production Dependencies
### Development Dependencies

## Infrastructure
### Containerization

### Orchestration & Platform Configuration

### Infrastructure as Code

## Data Layer
### Databases
### Caches & Message Brokers
### Object Storage

## Data Flow
### Ingress Points
### Processing & Transformation
### Storage Operations
### Egress Points

## Control Flow
### Request Lifecycle
### Inter-Service Communication
### Background Processing
### Auth Flow

## Environment Configuration
### Required Environment Variables
### Secrets Management

## Build

## Frontend

## Networking & Operations
### Ports & Exposure
### Health Checks
### Logging
### Monitoring & Observability

## API Specifications

## Documentation Notes
(relevant deployment/architecture instructions)
```

If you discovered something that doesn't fit these sections, add your own section for it.

!!!
Rules

- Be thorough — every downstream agent depends on the accuracy and completeness of your analysis
- Read the ENTIRE directory tree before writing anything, so you don't miss files in unexpected locations
- **If you are uncertain whether a file is relevant, check its content briefly — if it contains useful deployment, configuration, or architectural information, read it fully**

!!!