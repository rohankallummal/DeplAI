'use client';

import { useState } from 'react';
import LoadingSpinner from '@/components/loading-spinner';
import { usePopup } from '@/components/toast-notification';
import { FiShield } from 'react-icons/fi';

interface ScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: {
    id: string;
    name?: string;
    repo?: string;
    owner?: string;
    installationId?: string;
    type: 'local' | 'github';
  } | null;
  onScanComplete: (result: ScanResult) => void;
}

interface ScanResult {
  projectId: string;
  projectName: string;
}

export default function ScanModal({ isOpen, onClose, project, onScanComplete }: ScanModalProps) {
  const { showPopup } = usePopup();
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen || !project) return null;

  const projectName = project.type === 'local' ? project.name : project.repo;

  const handleClose = () => {
    setSubmitting(false);
    onClose();
  };

  const handleStartScan = async () => {
    setSubmitting(true);
    const name = projectName || 'Unknown';

    try {
      const response = await fetch('/api/scan/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          project_name: name,
          project_type: project.type,
          installation_id: project.installationId,
          owner: project.owner,
          repo: project.repo,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || 'Backend request failed');
      }

      await response.json();
      onScanComplete({ projectId: project.id, projectName: name });
    } catch (error: any) {
      console.error('Failed to initiate scan:', error);
      showPopup({
        type: 'error',
        message: error?.message || 'Failed to connect to the backend. Please ensure the server is running.',
      });
    } finally {
      handleClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center font-sans">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" />

      <div className="relative bg-white dark:bg-[#0a0a0a] rounded-xl shadow-2xl w-full max-w-[480px] mx-4 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">

        <div className="p-8 pt-6">
          <div className="flex flex-col items-center">
            <FiShield className="w-20 h-20 text-green-600 dark:text-green-500 mb-6" />

            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3 text-center">
              Confirmation
            </h3>

            <p className="text-gray-600 dark:text-gray-400 text-center leading-relaxed mb-8">
              Do you want to perform a security scan?
            </p>

            {submitting ? (
              <div className="flex flex-col items-center w-full py-2">
                <LoadingSpinner size="md" />
              </div>
            ) : (
              <div className="flex gap-4 w-full">
                <button
                  onClick={handleStartScan}
                  className="flex-1 py-3 px-4 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold rounded-lg transition shadow-sm"
                >
                  Yes
                </button>
                <button
                  onClick={handleClose}
                  className="flex-1 py-3 px-4 bg-gray-200 hover:bg-gray-300 dark:bg-[#141414] dark:hover:bg-[#222] text-gray-900 dark:text-white font-semibold rounded-lg transition"
                >
                  No
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
