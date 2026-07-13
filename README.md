# DeplAI 

## About

**DeplAI** is an intellectual property of CoCreate Ventures, developed to bridge the growing gap between deployment operations and cybersecurity within modern software engineering workflows.

The original DeplAI served as the foundational framework for this project, providing the core architectural vision. It also draws inspiration from **Abhaya**, CoCreate Ventures' proprietary penetration testing platform.

DeplAI aims to replicate and automate security validation processes that were traditionally performed manually using Abhaya. By leveraging agentic AI, the platform performs tasks that previously required dedicated security engineers operating standalone penetration testing tools.

> Disclaimer: This repository contains the **Pilot Version** of DeplAI. It is intended for evaluation, experimentation, and development.

---

# Tech Stack

| Frontend | Backend | AI & Agents | Infrastructure & DevOps | Data & Integration |
| --- | --- | --- | --- | --- |
| Next.js (App Router) | Python 3.12 | Claude — Agent SDK & Claude Code CLI | Docker & Docker Compose | MySQL |
| React 19 | FastAPI | Model Context Protocol (MCP) | AWS (S3, IAM) | GitHub App |
| TypeScript | Uvicorn (ASGI) | Firecrawl (web research) | Terraform | Octokit |
| Tailwind CSS 4 | WebSockets | | Nginx | Anthropic API |
| Framer Motion / GSAP / OGL | Pydantic v2 | | Ngrok | Firecrawl API |
| iron-session | Docker SDK | | Bearer · Syft · Grype | Infracost API |
| | WeasyPrint / Jinja2 | | Infracost · AWS CLI v2 | |

---

# Platform

The platform consists of four core services:

## 1. Connector (Frontend)

The Connector serves as the primary user interface for the platform.

### Features

* Connects to GitHub repositories
* Supports local project uploads
* Handles authentication and authorization
* Provides project dashboards
* Maintains real-time communication with backend services
* Acts as the central coordination layer between users and platform services



## 2. Security Service

The Security Service performs automated security analysis and remediation.

### Features

* Scans source code and dependencies for vulnerabilities
* Uses:

  * Bearer
  * Syft
  * Grype
* Automatically remediates issues using AI agents
* Publishes fixes back to GitHub as:

  * Pull Requests
  * New repositories



## 3. Customization Service

The Customization Service enables AI-assisted codebase modifications.

### Features

* Chat-based interface for code customization
* Uses a **Styler Agent** to modify code
* Uses a **Builder Agent** to verify successful builds after changes
* Supports iterative codebase personalization
* Live Frontend Preview



## 4. Deployment Service

The Deployment Service automates cloud infrastructure provisioning and application deployment.

### Features

* Deploys applications to AWS using Terraform
* Analyzes project requirements
* Conducts deployment requirement Q&A
* Generates Terraform infrastructure code
* Provides infrastructure cost estimates
* Deploys cloud resources automatically

---

# Prerequisites

Before running the project, install the following:

## Docker Desktop

Install Docker Desktop for your operating system.

---

## MySQL Setup

### Step 1: Install MySQL

### Step 2: Create Database Schema

1. Open **MySQL Command Line Client**
2. Execute the contents of:

```sql
Connector/database.sql
```

---

# Ngrok Setup

## Step 1: Create an Account

## Step 2: Install Ngrok

Follow the installation instructions for your operating system from the website.

Verify installation:

```bash
ngrok version
```

## Step 3: Configure Authentication

Add your authentication token:

```bash
ngrok config add-authtoken "<YOUR_AUTHTOKEN>"
```

## Step 4: Start Tunnel

```bash
ngrok http 3000
```

## Step 5: Copy the Forwarding URL



---

# GitHub App Configuration

Create a GitHub App and configure it as follows.

## Basic Information

### App Details

| Setting      | Value                                           |
| ------------ | ----------------------------------------------- |
| Homepage URL | http://localhost:3000                           |
| Callback URL | http://localhost:3000/api/auth/callback         |
| Callback URL | http://localhost:3000/api/auth/publish-callback |

