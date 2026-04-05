# TASK

Your objective is to:

1. **Read the deployment architecture** from the provided `deployment.md` file
2. **Generate production-ready Terraform** that provisions the AWS infrastructure exactly as described

---

# External Tool Availability

You have direct access to the Terraform CLI via Bash.

---

# Knowledge Sources

## Terraform Registry (AWS)
- **Provides:** AWS resource schemas, arguments, attributes, and data sources  
- **Access:** Use the MCP server (registry tools for provider documentation and module lookups)

## Terraform Modules (AWS)
- **Provides:** Community and verified module search and inspection  
- **Access:** Use the MCP server (registry tools for module search)

## Terraform Language
- **Provides:** HCL syntax including blocks, expressions, functions, and meta-arguments  
- **Access:** Web search → https://developer.hashicorp.com/terraform/language

## Terraform CLI Commands
- **Provides:** Correct and up-to-date CLI command usage  
- **Access:** Web search → https://developer.hashicorp.com/terraform/cli/commands

## Terraform Debugging
- **Provides:** Debug logs and troubleshooting guidance  
- **Access:** Web search → https://developer.hashicorp.com/terraform/internals/debugging

## Terraform CLI Usage & Verification Guidelines
Before using any Terraform CLI command, always verify usage by:

- Running: `terraform <command> -help`, or  
- Searching: https://developer.hashicorp.com/terraform/cli/commands  


---

# Code Generation

## Module vs Raw HCL Decision

For EACH infrastructure component, decide module vs raw HCL:

**Step 1** — Count resources. How many AWS resources does this component need?

**Step 2** — If it has interconnected resources, search for a module on the registry.

**Step 3** — Validate the module:
- Published by `terraform-aws-modules`
- Significant community adoption
- Updated within last 12 months
- Supports your AWS provider version

If any check fails → raw HCL.

**Step 4** — Check module inputs/outputs match your needs. If not → raw HCL.

Every module call or resource block MUST have a comment explaining the choice. Pin module versions with `~>`.

### Output Files

All files go in `/workspace/deploy/terraform/`:

- **`provider.tf`** — AWS provider with version constraint, region from variable, default tags
- **`backend.tf`** — S3 backend with placeholder config (you pass values via `-backend-config` at init)
- **`variables.tf`** — Every configurable value, with type, description, default, validation. Sensitive vars marked `sensitive = true`
- **`main.tf`** — All resources and module calls, organized by dependency layer, locals block for shared naming
- **`outputs.tf`** — Downstream values (endpoints, ARNs, IDs) with descriptions

### Coding Standards

- **Naming:** All resources use `local.project_prefix`
- **Tagging:** Every taggable resource gets `local.common_tags` merged with resource-specific tags
- **Sensitive data:** Never hardcode secrets. Use variables with `sensitive = true` or SSM/Secrets Manager
- **Comments:** Explain WHY, not WHAT
- **Circular dependencies:** Break with `depends_on` or restructure. Never leave implicit circular refs.

---

# CLI Execution & Error Recovery Loop

After generating .tf files, you execute the full Terraform CLI cycle. If any step fails, you diagnose, fix, and retry — up to 3 attempts total.

```
STEP        COMMAND                   ON FAILURE
────        ───────                   ──────────
  1         terraform fmt             → Read error, fix formatting, retry
  2         terraform validate        → Parse error, fix config, retry
  3         terraform init            → Check provider, backend config; enable DEBUG logging if opaque
  4         terraform plan            → Follow Plan Failure Process below
  5         terraform apply           → Follow Apply Failure Process below
  6         terraform output -json    → Save to /workspace/deploy/terraform/outputs.json
```

## Init Command

```bash
terraform init \
  -backend-config="bucket=$TF_S3_BUCKET" \
  -backend-config="key=<STATE_KEY>/terraform.tfstate" \
  -backend-config="region=$AWS_DEFAULT_REGION" \
  -backend-config="encrypt=true"
```

The state key is provided in your task prompt. Environment variables are available at runtime.

## Plan Command

```bash
terraform plan -out=/workspace/deploy/terraform/terraform.plan
```

Stop after a successful plan during the generation phase. The runner handles cost estimation and user confirmation before you are called again for apply.

## Apply Command

```bash
terraform apply -auto-approve /workspace/deploy/terraform/terraform.plan
```

After successful apply:
```bash
terraform output -json > /workspace/deploy/terraform/outputs.json
```

---

# Plan Failure Process

When `terraform plan` fails:

1. **Parse the error output.** Extract:
   - File + line number
   - Resource address (e.g., `aws_instance.app`)
   - Error type (see Error Categories below)
   - Terraform's suggestion (if any — verify against docs before applying)

2. **Look up docs.** Check the knowledge store or fetch from approved sources.

3. **Fix the specific error** in the .tf file. Add a `# FIX:` comment explaining what changed and why.

4. **Re-run** `terraform fmt` → `terraform validate` → `terraform plan`.

5. If a new error appears, repeat from step 1.

6. If you cannot fix it after 3 attempts, report the full diagnostics and stop.

---

# Apply Failure & Partial State Process

Apply failures can leave infrastructure in a **partial state** — some resources created, others failed.

1. **Parse the apply output.** Identify which resources succeeded and which failed.

2. **Check current state:**
   ```bash
   terraform state list
   ```
   Compare against the intended plan to identify the gap.

3. **Fix the failing resource** based on the error. Do NOT modify resources already in state — they are real infrastructure.

4. **Re-plan and re-apply:**
   ```bash
   terraform plan -out=/workspace/deploy/terraform/terraform.plan
   terraform apply -auto-approve /workspace/deploy/terraform/terraform.plan
   ```
   The re-plan should show only the failed resource(s) as changes.

5. After successful apply, save outputs:
   ```bash
   terraform output -json > /workspace/deploy/terraform/outputs.json
   ```

6. If you cannot fix it after 3 attempts, report the full diagnostics and stop.

---

# Debug Logging

When error messages are insufficient, enable Terraform debug logging:

```bash
TF_LOG=DEBUG terraform <command>
```

Use `TRACE` for maximum verbosity (every API call, state op, dependency resolution). Capture the output, diagnose, then run the command again normally.

---

# Fix Rules

1. **Surgical changes only.** Fix the specific error, not surrounding code.
2. **Preserve architectural intent.** Don't change instance types, counts, or design decisions unless the error demands it.
3. **Every change must be doc-verified.** Never guess at argument names or values.
4. **Document every fix** with a `# FIX:` comment.
5. **Never delete or rename resources already in state** — that breaks real infrastructure.
6. If Terraform suggests "Did you mean..." or "Use ... instead", verify the suggestion against docs before applying.

---

# Environment Variables (available at runtime)

- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` 
- `AWS_DEFAULT_REGION` 
- `TF_S3_BUCKET` 

You do NOT hardcode these. They are injected into your environment.