# TASK

## Your Objective

Using the `context.md` and `answers.json`, generate a comprehensive **deployment.md** file that maps every detected component to its corresponding AWS service with full configuration details.

## **VERY IMPORTANT** Research First, Architect Second

Before making any architecture decisions, use web search tools to verify current AWS services. You MUST restrict your research to:
- `https://docs.aws.amazon.com`
- `https://github.com/awsdocs`

## Output Structure

Below is a **catalogue** of sections your deployment.md can draw from. Not every project needs every section.

**Include a section only if the project genuinely requires it. Skip anything that doesn't apply.**

### Application Classification
- Type (containerized, serverless, static site, microservices, hybrid, etc.)
- Justification for the classification

### Compute Strategy
Map application components to appropriate AWS compute services (EC2, ECS Fargate, EKS, Lambda, Lightsail, App Runner, S3 + CloudFront, etc.) with full configuration details: instance types, task definitions, runtime settings, memory, scaling.

### Networking
VPC design, subnets (public/private), load balancers (ALB/NLB), security groups, port mappings, and any relevant networking constructs (Transit Gateway, PrivateLink, etc.).

### Data Layer
Map every detected data store to an AWS service (RDS, DynamoDB, ElastiCache, S3, OpenSearch, Amazon MQ, MSK, etc.) with engine, capacity, replication, and storage configuration.

### Build & Deployment Pipeline
Build commands, artifact storage (ECR, S3), CI/CD pipeline design (CodePipeline, GitHub Actions, etc.), deployment strategy (blue/green, rolling, canary), and approval gates.

### Runtime Configuration
Environment variable mapping, secrets management (SSM Parameter Store vs Secrets Manager), and configuration file injection strategy.

### Security
IAM roles and policies, SSL/TLS (ACM), WAF, VPC endpoints, and any service-specific security configuration.

### Operational Profile
Health checks, CloudWatch logging and metrics, alarms, dashboards, scaling policies, and resource sizing recommendations.

---

### Beyond the Catalogue

The catalogue above provides a starting reference, it's not a boundary. Based on what you discover in `context.md`, `answers.json`, and your AWS documentation research, add additional sections for any services or patterns the project requires. 


Examples:

- Workflow Orchestration (Step Functions, EventBridge Scheduler)
- Event-Driven Architecture (EventBridge, SNS, SQS, dead-letter queues)
- Content Delivery & Edge (CloudFront distributions, Lambda@Edge)
- DNS & Domain Management (Route 53)
- Disaster Recovery (backup strategy, cross-region replication, RTO/RPO)
- Cost Management (Reserved Instances, Savings Plans, budget alarms)
- Data Pipelines (Kinesis, Glue, Athena)
- ML/AI Services (SageMaker, Bedrock, Rekognition)
- Migration-Specific Concerns (DMS, Schema Conversion Tool)
- etc ... 

These examples exist to broaden your thinking, not to define your boundaries. Always let the project's actual needs dictate what you include.

!!!
Rules

- Use `answers.json` to resolve any ambiguity
- Follow AWS Well-Architected principles
- If `context.md` reveals something the user didn't address, make a sensible default
- Do not omit a relevant service just because it lacks a predefined section — create one
!!!

## Output

Write the complete deployment.md file to the specified output path.




