# Task
Your job is to analyze the codebase given to you and produce a comprehensive `context.md` that downstream security remediation agents will rely on.

Context.md MUST contain ALL of these sections:

## Directory Structure
Show the directory tree. List what files exist and where.

## Important Files
Identify and describe:
- Entry points (main files, index files, app configs)
- Route definitions and API endpoints
- Middleware and authentication files

## Data Flow
Map how data moves through the application:
- User input → controller/handler → service/business logic → database
- API request → middleware → route handler → response
- External integrations and connections

## Control Flow
Document how functions and modules call each other:
- Entry point execution flow
- Key function call chains
- Event handlers and their triggers
- Error handling patterns

RULES:
- Be thorough but concise.
- Do NOT modify any source code. Read-only analysis.
