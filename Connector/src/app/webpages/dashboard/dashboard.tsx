'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import LoadingSpinner from '@/components/loading-spinner';
import ProjectIcon from '@/components/project-icons';
import { SearchIcon, FileXmarkIcon, FilterIcon } from '@/components/search-result';
import { ArrowLeftCircle, ArrowRightCircle } from '@/components/pagination-arrows';
import { FileFormatZip, AppConnector, CloudUploadIcon, XmarkCircleIcon } from '@/components/panel-icons';
import ScanModal from '@/components/scan-card';
import { GradientText, TextType } from '@/components/text-animation';
import { usePopup } from '@/components/toast-notification';
import Lottie from 'lottie-react';
import deployingAnimation from '@/components/animation/deploying.json';

interface ProjectsProps {
  installations: any[];
  projects: any[];
  loading: boolean;
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleDeleteProject: (projectId: string, projectName: string) => void;
  handleProjectClick: (project: any) => void;
  startScan: (projectId: string, projectName: string) => void;
  activeScanIds: string[];
  activeRemediationIds: string[];
  activeDeployIds: string[];
  activeDeployProjectNames: Record<string, string>;
}

interface ScanResult {
  projectId: string;
  projectName: string;
}

const PROJECTS_PER_PAGE = 5;

function DeployActivePanel({
  projectName,
  onClick,
}: {
  projectName: string;
  onClick: () => void;
}) {
  const [showText, setShowText] = useState(false);

  const handleLottieComplete = () => {
    setShowText(true);
  };

  const handleTextCycleComplete = () => {
    setShowText(false);
  };

  return (
    <button
      onClick={onClick}
      className="w-full p-12 rounded-xl border border-blue-500 bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/30 transition-all duration-200 cursor-pointer group relative overflow-hidden"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        {showText ? (
          <TextType
            texts={[`Deploying ${projectName}`]}
            typingSpeed={75}
            deletingSpeed={50}
            pauseDuration={2000}
            showCursor
            cursorCharacter="_"
            cursorBlinkDuration={0.5}
            className="text-lg font-semibold text-blue-600 dark:text-blue-400"
            onCycleComplete={handleTextCycleComplete}
          />
        ) : (
          <Lottie
            animationData={deployingAnimation}
            loop={false}
            onComplete={handleLottieComplete}
            className="w-60 h-60"
          />
        )}
      </div>
    </button>
  );
}

