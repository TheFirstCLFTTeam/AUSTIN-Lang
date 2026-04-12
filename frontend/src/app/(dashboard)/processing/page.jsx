'use client';

import { useState, useEffect } from 'react';
import { fetchProcessingJobs } from '@/services/api';

const STATUS_STYLES = {
  processing: { bg: 'rgba(178, 1, 0, 0.08)', color: '#b20100', label: 'PROCESSING' },
  queued:     { bg: 'rgba(122, 117, 116, 0.1)', color: '#7a7574', label: 'QUEUED' },
  failed:     { bg: 'rgba(200, 0, 0, 0.08)', color: '#c80000', label: 'FAILED' },
};

export default function ProcessingPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProcessingJobs()
      .then(setJobs)
      .finally(() => setLoading(false));
  }, []);

  const activeCount = jobs.filter((j) => j.status === 'processing').length;
  const queuedCount = jobs.filter((j) => j.status === 'queued').length;
  const failedCount = jobs.filter((j) => j.status === 'failed').length;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[0.6875rem] mb-1" style={{ color: '#7a7574' }}>
        <span className="uppercase tracking-wider" style={{ color: '#b20100' }}>HOME</span>
        <span>/</span>
        <span className="uppercase tracking-wider">Processing</span>
      </div>

      <h1 className="text-[2rem] font-bold tracking-tight mb-6" style={{ color: '#1c1b1b', letterSpacing: '-0.02em' }}>
        Processing Queue
      </h1>

      {/* Summary cards */}
      <div className="flex gap-4 mb-6">
        <SummaryCard label="Active" value={activeCount} color="#b20100" />
        <SummaryCard label="Queued" value={queuedCount} color="#7a7574" />
        <SummaryCard label="Failed" value={failedCount} color="#c80000" />
      </div>

      {/* Job list */}
      {loading ? (
        <p className="text-[0.875rem]" style={{ color: '#7a7574' }}>Loading...</p>
      ) : jobs.length === 0 ? (
        <div className="p-8 text-center" style={{ backgroundColor: '#ffffff' }}>
          <p className="text-[0.875rem]" style={{ color: '#7a7574' }}>No recordings are currently being processed.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Header */}
          <div className="flex items-center px-5 py-2 text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: '#7a7574' }}>
            <span className="flex-1">File Name</span>
            <span className="w-28 text-center">Status</span>
            <span className="w-48">Progress</span>
            <span className="w-40">Stage</span>
            <span className="w-36 text-right">Submitted</span>
          </div>

          {jobs.map((job) => {
            const style = STATUS_STYLES[job.status] || STATUS_STYLES.queued;
            return (
              <div
                key={job.id}
                className="flex items-center px-5 py-4"
                style={{ backgroundColor: '#ffffff' }}
              >
                {/* File name */}
                <div className="flex-1 min-w-0">
                  <p className="text-[0.8125rem] font-medium truncate" style={{ color: '#1c1b1b' }}>
                    {job.fileName}
                  </p>
                </div>

                {/* Status badge */}
                <div className="w-28 flex justify-center">
                  <span
                    className="px-2 py-0.5 text-[0.625rem] font-semibold"
                    style={{ backgroundColor: style.bg, color: style.color }}
                  >
                    {style.label}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-48 px-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5" style={{ backgroundColor: '#f6f3f2' }}>
                      <div
                        className="h-1.5 transition-all"
                        style={{
                          width: `${job.progress}%`,
                          backgroundColor: job.status === 'failed' ? '#c80000' : '#b20100',
                        }}
                      />
                    </div>
                    <span className="text-[0.6875rem] font-medium w-8 text-right" style={{ color: '#7a7574' }}>
                      {job.progress}%
                    </span>
                  </div>
                </div>

                {/* Stage */}
                <div className="w-40">
                  <p className="text-[0.75rem] truncate" style={{ color: job.status === 'failed' ? '#c80000' : '#7a7574' }}>
                    {job.stage}
                  </p>
                </div>

                {/* Submitted time */}
                <div className="w-36 text-right">
                  <p className="text-[0.6875rem]" style={{ color: '#7a7574' }}>
                    {new Date(job.submittedAt).toLocaleString(undefined, {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div className="px-5 py-4 min-w-[120px]" style={{ backgroundColor: '#ffffff' }}>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-1" style={{ color: '#7a7574' }}>{label}</p>
      <p className="text-[1.5rem] font-bold" style={{ color }}>{value}</p>
    </div>
  );
}
