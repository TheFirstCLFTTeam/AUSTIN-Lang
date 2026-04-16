'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Dialog from '../../components/Dialog';
import { MAX_SELECTED_METRICS } from '../../../../services/mock_data-dashboard';
import {
  addCustomMetric,
  extractPythonDocstring,
  getAllMetrics,
  getSelectedMetricIds,
  inferMetricNameFromFilename,
  setSelectedMetricIds,
} from '../../../../services/metrics-config';

const inputStyle = { backgroundColor: '#f6f3f2', border: 'none', borderBottom: '2px solid #c4c4c4', borderRadius: '0px', color: '#1c1b1b' };

function FormField({ label, children, hint }) {
  return (
    <div>
      <label className="block text-[0.6875rem] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#7a7574' }}>{label}</label>
      {children}
      {hint && <p className="text-[0.625rem] mt-1" style={{ color: '#7a7574' }}>{hint}</p>}
    </div>
  );
}

function AddMetricDialog({ open, onClose, onSaved }) {
  const [filename, setFilename] = useState('');
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const reset = () => {
    setFilename('');
    setSource('');
    setName('');
    setShortDescription('');
    setDescription('');
    setError('');
  };

  useEffect(() => { if (!open) reset(); }, [open]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.py')) {
      setError('Please upload a .py file.');
      return;
    }
    setError('');
    const text = await file.text();
    setSource(text);
    setFilename(file.name);
    setName((prev) => prev || inferMetricNameFromFilename(file.name));
    const docstring = extractPythonDocstring(text);
    if (docstring) setDescription((prev) => prev || docstring);
  };

  const handleSave = () => {
    if (!filename) { setError('Upload a Python script first.'); return; }
    if (!name.trim()) { setError('Name is required.'); return; }
    const id = `custom_${Date.now()}`;
    addCustomMetric({
      id,
      label: name.trim(),
      description: description.trim(),
      value: '—',
      sublabel: 'Awaiting first evaluation',
      custom: true,
      filename,
      source,
    });
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="ADD CUSTOM METRIC">
      <div className="space-y-4">
        <FormField label="Python Script" hint="Upload first — we'll extract name and description from the file's docstring if present.">
          <label className="block w-full px-3 py-3 text-[0.8125rem] cursor-pointer text-center" style={{ backgroundColor: '#f6f3f2', border: '1.5px dashed #c4c4c4', color: '#1c1b1b' }}>
            {filename ? filename : 'CLICK TO UPLOAD .PY FILE'}
            <input type="file" accept=".py,text/x-python" onChange={handleFile} className="hidden" />
          </label>
        </FormField>

        <FormField label="Metric Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Edit Density"
            className="w-full px-3 py-2 text-[0.8125rem]"
            style={inputStyle}
          />
        </FormField>

        <FormField label="Description" hint={source && !extractPythonDocstring(source) ? 'No docstring found — please write a description manually.' : undefined}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="What does this metric measure?"
            className="w-full px-3 py-2 text-[0.8125rem]"
            style={inputStyle}
          />
        </FormField>

        {error && <p className="text-[0.75rem]" style={{ color: '#b20100' }}>{error}</p>}

        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} className="flex-1 py-2.5 text-[0.8125rem] font-semibold cursor-pointer" style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: '0px' }}>
            SAVE METRIC
          </button>
          <button onClick={onClose} className="px-6 py-2.5 text-[0.8125rem] font-medium cursor-pointer" style={{ backgroundColor: 'transparent', border: '1.5px solid rgba(233, 188, 181, 0.3)', borderRadius: '0px', color: '#1c1b1b' }}>
            CANCEL
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export default function ConfigureMetricsPage() {
  const router = useRouter();
  const [allMetrics, setAllMetrics] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = () => {
    setAllMetrics(getAllMetrics());
    setSelectedIds(getSelectedMetricIds());
  };

  useEffect(() => { refresh(); }, []);

  const toggle = (id) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECTED_METRICS) return prev;
      return [...prev, id];
    });
  };

  const handleSave = () => {
    setSelectedMetricIds(selectedIds);
    router.push('/dashboard');
  };

  const atLimit = selectedIds.length >= MAX_SELECTED_METRICS;

  const grouped = useMemo(() => ({
    builtIn: allMetrics.filter((m) => !m.custom),
    custom: allMetrics.filter((m) => m.custom),
  }), [allMetrics]);

  return (
    <div>
      <div className="flex items-center gap-2 text-[0.6875rem] mb-1" style={{ color: '#7a7574' }}>
        <Link href="/dashboard" className="uppercase tracking-wider" style={{ color: '#7a7574', textDecoration: 'none' }}>Dashboard</Link>
        <span>/</span>
        <span className="uppercase tracking-wider" style={{ color: '#b20100' }}>Configure Metrics</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[2rem] font-bold tracking-tight" style={{ color: '#1c1b1b', letterSpacing: '-0.02em' }}>
          DASHBOARD METRICS
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-[0.6875rem]" style={{ color: '#7a7574' }}>
            {selectedIds.length} / {MAX_SELECTED_METRICS} SELECTED
          </span>
          <button onClick={() => setDialogOpen(true)} className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer" style={{ backgroundColor: 'transparent', border: '1.5px solid rgba(233, 188, 181, 0.3)', borderRadius: '0px', color: '#1c1b1b' }}>
            + ADD METRIC
          </button>
          <button onClick={handleSave} className="px-4 py-2 text-[0.8125rem] font-semibold cursor-pointer" style={{ background: 'linear-gradient(135deg, #b20100, #e10000)', color: '#ffffff', border: 'none', borderRadius: '0px' }}>
            SAVE &amp; RETURN
          </button>
        </div>
      </div>

      <p className="text-[0.8125rem] mb-6" style={{ color: '#7a7574' }}>
        Select up to {MAX_SELECTED_METRICS} metrics to display as KPI cards on the dashboard. Unselected metrics remain available and can be swapped in later.
      </p>

      <MetricSection title="Built-in Metrics" metrics={grouped.builtIn} selectedIds={selectedIds} onToggle={toggle} atLimit={atLimit} />

      {grouped.custom.length > 0 && (
        <div className="mt-8">
          <MetricSection title="Custom Metrics" metrics={grouped.custom} selectedIds={selectedIds} onToggle={toggle} atLimit={atLimit} />
        </div>
      )}

      <AddMetricDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={refresh} />
    </div>
  );
}

