import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

const LOCAL_PROJECTS_BASE = path.join(process.cwd(), 'tmp', 'local-projects');

function ensureBaseDirectory() {
  if (!fs.existsSync(LOCAL_PROJECTS_BASE)) {
    fs.mkdirSync(LOCAL_PROJECTS_BASE, { recursive: true });
  }
}

export function getProjectPath(userId: string, projectId: string): string {
  return path.join(LOCAL_PROJECTS_BASE, userId, projectId);
}

export function getZipPath(userId: string, projectId: string): string {
  return path.join(LOCAL_PROJECTS_BASE, userId, `${projectId}.zip`);
}

function validatePath(projectPath: string, requestedPath: string): string {
  const fullPath = path.join(projectPath, requestedPath);
  const normalizedPath = path.normalize(fullPath);

  if (!normalizedPath.startsWith(projectPath)) {
    throw new Error('Invalid path: directory traversal detected');
  }
  
  return normalizedPath;
}

function getDirectoryStats(dirPath: string): { size: number; fileCount: number } {
  let totalSize = 0;
  let fileCount = 0;

  function traverse(currentPath: string) {
    const items = fs.readdirSync(currentPath, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(currentPath, item.name);
      
      if (item.isDirectory()) {
        traverse(fullPath);
      } else if (item.isFile()) {
        totalSize += fs.statSync(fullPath).size;
        fileCount++;
      }
    }
  }

  traverse(dirPath);
  return { size: totalSize, fileCount };
}

export async function extractZipToProject(
  zipBuffer: Buffer,
  userId: string,
  projectId: string
): Promise<{ path: string; fileCount: number; sizeBytes: number }> {
  ensureBaseDirectory();

  const projectPath = getProjectPath(userId, projectId);
  const zipFilePath = getZipPath(userId, projectId);

  fs.rmSync(projectPath, { recursive: true, force: true });
  fs.mkdirSync(projectPath, { recursive: true });

  try {
    fs.writeFileSync(zipFilePath, zipBuffer);

    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();

    const topLevelItems = new Set<string>();
    for (const entry of zipEntries) {
      const firstPart = entry.entryName.split('/')[0];
      if (firstPart) topLevelItems.add(firstPart);
    }

    const rootFolder = topLevelItems.size === 1 ? Array.from(topLevelItems)[0] : null;

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;

      let relativePath = entry.entryName;
      if (rootFolder && relativePath.startsWith(rootFolder + '/')) {
        relativePath = relativePath.substring(rootFolder.length + 1);
      }

      const targetPath = path.join(projectPath, relativePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, entry.getData());
    }

    const stats = getDirectoryStats(projectPath);

    return {
      path: path.join(userId, projectId),
      fileCount: stats.fileCount,
      sizeBytes: stats.size,
    };
  } catch (error: any) {
    fs.rmSync(projectPath, { recursive: true, force: true });
    fs.rmSync(zipFilePath, { force: true });
    throw new Error(`Failed to extract zip: ${error.message}`);
  }
}

export function deleteProject(userId: string, projectId: string): void {
  fs.rmSync(getProjectPath(userId, projectId), { recursive: true, force: true });
  fs.rmSync(getZipPath(userId, projectId), { force: true });

  const userDir = path.join(LOCAL_PROJECTS_BASE, userId);
  if (fs.existsSync(userDir) && fs.readdirSync(userDir).length === 0) {
    fs.rmSync(userDir, { recursive: true, force: true });
  }
}

export function getDirectoryContents(
  userId: string,
  projectId: string,
  dirPath: string = ''
): Array<{ name: string; path: string; type: 'dir' | 'file'; size: number | null }> {
  const projectPath = getProjectPath(userId, projectId);
  const fullPath = validatePath(projectPath, dirPath);

  if (!fs.existsSync(fullPath)) {
    throw new Error('Path does not exist');
  }

  const items = fs.readdirSync(fullPath, { withFileTypes: true });

  return items
    .filter(item => !item.name.startsWith('.'))
    .map(item => ({
      name: item.name,
      path: path.join(dirPath, item.name).replace(/\\/g, '/'),
      type: (item.isDirectory() ? 'dir' : 'file') as 'dir' | 'file',
      size: item.isFile() ? fs.statSync(path.join(fullPath, item.name)).size : null,
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function getFileContents(
  userId: string,
  projectId: string,
  filePath: string
): string {
  const projectPath = getProjectPath(userId, projectId);
  const fullPath = validatePath(projectPath, filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error('File does not exist');
  }

  if (fs.statSync(fullPath).isDirectory()) {
    throw new Error('Path is a directory, not a file');
  }

  return fs.readFileSync(fullPath, 'utf-8');
}

