# TASK

Your objective is to generate production-ready Terraform to provision and deploy AWS infrastructure in the cloud.

---

# External Tool Availability

You have direct access to:
- **Terraform CLI** via Bash
- **AWS CLI v2** via Bash (pre-authenticated)
- **Firecrawl MCP** 

---

# A Practical Framework for Writing Accurate Terraform Code

Producing reliable Terraform requires three complementary components.
Each answers a different question, and none is sufficient on its own.

1. The Terraform AWS Provider Registry defines the structure of a resource. It tells you which arguments and attributes exist, and how a resource or data source is organized.

2. The AWS documentation explains what values are valid for those arguments in general.

3. The AWS CLI shows what is actually available in the target account and region at the moment. It allows you to verify existing resources ensuring that the values you choose are usable in practice.

Used together, these three components eliminate guesswork and help ensure that your Terraform configurations are valid, deployable, and up to date.


## Whitelisted Sources (STRICT)

You must retrieve information **only** from the following Web sources:

1. **Primary**
- `https://registry.terraform.io/providers/hashicorp/aws/latest/docs` (Terraform AWS Provider Registry)
- `https://docs.aws.amazon.com/` (AWS documentation)

2. **Secondary**
- `https://developer.hashicorp.com/terraform` (HashiCorp Terraform Documentation)
This source is intended to support you whenever you encounter something in Terraform that you don’t fully understand.

### Method of Access

Use the `firecrawl_crawl` tool to retrieve and navigate content from these sources.

---

# WORKFLOW

## Phase 1: Research & Analysis

This phase must be completed in full before any Terraform code is generated.

### Step 1: Requirement Analysis

Begin by reviewing the repository context in `project-profile.md` and the question–answer pairs in `QnA.json`

Identify:

- The infrastructure requirements implied by each question and corresponding answer
- The explicit decisions that have already been defined  

### Step 2: Source Exploration & Documentation

Based on insights from the previous step, crawl through the **Entire** primary source 
- Determine which AWS services and resources are required
- For every AWS resource, service, or module you choose to use to generate Terraform, extract the relevant documentation and write it to the knowledge store

At the same time, these design choices are validated against the actual state of the target AWS account using read-only AWS CLI queries.

#### Knowledge Store

A persistent knowledge store is available at `/workspace/deploy/AWS Infra/`.
Phase 2 reads from it while authoring Terraform.

1. Naming Convention:
   ```
   <resource_name>.md
   ```
2. Reference that stored content while authoring the Terraform for that resource.


## Phase 2 — Generate code
 
### File layout (required)
- `provider.tf` — AWS provider, version constraint, region from variable, default tags
- `backend.tf` — S3 backend with placeholder config (values via `-backend-config`)
- `variables.tf` — every configurable value with `type`, `description`, `default`, `validation`; sensitive vars marked `sensitive = true`
- `outputs.tf` — downstream values (endpoints, ARNs, IDs) with descriptions; never expose secrets
- `locals.tf` — `local.project_prefix`, `local.common_tags`
Split remaining resources into files by logical layer (`network.tf`,`compute.tf`, `data.tf`, `iam.tf`, etc.). No monolithic `main.tf`.
 
## Phase 3: Execution

Once the Terraform configuration files are generated, the workflow moves into execution.

The process begins with initialization

```bash
terraform init \
  -backend-config="bucket=$TF_S3_BUCKET" \
  -backend-config="key=<STATE_KEY>/terraform.tfstate" \
  -backend-config="region=$AWS_DEFAULT_REGION" \
  -backend-config="encrypt=true"
```

The state key will be provided to you. Environment variables are available at runtime.

Next `terraform fmt` ensures consistent formatting, followed by `terraform validate` to detect syntax or structural issues. 
- Any errors must be resolved before continuing.

The process then proceeds to executing the plan command
```bash
terraform plan -out=terraform.plan
```
Stop after a successful plan. Wait for user confirmation before proceeding.
Once approved, the plan is applied:

```bash
terraform apply -auto-approve terraform.plan
```

After successful apply:
```bash
terraform output -json > outputs.json
```

---

# Handling Failures

## Failures from external tools

- If Firecrawl MCP is unavailable after multiple retries, **terminate the process immediately**. Do not proceed without access, as it is critical for accurate Terraform generation.

- If there is any confusion about how to use the AWS or Terraform CLI, refer to the documentation listed under `Whitelisted Sources`.

## Failure in Terraform Plan or Apply

When a failure occurs during the plan phase, the error output is analyzed to determine the root cause, whether it stems from syntax errors, invalid arguments, or unsupported resource attributes. The configuration is then corrected, often by consulting the relevant Terraform or provider documentation, and the plan is re-run until it succeeds.

Failures during the apply phase require more careful handling, since Terraform may have already provisioned some resources before the error occurred. In this scenario, the current infrastructure state is reviewed to understand what was successfully created and what remains outstanding. The root cause is then addressed in the configuration, and the apply is re-executed, allowing Terraform to reconcile the actual state with the desired state incrementally.

In both cases, the process follows an iterative cycle: diagnose the error, update the configuration, and re-run the relevant command. 

If the issue persists after 3 attempts, **terminate the process**.