function MetricSection({ title, metrics, selectedIds, onToggle, atLimit }) {
  return (
    <div>
      <h2 className="text-[0.875rem] font-bold uppercase tracking-wider mb-3" style={{ color: '#1c1b1b' }}>{title}</h2>
      <div className="grid grid-cols-3 gap-4">
        {metrics.map((m) => {
          const selected = selectedIds.includes(m.id);
          const disabled = !selected && atLimit;
          return (
            <button
              key={m.id}
              onClick={() => onToggle(m.id)}
              disabled={disabled}
              className="p-5 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 transition-all"
              style={{
                backgroundColor: '#ffffff',
                border: selected ? '2px solid #b20100' : '2px solid transparent',
                borderRadius: '0px',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: '#7a7574' }}>{m.label}</p>
                <span
                  className="inline-block w-4 h-4"
                  style={{
                    backgroundColor: selected ? '#b20100' : 'transparent',
                    border: `1.5px solid ${selected ? '#b20100' : '#c4c4c4'}`,
                  }}
                >
                  {selected && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="square">
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  )}
                </span>
              </div>
              <p className="text-[1.75rem] font-bold mb-1" style={{ color: '#1c1b1b', letterSpacing: '-0.02em' }}>{m.value}</p>
              <p className="text-[0.6875rem]" style={{ color: '#7a7574' }}>{m.sublabel}</p>
              {m.description && <p className="text-[0.6875rem] mt-2 italic" style={{ color: '#7a7574' }}>{m.description}</p>}
              {m.filename && <p className="text-[0.625rem] mt-2 font-mono" style={{ color: '#b20100' }}>{m.filename}</p>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
