// Shared shapes for project/dashboard data returned by the `/api/projects`
// and `/api/installations` endpoints. Fields are optional where they only
// exist for one project kind (e.g. GitHub repos carry owner/repo).
export interface Project {
  id: string;
  name: string;
  type: 'github' | 'local';
  owner?: string;
  repo?: string;
  installationId?: string;
  access?: string;
  canDelete?: boolean;
  languages?: Record<string, number>;
}