Enable:

* Request user authorization (OAuth) during installation
* Webhooks

### Webhook URL

Set the webhook URL to your ngrok forwarding URL.


---

## Permissions

### Repository Permissions

| Permission     | Access               |
| -------------- | -------------------- |
| Administration | Read & Write         |
| Contents       | Read & Write         |
| Metadata       | Read Only (Required) |
| Pull Requests  | Read & Write         |
| Webhooks       | Read Only            |

### Account Permissions

| Permission      | Access    |
| --------------- | --------- |
| Email Addresses | Read Only |

---

## Subscribe to Events

Enable:

* Installation Target
* Pull Request
* Push
* Repository

---

# AWS Configuration

1. Create or log in to an AWS account.
2. Navigate to IAM.
3. Create a new user/group.
4. Grant permissions required for Terraform deployments.

---

# Environment Variables

---

## Connector/.env.local

```env
# Database
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=DeplaiDB

# GitHub App
GITHUB_APP_ID=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_WEBHOOK_SECRET=

GITHUB_PRIVATE_KEY=

# App Config
NEXT_PUBLIC_APP_URL=http://localhost:3000
API_URL=http://localhost:3000

SESSION_SECRET=

# Shared Service Authentication
DEPLAI_SERVICE_KEY=
```

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Use the command for:

* GITHUB_WEBHOOK_SECRET
* SESSION_SECRET
* DEPLAI_SERVICE_KEY

---

## Customization/.env

```env
DEPLAI_SERVICE_KEY=<Copy from Connector>

HOST_PROJECTS_DIR=<your-project-root>/DeplAI/Connector/tmp/local-projects

ANTHROPIC_API_KEY=
```

### Example

```text
R:/PES/PVL/DeplAI/Connector/tmp/local-projects
```

Replace with your own local path.

---

## Deploy/.env

```env
DEPLAI_SERVICE_KEY=<Copy from Connector>

HOST_PROJECTS_DIR=<your-project-root>/DeplAI/Connector/tmp/local-projects

ANTHROPIC_API_KEY=

# Firecrawl
FIRECRAWL_API_KEY=

# AWS
TF_S3_BUCKET=deplai-demo
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_DEFAULT_REGION=us-east-1

# Infracost
INFRACOST_API_KEY=
```

---

## Security/.env

```env
DEPLAI_SERVICE_KEY=<Copy from Connector>

HOST_PROJECTS_DIR=<your-project-root>/DeplAI/Connector/tmp/local-projects

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

ANTHROPIC_API_KEY=
FIRECRAWL_API_KEY=
```

---

# Running the Connector

## Section 1: First-Time Setup

### Update Dashboard

Open the following file:

```text
Connector/src/app/webpages/dashboard/dashboard.tsx
```

Update:

* Line 246
* Line 278

With your Github App URL

### Terminal 1: Start Ngrok (Once Only)

Start ngrok in a dedicated terminal. This only needs to run once:

```bash
ngrok http 3000
```

### Terminal 2: Start the Connector

Navigate to the Connector directory:

```bash
cd Connector
```

Install dependencies:

```bash
npm install
```

Start the application:

```bash
npm run dev
```

### Authenticate with GitHub

1. Open `http://localhost:3000` in your browser.
2. Sign in using the configured GitHub App.
3. Verify that repositories can be accessed from the dashboard.
4. Confirm that webhook events are being received through the ngrok forwarding URL.

Once authentication is successful, the Connector is ready to communicate with the Security, Customization, and Deployment services.

---

## Section 2: Subsequent Runs

```bash
ngrok http 3000
```

```bash
cd Connector
npm run dev
```

Open `http://localhost:3000` in your browser to access the application.

---

# Running Backend Services

Start each backend service from its respective directory.

## Customization Service

```bash
cd Customization
docker-compose up --build
```

## Deployment Service

```bash
cd Deploy
docker-compose up --build
```

## Security Service

```bash
cd Security
docker-compose up --build
```

---
