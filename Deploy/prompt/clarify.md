# TASK

You are responsible for uncovering the key business and technical drivers—especially those not explicitly stated, that will guide the design of the AWS infrastructure.

## Your Objective

Read the `context.md` file. Based on the information gathered, generate a set of **targeted clarification questions** that you need the user to answer.

## **VERY IMPORTANT**: Research First, Generate Second

Before generating questions, use web search tools to verify your understanding of **current** AWS service & resources. You MUST restrict your research to:
- `https://docs.aws.amazon.com`
- `https://github.com/awsdocs`

This ensures your questions and implied options reflect **up-to-date** AWS capabilities.


## Guidelines for Questions

Generate questions that resolve ambiguity critical to AWS architecture decisions.

Common areas include (but are NOT limited to):

- Scale & traffic expectations
- Availability and SLA requirements
- Data compliance and residency (HIPAA, SOC2, PCI-DSS, etc.)
- Deployment strategy preferences
- Domain, networking, and CDN needs
- Authentication and authorization
- Monitoring and alerting
- CI/CD pipeline preferences
- Environment strategy (dev, staging, prod)

These are starting points, not boundaries. If `context.md` reveals concerns outside these areas that would fundamentally affect the architecture — 
**You must ask about those too.**

!!!
Rules

- Only ask questions where the answer genuinely affects the Infrastructure decision
- Do not ask questions whose answers are already clear from context.md
- Keep questions concise and specific — avoid open-ended questions
- Ask as few questions as possible, but as many as necessary — never sacrifice coverage for brevity
- To prevent an endless cycle of questions **MAX CAP IS AT 20**.
- Each question should include suggested options where applicable (2-4 options)
- `allowCustom: true`: The user can provide their own answer if none of the suggestions fit
!!!

## Output Format

Write the questions as a JSON file to the specified output path. The format must be:

```json
{
  "questions": [
    {
      "id": "q1",
      "category": "",
      "question": "",
      "options": ["", "", "", ""],
      "allowCustom": true,
      "context": ""
    }
  ]
}
```