export default function Projects({
  installations,
  projects,
  loading,
  uploading,
  fileInputRef,
  handleFileUpload,
  handleDeleteProject,
  handleProjectClick,
  startScan,
  activeScanIds,
  activeRemediationIds,
  activeDeployIds,
  activeDeployProjectNames,
}: ProjectsProps) {
  const router = useRouter();
  const { showPopup } = usePopup();
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [filter, setFilter] = useState<'none' | 'github' | 'local'>('none');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<any>(null);

  const [deployMode, setDeployMode] = useState(false);
  const [deploySelectedId, setDeploySelectedId] = useState<string | null>(null);
  const [deployConfirmOpen, setDeployConfirmOpen] = useState(false);

  const [remediatedIds, setRemediatedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const ids = new Set<string>();
    let createdRepos: { fullName: string }[] = [];

    try {
      createdRepos = JSON.parse(localStorage.getItem('deplai_created_repos') || '[]');
    } catch {}

    for (const p of projects) {
      if (localStorage.getItem(`deplai_remediated_${p.id}`) ||
          localStorage.getItem(`deplai_published_${p.id}`)) {
        ids.add(p.id);
      }

      if (p.type === 'github') {
        const fullName = `${p.owner}/${p.repo}`;
        if (createdRepos.some((r: any) => r.fullName === fullName)) {
          ids.add(p.id);
        }
      }
    }

    setRemediatedIds(ids);
  }, [projects]);

  const handleScanClick = (project: any) => {
    setSelectedProject(project);
    setScanModalOpen(true);
  };

  const handleScanComplete = (result: ScanResult) => {
    showPopup({
      type: 'success',
      message: `Scan initiated for "${result.projectName}".`,
    });
    startScan(result.projectId, result.projectName);
  };

  const handleToggleDeployMode = () => {
    if (deployMode) {
      setDeployMode(false);
      setDeploySelectedId(null);
      setDeployConfirmOpen(false);
    } else {
      setDeployMode(true);
    }
  };

  const handleDeploySelect = (projectId: string) => {
    setDeploySelectedId((prev) => (prev === projectId ? null : projectId));
  };

  const handleReadyClick = () => {
    setDeployConfirmOpen(true);
  };

  const handleDeployConfirmYes = async () => {
    if (!deploySelectedProject) {
      setDeployConfirmOpen(false);
      return;
    }

    try {
      const healthRes = await fetch('/api/deploy/health');
      if (!healthRes.ok) {
        showPopup({
          type: 'error',
          message: 'Deployment service is currently unavailable. Please try again later.',
        });
        setDeployConfirmOpen(false);
        return;
      }

      router.push(`/webpages/deploy?project_id=${deploySelectedProject.id}`);
    } catch (err) {
      showPopup({
        type: 'error',
        message: 'Deployment service is currently unavailable. Please try again later.',
      });
    }
    setDeployConfirmOpen(false);
  };

  const handleDeployConfirmNo = () => {
    setDeployConfirmOpen(false);
  };

  const deploySelectedProject = deploySelectedId
    ? projects.find((p) => p.id === deploySelectedId)
    : null;

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return projects.filter((project) => {
      if (filter !== 'none' && project.type !== filter) return false;
      if (query) {
        const name = project.type === 'local' ? project.name : project.repo;
        if (!name?.toLowerCase().includes(query)) return false;
      }
      return true;
    });
  }, [projects, searchQuery, filter]);

  const anyOperationActive = activeScanIds.length > 0 || activeRemediationIds.length > 0;
  const totalPages = Math.ceil(filteredProjects.length / PROJECTS_PER_PAGE);
  const startIndex = (currentPage - 1) * PROJECTS_PER_PAGE;
  const paginatedProjects = filteredProjects.slice(startIndex, startIndex + PROJECTS_PER_PAGE);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  const handleFilterChange = (newFilter: 'none' | 'github' | 'local') => {
    setFilter(newFilter);
    setCurrentPage(1);
    setShowFilterDropdown(false);
  };

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(prev + 1, totalPages));
  };

  const handleConnectRepository = () => {
    const url = 'https://github.com/apps/deplai-dev-rohan/installations/new';
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      url,
      'github-connect',
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
    );

    const checkClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkClosed);
        window.location.reload();
      }
    }, 500);
  };

  if (installations.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-surface-alt rounded-xl border border-border w-full max-w-md">
          <div className="p-4">
            <div className="text-center py-12">
              <div className="w-16 h-16 bg-surface-hover rounded-full flex items-center justify-center mx-auto mb-4">
                <CloudUploadIcon className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-600 dark:text-gray-300 font-medium mb-2">No installations yet</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Install the GitHub App to get started</p>
              <a
                href="https://github.com/apps/deplai-dev-rohan/installations/new"
                className="inline-block bg-blue-600 dark:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 dark:hover:bg-blue-600 transition"
              >
                Install GitHub App
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6 mt-15">
      <div className="lg:col-span-1 space-y-6 lg:mt-12">
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          onChange={handleFileUpload}
          className="hidden"
          disabled={uploading}
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full p-8 rounded-xl border border-border hover:border-blue-400 dark:hover:border-blue-500 bg-surface hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group"
        >
          <div className="flex flex-col items-center">
            {uploading ? (
              <LoadingSpinner size="sm" />
            ) : (
              <FileFormatZip className="w-12 h-12 text-gray-400 dark:text-gray-500 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors" />
            )}
            <p className="mt-3 text-sm font-medium text-gray-600 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {uploading ? 'Uploading...' : 'Upload Project'}
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              .zip files up to 1 GB
            </p>
          </div>
        </button>

        {activeDeployIds.length > 0 ? (
          <DeployActivePanel
            projectName={activeDeployProjectNames[activeDeployIds[0]] || 'Project'}
            onClick={() => router.push(`/webpages/deploy?project_id=${activeDeployIds[0]}`)}
          />
        ) : (
          <button
            onClick={handleToggleDeployMode}
            className={`w-full p-8 rounded-xl border transition-all duration-200 cursor-pointer group ${
              deployMode
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-border hover:border-blue-400 dark:hover:border-blue-500 bg-surface hover:bg-blue-50 dark:hover:bg-blue-900/20'
            }`}
          >
            <div className="flex flex-col items-center">
              {deployMode ? (
                <XmarkCircleIcon className="w-12 h-12 text-blue-500 dark:text-blue-400 transition-colors" />
              ) : (
                <CloudUploadIcon className="w-12 h-12 text-gray-400 dark:text-gray-500 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors" />
              )}
              <p
                className={`mt-3 text-sm font-medium transition-colors ${
                  deployMode
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400'
                }`}
              >
                {deployMode ? 'Exit Deploy Mode' : 'Deploy'}
              </p>
            </div>
          </button>
        )}

        <button
          onClick={handleConnectRepository}
          className="w-full p-8 rounded-xl border border-border hover:border-blue-400 dark:hover:border-blue-500 bg-surface hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-200 cursor-pointer group"
        >
          <div className="flex flex-col items-center">
            <AppConnector className="w-12 h-12 text-gray-400 dark:text-gray-500 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors" />
            <p className="mt-3 text-sm font-medium text-gray-600 dark:text-gray-300 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              Connect to App
            </p>
          </div>
        </button>
      </div>

      <div className="lg:col-span-2">
        <div className="bg-surface rounded-xl border border-border">
          <div className="p-6 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border bg-surface text-foreground placeholder-muted focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-[#fffafa] dark:focus:bg-search transition"
                />
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                  className={`p-2.5 rounded-lg border transition ${
                    filter !== 'none'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                      : 'border-border bg-surface text-muted hover:bg-surface-hover'
                  }`}
                >
                  <FilterIcon className="w-5 h-5" />
                </button>
                {showFilterDropdown && (
                  <div className="absolute right-0 mt-2 w-36 bg-surface border border-border rounded-lg shadow-lg z-10">
                    <button
                      onClick={() => handleFilterChange('none')}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-surface-hover rounded-t-lg ${
                        filter === 'none' ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-foreground'
                      }`}
                    >
                      None
                    </button>
                    <button
                      onClick={() => handleFilterChange('github')}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-surface-hover ${
                        filter === 'github' ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-foreground'
                      }`}
                    >
                      GitHub
                    </button>
                    <button
                      onClick={() => handleFilterChange('local')}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-surface-hover rounded-b-lg ${
                        filter === 'local' ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-foreground'
                      }`}
                    >
                      Local
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="p-6 max-h-[500px] overflow-y-auto scrollbar-hidden">
            {loading ? (
              <LoadingSpinner size="md" className="py-12" />
            ) : projects.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-600 dark:text-gray-300 font-medium mb-2">No projects yet</p>
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="text-center py-12">
                <FileXmarkIcon className="mx-auto text-gray-400 dark:text-gray-500 mb-4" />
                <p className="text-gray-600 dark:text-gray-300 font-medium mb-2">No projects found</p>
              </div>
            ) : (
              <div className="space-y-4">
                {paginatedProjects.map((project) => {
                  const isSelected = deploySelectedId === project.id;

                  return (
                    <div
                      key={project.id}
                      className={`group border rounded-lg p-5 transition-all duration-300 bg-[#f8f8f8] dark:bg-[#262626] ${
                        deployMode
                          ? isSelected
                            ? 'border-blue-400 dark:border-blue-500 shadow-md'
                            : 'border-border'
                          : 'border-border hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md cursor-pointer'
                      }`}
                      onClick={() => {
                        if (deployMode) {
                          handleDeploySelect(project.id);
                        } else {
                          handleProjectClick(project);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center space-x-3">
                          {deployMode && (
                            <div
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
                                isSelected
                                  ? 'border-blue-500 bg-blue-500'
                                  : 'border-gray-300 dark:border-gray-600'
                              }`}
                            >
                              {isSelected && (
                                <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                                  <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                          )}
                          <ProjectIcon type={project.type} size={40} className="text-foreground self-center" />
                          <div className="flex flex-col justify-center mt-1">
                            <h3 className="font-semibold text-foreground">
                              {project.type === 'local' ? project.name : project.repo}
                            </h3>
                            <span className={`text-xs mt-0.5 ${
                              project.type === 'local'
                                ? 'text-purple-700 dark:text-purple-300'
                                : project.access === 'Private'
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-green-700 dark:text-green-300'
                            }`}>
                              {project.type === 'local' ? 'Local' : project.access}
                            </span>
                          </div>
                        </div>

                        {deployMode ? (
                          isSelected ? (
                            <button
                              className="text-sm font-medium px-3 py-1 rounded-lg transition text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReadyClick();
                              }}
                            >
                              Ready
                            </button>
                          ) : null
                        ) : (
                          <div className="flex items-center space-x-2">
                            {project.canDelete && (
                              <button
                                className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium px-3 py-1 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteProject(project.id, project.name);
                                }}
                              >
                                Delete
                              </button>
                            )}
                            {activeDeployIds.includes(project.id) ? null : activeRemediationIds.includes(project.id) ? (
                              <GradientText
                                colors={["#5227FF", "#FF9FFC", "#B19EEF"]}
                                animationSpeed={8}
                                showBorder={false}
                                className="text-sm font-medium px-3 py-1 cursor-default"
                              >
                                Remediating
                              </GradientText>
                            ) : activeScanIds.includes(project.id) ? (
                              <GradientText
                                colors={["#5227FF", "#FF9FFC", "#B19EEF"]}
                                animationSpeed={8}
                                showBorder={false}
                                className="text-sm font-medium px-3 py-1 cursor-default"
                              >
                                Scanning
                              </GradientText>
                            ) : remediatedIds.has(project.id) ? null : (
                              <button
                                disabled={anyOperationActive}
                                className={`text-sm font-medium px-3 py-1 rounded-lg transition ${
                                  anyOperationActive
                                    ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
                                    : 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                                }`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleScanClick(project);
                                }}
                              >
                                Scan
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {project.type === 'github' && project.languages && Object.keys(project.languages).length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-3">
                          {Object.keys(project.languages).slice(0, 5).map((lang) => (
                            <span
                              key={lang}
                              className="text-xs bg-surface-hover text-foreground px-3 py-1 rounded-full"
                            >
                              {lang}
                            </span>
                          ))}
                        </div>
                      )}

                      {!deployMode && (
                        <div className="grid grid-rows-[0fr] group-hover:grid-rows-[1fr] transition-all duration-300">
                          <div className="overflow-hidden">
                            <div className="mt-4 pt-4 border-t border-border">
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted">Security Analysis:</span>
                                <Link
                                  href={`/webpages/security/${project.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium hover:underline"
                                >
                                  Results
                                </Link>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {!loading && filteredProjects.length > PROJECTS_PER_PAGE && (
            <div className="p-4 border-t border-border flex items-center justify-between">
              <p className="text-sm text-muted">
                {startIndex + 1}-{Math.min(startIndex + PROJECTS_PER_PAGE, filteredProjects.length)} of {filteredProjects.length} projects
              </p>
              <div className="flex items-center space-x-3">
                <button
                  onClick={handlePrevPage}
                  disabled={currentPage === 1}
                  className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <ArrowLeftCircle className="w-8 h-8" />
                </button>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Page {currentPage}
                </span>
                <button
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages}
                  className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <ArrowRightCircle className="w-8 h-8" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ScanModal
        isOpen={scanModalOpen}
        onClose={() => {
          setScanModalOpen(false);
          setSelectedProject(null);
        }}
        project={selectedProject}
        onScanComplete={handleScanComplete}
      />

      {deployConfirmOpen && deploySelectedProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center font-sans">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" />
          <div className="relative bg-white dark:bg-[#0a0a0a] rounded-xl shadow-2xl w-full max-w-[480px] mx-4 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
            <div className="p-8 pt-6">
              <div className="flex flex-col items-center">
                <CloudUploadIcon className="w-20 h-20 text-blue-600 dark:text-blue-500 mb-6" />

                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3 text-center">
                  Confirmation
                </h3>

                <p className="text-gray-600 dark:text-gray-400 text-center leading-relaxed mb-8">
                  Ready to deploy
                </p>

                <div className="flex gap-4 w-full">
                  <button
                    onClick={handleDeployConfirmYes}
                    className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold rounded-lg transition shadow-sm"
                  >
                    Yes
                  </button>
                  <button
                    onClick={handleDeployConfirmNo}
                    className="flex-1 py-3 px-4 bg-gray-200 hover:bg-gray-300 dark:bg-[#141414] dark:hover:bg-[#222] text-gray-900 dark:text-white font-semibold rounded-lg transition"
                  >
                    No
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
