'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import LoadingSpinner, { LoadingScreen } from '@/components/loading-spinner';
import ThemeToggle from '@/components/theme-toggle';
import ChatIcon from '@/components/chat-icon';
import ChatInterface from './chat-interface';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { PopupProvider, usePopup } from '@/components/toast-notification';

interface FileItem {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number | null;
}

const LANGUAGE_MAP: Record<string, string> = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', java: 'java', c: 'c', cpp: 'cpp', cs: 'csharp',
  php: 'php', rb: 'ruby', go: 'go', rs: 'rust', swift: 'swift',
  kt: 'kotlin', json: 'json', xml: 'xml', html: 'html', css: 'css',
  scss: 'scss', sql: 'sql', sh: 'bash', yaml: 'yaml', yml: 'yaml',
  md: 'markdown', txt: 'text',
};

function getLanguageFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return LANGUAGE_MAP[ext] || 'text';
}

export default function RepositoryBrowser() {
  return (
    <PopupProvider>
      <RepositoryBrowserContent />
    </PopupProvider>
  );
}

function RepositoryBrowserContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const projectType = searchParams.get('type') || 'github';
  const isLocal = projectType === 'local';
  const owner = searchParams.get('owner') || '';
  const repo = searchParams.get('repo') || '';
  const projectId = searchParams.get('project_id') || '';
  const branchParam = searchParams.get('branch') || '';

  const currentPath = searchParams.get('path') || '';

  const { showPopup } = usePopup();
  const [authLoading, setAuthLoading] = useState(true);
  const [projectName, setProjectName] = useState('');
  const [contents, setContents] = useState<FileItem[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuspended, setIsSuspended] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>(branchParam);
  const [defaultBranch, setDefaultBranch] = useState<string>('');
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState('');

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!authLoading && !isLocal && owner && repo) {
      fetchBranches();
    }
  }, [owner, repo, authLoading, isLocal]);

  useEffect(() => {
    if (!authLoading) {
      if (isLocal && projectId) {
        fetchProjectDetails();
        fetchContents();
      } else if (!isLocal && owner && repo && currentBranch) {
        setProjectName(repo);
        fetchContents();
      }
    }
  }, [owner, repo, projectId, currentPath, authLoading, isLocal, currentBranch]);

  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/session');
      const session = await res.json();
      
      if (!session.isLoggedIn) {
        router.push('/');
        return;
      }

      if (session.user?.name) {
        setUsername(session.user.name);
      } else if (session.user?.login) {
        setUsername(session.user.login);
      }
      setAuthLoading(false);
    } catch (error) {
      console.error('Auth check failed:', error);
      router.push('/');
    }
  }

  async function fetchProjectDetails() {
    if (!isLocal || !projectId) return;
    
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setProjectName(data.project.name);
      }
    } catch (err) {
      console.error('Failed to fetch project details:', err);
    }
  }

  async function fetchBranches() {
    try {
      const res = await fetch(`/api/repositories/branches?owner=${owner}&repo=${repo}`);
      if (res.ok) {
        const data = await res.json();
        setBranches(data.branches || []);
        setDefaultBranch(data.defaultBranch || 'main');
        setCurrentBranch(prev => prev || data.defaultBranch || 'main');
      } else {
        setCurrentBranch(prev => prev || 'main');
      }
    } catch (err) {
      console.error('Failed to fetch branches:', err);
      setCurrentBranch(prev => prev || 'main');
    }
  }

  function handleBranchChange(branch: string) {
    setCurrentBranch(branch);
    setBranchDropdownOpen(false);
    setBranchSearch('');
    router.replace(buildNavigationUrl('', branch));
  }

  function apiUrl(endpoint: 'contents' | 'file', filePath: string) {
    if (isLocal) {
      return `/api/projects/local/${endpoint}?project_id=${projectId}&path=${filePath}`;
    }
    const branchQuery = currentBranch ? `&branch=${encodeURIComponent(currentBranch)}` : '';
    return `/api/repositories/${endpoint}?owner=${owner}&repo=${repo}&path=${filePath}${branchQuery}`;
  }

  async function fetchContents() {
    setLoading(true);
    setError(null);
    setFileContent(null);
    setSelectedFile(null);
    setIsSuspended(false);

    try {
      const res = await fetch(apiUrl('contents', currentPath));

      if (!res.ok) {
        const data = await res.json();
        if (data.suspended) {
          setIsSuspended(true);
          return;
        }
        throw new Error(data.error || 'Failed to fetch contents');
      }

      const data = await res.json();
      setContents(data.contents || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleFileClick(item: FileItem) {
    if (item.type === 'file') {
      setSelectedFile(item.path);
      setLoading(true);

      try {
        const res = await fetch(apiUrl('file', item.path));
        
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to fetch file');
        }

        const data = await res.json();
        setFileContent(data.content);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
  }

  async function handleRefresh() {
    if (isLocal) {
      await fetchContents();
      return;
    }

    setRefreshing(true);
    try {
      const res = await fetch('/api/repositories/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo, branch: currentBranch }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (data.suspended) {
          setIsSuspended(true);
          showPopup({
            type: 'error',
            message: 'GitHub App installation is suspended. Unsuspend it from your GitHub settings to restore access.',
          });
          return;
        }
        throw new Error(data.error || 'Failed to refresh');
      }

      await fetchContents();
    } catch (err: any) {
      showPopup({ type: 'error', message: err.message });
    } finally {
      setRefreshing(false);
    }
  }

  function buildNavigationUrl(navPath: string, branch?: string) {
    if (isLocal) {
      return `/webpages/codeview?project_id=${projectId}&type=local${navPath ? `&path=${navPath}` : ''}`;
    }
    const b = branch || currentBranch;
    return `/webpages/codeview?owner=${owner}&repo=${repo}&type=github${b ? `&branch=${encodeURIComponent(b)}` : ''}${navPath ? `&path=${navPath}` : ''}`;
  }

  function handleDirectoryClick(itemPath: string) {
    router.replace(buildNavigationUrl(itemPath));
  }

  const pathParts = currentPath ? currentPath.split('/') : [];
  const breadcrumbs = [
    { name: projectName || 'Project', path: '' },
    ...pathParts.map((part, index) => ({
      name: part,
      path: pathParts.slice(0, index + 1).join('/'),
    })),
  ];

  if (authLoading) {
    return <LoadingScreen />;
  }

  if ((!isLocal && (!owner || !repo)) || (isLocal && !projectId)) {
    return (
      <div className="min-h-screen bg-header flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted mb-4">No project selected</p>
          <Link href="/webpages" className="text-blue-600 dark:text-blue-400 hover:underline">
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-header">
      <header className="bg-header border-b border-border sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Link href="/webpages" className="flex items-center space-x-2">
                <span className="text-xl font-bold text-foreground">
                  {chatOpen ? 'DeplAI' : 'Code View'}
                </span>
              </Link>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => setChatOpen(prev => !prev)}
                className={`p-2 rounded-lg transition ${
                  chatOpen
                    ? 'bg-[#fffafa] dark:bg-surface-hover text-foreground'
                    : 'text-muted hover:text-foreground hover:bg-[#fffafa] dark:hover:bg-surface-hover'
                }`}
                title="Chat"
                aria-label="Chat"
              >
                <ChatIcon />
              </button>
              <ThemeToggle />

              {!isLocal && !chatOpen && (
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="flex items-center space-x-2 px-4 py-2 text-sm text-foreground hover:bg-[#fffafa] dark:hover:bg-surface-hover rounded-lg transition disabled:opacity-50"
                >
                  <svg
                    className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {!chatOpen && (
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center space-x-2 text-sm">
                {breadcrumbs.map((crumb, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    {index > 0 && <span className="text-gray-400">/</span>}
                    {index === breadcrumbs.length - 1 ? (
                      <span className="text-foreground font-medium">{crumb.name}</span>
                    ) : (
                      <button
                        onClick={() => router.replace(buildNavigationUrl(crumb.path))}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {crumb.name}
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {!isLocal && branches.length > 1 && (
                <div className="relative">
                  <button
                    onClick={() => setBranchDropdownOpen(prev => !prev)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border bg-surface text-foreground hover:bg-surface-hover transition max-w-[240px]"
                  >
                    <span className="truncate">{currentBranch}</span>
                    <svg className="w-3 h-3 text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {branchDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-56 bg-surface border border-border rounded-lg shadow-lg z-20">
                      <div className="p-2 border-b border-border">
                        <div className="relative">
                          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" viewBox="0 0 24 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M15.277 13.2502C15.277 13.6645 14.9412 14.0002 14.527 14.0002L7.96792 14.0002C7.5537 14.0002 7.21792 13.6645 7.21792 13.2502C7.21792 12.836 7.5537 12.5002 7.96792 12.5002L14.527 12.5002C14.9412 12.5002 15.277 12.836 15.277 13.2502Z" fill="currentColor"/>
                            <path d="M12.8468 9.75025C12.8468 10.1645 12.511 10.5002 12.0968 10.5002H7.96719C7.55297 10.5002 7.21719 10.1645 7.21719 9.75025C7.21719 9.33603 7.55297 9.00025 7.96719 9.00025L12.0968 9.00025C12.511 9.00025 12.8468 9.33603 12.8468 9.75025Z" fill="currentColor"/>
                            <path fillRule="evenodd" clipRule="evenodd" d="M2 11.4989C2 6.39126 6.14154 2.25098 11.25 2.25098C16.3585 2.25098 20.5 6.39126 20.5 11.4989C20.5 13.7836 19.6714 15.8747 18.2983 17.4883L21.7791 20.9695C22.072 21.2624 22.072 21.7372 21.7791 22.0301C21.4862 22.323 21.0113 22.323 20.7184 22.0301L17.2372 18.5486C15.6237 19.9197 13.5334 20.7469 11.25 20.7469C6.14154 20.7469 2 16.6066 2 11.4989ZM11.25 3.75098C6.96962 3.75098 3.5 7.22003 3.5 11.4989C3.5 15.7779 6.96962 19.2469 11.25 19.2469C15.5304 19.2469 19 15.7779 19 11.4989C19 7.22003 15.5304 3.75098 11.25 3.75098Z" fill="currentColor"/>
                          </svg>
                          <input
                            type="text"
                            value={branchSearch}
                            onChange={(e) => setBranchSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-border bg-surface text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                            autoFocus
                          />
                        </div>
                      </div>
                      <div className="max-h-52 overflow-y-auto">
                        {branches
                          .filter(b => b.toLowerCase().includes(branchSearch.toLowerCase()))
                          .map(b => (
                            <button
                              key={b}
                              onClick={() => handleBranchChange(b)}
                              className={`w-full px-4 py-2 text-left text-sm hover:bg-surface-hover transition ${
                                b === currentBranch
                                  ? 'text-blue-600 dark:text-blue-400 font-medium'
                                  : 'text-foreground'
                              }`}
                            >
                              {b}
                              {b === defaultBranch && (
                                <span className="ml-2 text-xs text-muted">(default)</span>
                              )}
                            </button>
                          ))}
                        {branches.filter(b => b.toLowerCase().includes(branchSearch.toLowerCase())).length === 0 && (
                          <p className="px-4 py-2 text-sm text-muted">No branches found</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {chatOpen ? (
        <div className="container mx-auto px-6 flex flex-col" style={{ height: 'calc(100vh - 5rem)' }}>
          <ChatInterface username={username} />
        </div>
      ) : (
      <>
      <div className="container mx-auto px-6 py-8">
        <div className={`grid gap-6 ${fileContent ? 'lg:grid-cols-2' : 'lg:grid-cols-1'}`}>
          <div className="bg-surface rounded-xl border border-border">
            <div className="p-6 max-h-[600px] overflow-y-auto">
              {!isLocal && isSuspended ? (
                <div className="text-center py-16">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 bg-orange-100 dark:bg-orange-700">
                    <svg className="w-8 h-8 text-orange-600 dark:text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold mb-2 text-orange-600 dark:text-white">Installation Suspended</h3>
                  <p className="text-muted dark:text-gray-300 text-sm mb-4">
                    Your GitHub App has been suspended.<br />
                  </p>
                </div>
              ) : loading && !fileContent ? (
                <LoadingSpinner size="md" className="py-12" />
              ) : error ? (
                <div className="text-center py-12">
                  <p className="text-red-600 dark:text-red-400">{error}</p>
                  <button
                    onClick={fetchContents}
                    className="mt-4 text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div>
                  {currentPath && (
                    <>
                      <button
                        onClick={() => router.replace(buildNavigationUrl(
                          currentPath.includes('/')
                            ? currentPath.split('/').slice(0, -1).join('/')
                            : ''
                        ))}
                        className="flex items-center space-x-3 p-4 hover:bg-surface-hover transition border-l-4 border-l-transparent w-full text-left"
                      >
                        <svg
                          className="w-5 h-5 text-gray-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10 19l-7-7m0 0l7-7m-7 7h18"
                          />
                        </svg>
                        <span className="text-muted">..</span>
                      </button>
                      <div className="border-b border-border"></div>
                    </>
                  )}

                  {contents.map((item, index) => (
                    <div key={item.path}>
                      <div
                        onClick={() =>
                          item.type === 'dir'
                            ? handleDirectoryClick(item.path)
                            : handleFileClick(item)
                        }
                        className={`flex items-center justify-between p-4 cursor-pointer transition ${
                          selectedFile === item.path
                            ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-l-blue-600 dark:border-l-blue-400'
                            : 'hover:bg-surface-hover border-l-4 border-l-transparent'
                        }`}
                      >
                        <div className="flex items-center space-x-3 flex-1">
                          {item.type === 'dir' ? (
                            <svg
                              className="w-5 h-5 text-blue-500 dark:text-blue-400"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                            </svg>
                          ) : (
                            <svg
                              className="w-5 h-5 text-gray-400"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                          <span className="text-foreground font-medium">{item.name}</span>
                        </div>

                        {item.type === 'file' && item.size !== null && (
                          <span className="text-xs text-muted">
                            {(item.size / 1024).toFixed(1)} KB
                          </span>
                        )}
                      </div>
                      {index < contents.length - 1 && (
                        <div className="border-b border-border"></div>
                      )}
                    </div>
                  ))}

                  {contents.length === 0 && (
                    <div className="text-center py-12 text-muted">
                      Empty directory
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {fileContent && (
            <div className="bg-surface rounded-xl border border-border">
              <div className="p-6 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground">
                  {selectedFile ? selectedFile.split('/').pop() : 'Select a file'}
                </h2>
              </div>

              <div className="p-6">
                <div className="rounded-lg overflow-hidden">
                  <SyntaxHighlighter
                    language={getLanguageFromFilename(selectedFile || '')}
                    style={vscDarkPlus}
                    showLineNumbers={true}
                    customStyle={{
                      margin: 0,
                      maxHeight: '600px',
                      fontSize: '14px',
                    }}
                  >
                    {fileContent}
                  </SyntaxHighlighter>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="container mx-auto px-6 py-8 border-t border-border">
        <div className="text-center">
          <p className="text-muted text-sm mt-1">
            {isLocal
              ? 'Note: Files are stored temporarily, edits made to this project wont get reflected here'
              : 'Note: Changes pushed from your IDE to GitHub will appear here after you click Refresh'}
          </p>
        </div>
      </div>
      </>
      )}
    </div>
  );
}