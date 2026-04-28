'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { getCurrentUser } from '../../../../../services/api';
import { getGroupIdForRole, isControlMember } from '../../../../../services/folders';
import { getMetricById, updateMetricMetadata } from '../../../../../services/metrics-config';
import PythonHighlighter from './PythonHighlighter';

const inputStyle = { backgroundColor: '#f6f3f2', border: 'none', borderBottom: '2px solid #c4c4c4', borderRadius: '0px', color: '#1c1b1b' };
const codeInputStyle = {
  backgroundColor: '#1c1b1b',
  color: '#f6f3f2',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  border: '1.5px solid rgba(233, 188, 181, 0.3)',
  borderRadius: '0px',
  lineHeight: 1.55,
};

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-1" style={{ color: '#7a7574' }}>{label}</p>
      <div className="text-[0.875rem]" style={{ color: '#1c1b1b' }}>{children}</div>
    </div>
  );
}

const EMPTY_DRAFT = { target: '', name: '', shortDescription: '', description: '', pythonScript: '' };

export default function MetricDetailsPage() {
  const { id } = useParams();
  const router = useRouter();
  const [metric, setMetric] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    const m = getMetricById(id);
    setMetric(m);
    if (m) {
      setDraft({
        target: m.target ?? '',
        name: m.name ?? '',
        shortDescription: m.shortDescription ?? '',
        description: m.description ?? '',
        pythonScript: m.pythonScript ?? '',
      });
    }

    const user = getCurrentUser();
    if (user) {
      const groupId = getGroupIdForRole(user.role);
      setCanEdit(isControlMember(user.id, groupId));
    }
  }, [id]);

  if (metric === null) {
    return (
      <div>
        <Link href="/dashboard/configure" className="text-[0.6875rem] uppercase tracking-wider" style={{ color: '#7a7574' }}>&larr; Configure Metrics</Link>
        <div className="mt-8 p-10 text-center" style={{ backgroundColor: '#ffffff' }}>
          <p className="text-[0.875rem]" style={{ color: '#7a7574' }}>Metric not found.</p>
        </div>
      </div>
    );
  }

  const setField = (key, value) => setDraft((d) => ({ ...d, [key]: value }));

  const handleStartEdit = () => {
    setDraft({
      target: metric.target ?? '',
      name: metric.name ?? '',
      shortDescription: metric.shortDescription ?? '',
      description: metric.description ?? '',
      pythonScript: metric.pythonScript ?? '',
    });
    setSaveError('');
    setEditing(true);
  };

  const handleCancel = () => {
    setSaveError('');
    setEditing(false);
  };

  const handleSave = () => {
    setSaveError('');
    if (!draft.name.trim()) {
      setSaveError('Name is required.');
      return;
    }
    const patch = {
      name: draft.name,
      shortDescription: draft.shortDescription,
      description: draft.description,
      pythonScript: draft.pythonScript,
    };
    if (draft.target !== '' && draft.target !== null && draft.target !== undefined) {
      const parsed = Number(draft.target);
      if (Number.isNaN(parsed)) {
        setSaveError('Target must be a number.');
        return;
      }
      patch.target = parsed;
    }
    updateMetricMetadata(id, patch);
    setMetric(getMetricById(id));
    setEditing(false);
  };

  const unit = metric.series?.unit || '';

  return (
    <div>
      <div className="flex items-center gap-2 text-[0.6875rem] mb-1" style={{ color: '#7a7574' }}>
        <Link href="/dashboard" style={{ color: '#7a7574', textDecoration: 'none' }} className="uppercase tracking-wider">Dashboard</Link>
        <span>/</span>
        <Link href="/dashboard/configure" style={{ color: '#7a7574', textDecoration: 'none' }} className="uppercase tracking-wider">Configure</Link>
        <span>/</span>
        <span className="uppercase tracking-wider" style={{ color: '#b20100' }}>Metric Details</span>
      </div>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[2rem] font-bold tracking-tight" style={{ color: '#1c1b1b', letterSpacing: '-0.02em' }}>
            {metric.name?.toUpperCase() || 'METRIC'}
          </h1>
          {metric.shortDescription && <p className="text-[0.875rem] mt-1" style={{ color: '#7a7574' }}>{metric.shortDescription}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canEdit && !editing && (
            <button
              onClick={handleStartEdit}
              className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer"
              style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: '0px' }}
            >
              EDIT METADATA
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={handleSave}
                className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer"
                style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: '0px' }}
              >
                SAVE
              </button>
              <button
                onClick={handleCancel}
                className="px-4 py-2 text-[0.8125rem] font-medium cursor-pointer"
                style={{ backgroundColor: 'transparent', border: '1.5px solid rgba(233, 188, 181, 0.3)', borderRadius: '0px', color: '#1c1b1b' }}
              >
                CANCEL
              </button>
            </>
          )}
          {!editing && (
            <button
              onClick={() => router.back()}
              className="px-4 py-2 text-[0.8125rem] font-medium cursor-pointer"
              style={{ backgroundColor: 'transparent', border: '1.5px solid rgba(233, 188, 181, 0.3)', borderRadius: '0px', color: '#1c1b1b' }}
            >
              BACK
            </button>
          )}
        </div>
      </div>

      {saveError && (
        <div className="mb-4 px-4 py-3" style={{ backgroundColor: 'rgba(178, 1, 0, 0.08)', borderLeft: '3px solid #b20100' }}>
          <p className="text-[0.75rem]" style={{ color: '#b20100' }}>{saveError}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="p-5" style={{ backgroundColor: '#ffffff' }}>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-2" style={{ color: '#7a7574' }}>Current Value</p>
          <p className="text-[2rem] font-bold" style={{ color: '#1c1b1b', letterSpacing: '-0.02em' }}>{metric.value || '—'}</p>
          {metric.sublabel && <p className="text-[0.6875rem] mt-1" style={{ color: '#7a7574' }}>{metric.sublabel}</p>}
        </div>

        <div className="p-5" style={{ backgroundColor: '#ffffff' }}>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-2" style={{ color: '#7a7574' }}>Target</p>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                value={draft.target}
                onChange={(e) => setField('target', e.target.value)}
                className="w-24 px-2 py-1 text-[1.5rem] font-bold"
                style={inputStyle}
              />
              {unit && <span className="text-[1.25rem] font-bold" style={{ color: '#1c1b1b' }}>{unit}</span>}
            </div>
          ) : (
            <p className="text-[2rem] font-bold" style={{ color: '#1c1b1b', letterSpacing: '-0.02em' }}>
              {metric.target ?? '—'}{metric.target != null ? unit : ''}
            </p>
          )}
        </div>

        <div className="p-5" style={{ backgroundColor: '#ffffff' }}>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-2" style={{ color: '#7a7574' }}>Last Revised</p>
          <p className="text-[2rem] font-bold" style={{ color: '#1c1b1b', letterSpacing: '-0.02em' }}>{formatDate(metric.dateRevised)}</p>
          <p className="text-[0.6875rem] mt-1" style={{ color: '#7a7574' }}>Auto-updated on metadata edits</p>
        </div>
      </div>

      {!canEdit && (
        <div className="mb-6 px-4 py-3" style={{ backgroundColor: 'rgba(122, 117, 116, 0.08)', borderLeft: '3px solid #7a7574' }}>
          <p className="text-[0.75rem]" style={{ color: '#7a7574' }}>
            Only the control member of your group can revise metric metadata. Contact them to request a change.
          </p>
        </div>
      )}

      <div className="p-5 mb-6" style={{ backgroundColor: '#ffffff' }}>
        <h2 className="text-[0.875rem] font-bold uppercase tracking-wider mb-4" style={{ color: '#1c1b1b' }}>Metadata</h2>
        <div className="space-y-4">
          <Field label="Metric Name">
            {editing ? (
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setField('name', e.target.value)}
                className="w-full px-3 py-2 text-[0.875rem]"
                style={inputStyle}
              />
            ) : (
              metric.name
            )}
          </Field>

          <Field label="Short Description">
            {editing ? (
              <input
                type="text"
                value={draft.shortDescription}
                onChange={(e) => setField('shortDescription', e.target.value)}
                placeholder="One-line summary shown on metric cards."
                className="w-full px-3 py-2 text-[0.875rem]"
                style={inputStyle}
              />
            ) : (
              metric.shortDescription || <span style={{ color: '#7a7574' }}>—</span>
            )}
          </Field>

          <Field label="Description">
            {editing ? (
              <textarea
                value={draft.description}
                onChange={(e) => setField('description', e.target.value)}
                rows={6}
                placeholder="What does this metric measure, and why?"
                className="w-full px-3 py-2 text-[0.875rem]"
                style={inputStyle}
              />
            ) : (
              <p style={{ whiteSpace: 'pre-wrap' }}>{metric.description || <span style={{ color: '#7a7574' }}>—</span>}</p>
            )}
          </Field>

          {metric.filename && (
            <Field label="Source File">
              <span className="font-mono text-[0.8125rem]" style={{ color: '#b20100' }}>{metric.filename}</span>
            </Field>
          )}
        </div>
      </div>

      {(metric.pythonScript || editing) && (
        <div className="p-5" style={{ backgroundColor: '#ffffff' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[0.875rem] font-bold uppercase tracking-wider" style={{ color: '#1c1b1b' }}>Implementation</h2>
            <span className="text-[0.625rem] font-semibold uppercase tracking-wider" style={{ color: '#7a7574' }}>
              Python · {editing ? 'Editable' : 'Syntax highlighted'}
            </span>
          </div>
          {editing ? (
            <textarea
              value={draft.pythonScript}
              onChange={(e) => setField('pythonScript', e.target.value)}
              rows={16}
              spellCheck={false}
              placeholder="def compute_metric(predictions, references):\n    ..."
              className="w-full p-4 text-[0.75rem]"
              style={codeInputStyle}
            />
          ) : (
            <PythonHighlighter source={metric.pythonScript} />
          )}
        </div>
      )}
    </div>
  );
}
