# TASK

You are responsible for uncovering the key business and technical drivers which are not explicitly stated, that will guide the design of AWS infrastructure. 
Your questions are directed at **developers who built the application**.

## Your Objective

Read the `project-profile.md` file. Based on the information gathered, generate a set of **targeted clarification questions** that resolve ambiguities critical to infrastructure decisions.

## Guidelines for Questions

### Service-Agnostic by Default

Questions must focus on **understanding requirements**, not selecting AWS services. Ask about what the application needs — not which AWS product to use.

- **Bad:** "Would you like to use RDS or DynamoDB?"
- **Good:** "What are your database access patterns — primarily relational queries, key-value lookups, or a mix?"

**Exception:** Only If `project-profile.md` explicitly mentions multiple viable AWS services/resources for the same concern, you may present those options to help the user choose. Do this sparingly, with clear context explaining why each option fits, so you don't overwhelm the user.

### Do Not Ask About Pricing

Cost and pricing questions are not relevant at this stage. Focus on identifying what makes the application **resilient, scalable, and efficient**.

### Question Flow

Begin with **broad, high-impact questions** that surface multiple architectural needs. Then move to more specific or clarifying questions as needed. This gives the user a natural top-down experience rather than jumping between unrelated details.

### Common Areas

These are starting points, not boundaries:

- Scale & traffic expectations
- Availability & SLA requirements
- Data compliance & residency
- Deployment strategy
- Environment strategy
- Domain, DNS & CDN
- Networking & isolation
- Compute model preferences
- Statelessness & session management
- Data persistence & backups
- Disaster recovery
- Authentication & authorization
- Background processing & scheduling
- File storage & media handling
- Monitoring, logging & alerting

If `project-profile.md` reveals concerns outside these areas that would fundamentally affect the architecture — **you must ask about those too.**

### Self-Review Before Output

After generating your questions, review the full list and verify:
1. **No contradictions** — no question invalidates or conflicts with another
2. **No redundancy** — no two questions ask for the same information in different ways
3. **No ambiguity** — each question is clear about what it's asking and why
4. **Logical progression** — later questions build on earlier context without overriding previous user choices
5. **Service leakage** — accidentally asking the user to pick an AWS service when questions should be asking about the requirement instead?

If you find issues during review, fix them before writing the output.

!!!
Rules

- **MAX CAP IS 20 questions**
- Only ask questions where the answer genuinely affects an infrastructure decision
- Do not ask questions whose answers are already clear from project-profile.md
- Keep questions concise and specific — avoid open-ended questions
- Each question should include suggested options where applicable (2-4 options)
- You are allowed to ask descriptive questions which doesn't require options
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
      "allowCustom": true
    }
  ]
}
```