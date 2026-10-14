'use client';

import { useState, useId } from 'react';
import {
  type FieldType,
  inferType,
  isDollarDate,
} from '@/lib/astra/schema';
import { displayPath } from '@/lib/query/compile';
import {
  validateAndParseFieldValue,
  formatValueForEditor,
} from '@/lib/astra/validation';
import { useTrace } from '@/lib/trace/TraceContext';
import { describeCall } from '@/lib/trace/describe';

interface FieldEditorProps {
  name: string;
  escapedPath: string;
  currentValue: unknown;
  keyspace: string;
  collection: string;
  docId: unknown;
  onSaveSuccess: (updatedValue: unknown) => void;
  onCancel: () => void;
}

export default function FieldEditor({
  name,
  escapedPath,
  currentValue,
  keyspace,
  collection,
  docId,
  onSaveSuccess,
  onCancel,
}: FieldEditorProps) {
  const inputId = useId();
  const isInitialNull = currentValue === null || currentValue === undefined;
  const initialType: FieldType = isInitialNull ? 'string' : inferType(currentValue);
  const [selectedType, setSelectedType] = useState<FieldType>(initialType);
  const fieldType: FieldType = isInitialNull ? selectedType : initialType;

  const [inputValue, setInputValue] = useState<string>(() =>
    formatValueForEditor(fieldType, currentValue),
  );
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const { isPanelOpen, startRun, setVerdict, emitStep, finishRun } = useTrace();

  const validation = validateAndParseFieldValue(fieldType, inputValue, currentValue);

  const handleTypeChange = (newType: FieldType) => {
    setSelectedType(newType);
    setApiError(null);
    if (newType === 'boolean') {
      setInputValue('true');
    } else if (newType === 'null') {
      setInputValue('null');
    } else if (newType === 'isoDate') {
      const now = new Date().toISOString();
      setInputValue(now);
    } else if (newType === 'dollarDate') {
      const now = new Date().toISOString();
      setInputValue(now);
    } else if (newType === 'number') {
      setInputValue('0');
    } else if (newType === 'array') {
      setInputValue('[]');
    } else if (newType === 'object') {
      setInputValue('{}');
    } else {
      setInputValue('');
    }
  };

  const handleReview = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!validation.valid) return;
    setApiError(null);
    setIsConfirming(true);
  };

  const handleConfirmSave = async () => {
    if (!validation.valid) return;
    setIsSaving(true);
    setApiError(null);

    const isTraced = isPanelOpen;
    const fieldLabel = displayPath(escapedPath);

    if (isTraced) {
      startRun({
        sortSpec: [],
        searchMode: 'browse',
        trigger: `Edit "${fieldLabel}"`,
        source: 'query',
      });
      setVerdict({
        handling: 'astra-live',
        reason: `Astra Data API runs an updateOne command to persist changes to "${fieldLabel}".`,
      });
      emitStep({
        where: 'browser',
        status: 'ok',
        label: `Confirmed edit for "${fieldLabel}"`,
        detail: `New value: ${JSON.stringify(validation.parsedValue)}`,
      });
      emitStep({
        where: 'astra',
        status: 'active',
        label: 'Executing updateOne on Astra DB',
        endpoint: 'POST /api/update',
        detail: 'Sending update to Data API…',
      });
    }

    try {
      const res = await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyspace,
          collection,
          id: docId,
          field: escapedPath,
          value: validation.parsedValue,
          trace: isTraced,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        const errorMsg = data.error || 'Failed to update field.';
        setApiError(errorMsg);
        setIsSaving(false);
        if (isTraced) {
          if (Array.isArray(data.calls)) {
            for (const call of data.calls) {
              const { title, detail } = describeCall(call);
              emitStep({
                where: 'astra',
                status: 'error',
                label: title,
                endpoint: `${call.method} ${call.path}`,
                durationMs: call.ms,
                detail: detail || `Call failed (${call.ms} ms)`,
                call,
              });
            }
          }
          finishRun('error', errorMsg);
        }
        return;
      }

      if (isTraced) {
        if (Array.isArray(data.calls)) {
          for (const call of data.calls) {
            const { title, detail } = describeCall(call);
            emitStep({
              where: 'astra',
              status: 'ok',
              label: title,
              endpoint: `${call.method} ${call.path}`,
              durationMs: call.ms,
              detail: detail || `Updated document field in Astra DB (${call.ms} ms)`,
              call,
            });
          }
        }
        emitStep({
          where: 'browser',
          status: 'ok',
          label: 'Updated document in UI',
          detail: 'Detail panel and grid updated with the new value.',
        });
        finishRun('ok');
      }

      onSaveSuccess(validation.parsedValue);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Network error occurred.';
      setApiError(errorMsg);
      setIsSaving(false);
      if (isTraced) {
        finishRun('error', errorMsg);
      }
    }
  };

  const setPresetDate = (type: 'now-iso' | 'today') => {
    const now = new Date();
    if (type === 'today') {
      const dateOnly = now.toISOString().slice(0, 10);
      setInputValue(dateOnly);
    } else {
      setInputValue(now.toISOString());
    }
    setApiError(null);
  };

  const buttonClass =
    'px-2 py-1 text-xs font-medium rounded border disabled:opacity-40 disabled:cursor-not-allowed transition-colors';
  const buttonStyle = {
    background: 'var(--astra-surface)',
    borderColor: 'var(--astra-border)',
    color: 'var(--astra-text)',
  };

  const formatDisplayValue = (val: unknown): string => {
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (isDollarDate(val)) return `$date: ${new Date(val.$date).toISOString()} (${val.$date})`;
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  };

  return (
    <div
      className="my-1.5 rounded border p-2.5 text-xs"
      style={{
        background: 'var(--astra-surface)',
        borderColor: 'var(--astra-accent)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      role="region"
      aria-label={`Edit ${name}`}
    >
      <div className="flex items-center justify-between gap-2 border-b pb-1.5 mb-2" style={{ borderColor: 'var(--astra-border)' }}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold" style={{ color: 'var(--astra-text)' }}>
            Editing: <code className="font-mono text-xs">{displayPath(escapedPath)}</code>
          </span>
          <span
            className="rounded px-1.5 py-0.2 font-mono text-[10px] uppercase font-bold tracking-wider"
            style={{
              background: 'color-mix(in srgb, var(--astra-accent) 20%, transparent)',
              color: 'var(--astra-accent)',
            }}
            title={isInitialNull ? 'Setting value for empty field' : `Field type: ${fieldType} (constrained)`}
          >
            {isInitialNull && fieldType !== 'null' ? `null → ${fieldType}` : fieldType}
          </span>
        </div>

        {isInitialNull && !isConfirming ? (
          <label className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--astra-muted)' }}>
            Set as:
            <select
              value={selectedType}
              onChange={(e) => handleTypeChange(e.target.value as FieldType)}
              className="rounded border px-1 py-0.5 text-xs bg-transparent"
              style={{ borderColor: 'var(--astra-border)', color: 'var(--astra-text)' }}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="isoDate">isoDate (ISO-8601)</option>
              <option value="dollarDate">$date (Extended JSON)</option>
              <option value="object">object (JSON)</option>
              <option value="array">array (JSON)</option>
              <option value="null">null (empty)</option>
            </select>
          </label>
        ) : (
          <span className="text-[11px]" style={{ color: 'var(--astra-muted)' }}>
            Type: <span className="font-mono font-medium">{fieldType}</span>
          </span>
        )}
      </div>

      {apiError && (
        <div
          role="alert"
          className="mb-2 rounded border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--astra-error)', color: 'var(--astra-error)', background: 'color-mix(in srgb, var(--astra-error) 10%, transparent)' }}
        >
          {apiError}
        </div>
      )}

      {!isConfirming ? (
        <form onSubmit={handleReview} className="flex flex-col gap-2">
          {/* Input control constrained by the current datatype */}
          {fieldType === 'boolean' ? (
            <div className="flex items-center gap-2 py-1">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name={`bool-${inputId}`}
                  value="true"
                  checked={inputValue === 'true'}
                  onChange={() => setInputValue('true')}
                />
                <span style={{ color: '#79c0ff' }}>true</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name={`bool-${inputId}`}
                  value="false"
                  checked={inputValue === 'false'}
                  onChange={() => setInputValue('false')}
                />
                <span style={{ color: '#ffa657' }}>false</span>
              </label>
            </div>
          ) : fieldType === 'null' ? (
            <div className="py-1" style={{ color: 'var(--astra-muted)' }}>
              Value is <code className="font-mono">null</code>
            </div>
          ) : fieldType === 'object' || fieldType === 'array' ? (
            <div>
              <textarea
                id={inputId}
                rows={4}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full font-mono rounded border p-1.5 text-xs"
                style={{
                  background: 'var(--astra-bg)',
                  borderColor: validation.valid ? 'var(--astra-border)' : 'var(--astra-error)',
                  color: 'var(--astra-text)',
                }}
                placeholder={fieldType === 'array' ? '[\n  "item1"\n]' : '{\n  "key": "value"\n}'}
              />
            </div>
          ) : (
            <div>
              <input
                id={inputId}
                type={fieldType === 'number' ? 'number' : 'text'}
                step={fieldType === 'number' ? 'any' : undefined}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full font-mono rounded border px-2 py-1 text-xs"
                style={{
                  background: 'var(--astra-bg)',
                  borderColor: validation.valid ? 'var(--astra-border)' : 'var(--astra-error)',
                  color: 'var(--astra-text)',
                }}
                placeholder={
                  fieldType === 'isoDate'
                    ? '2024-01-15T12:00:00Z'
                    : fieldType === 'dollarDate'
                      ? '2024-01-15T12:00:00Z or epoch millis'
                      : 'Enter value'
                }
                autoFocus
              />

              {(fieldType === 'isoDate' || fieldType === 'dollarDate') && (
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className="text-[11px]" style={{ color: 'var(--astra-muted)' }}>
                    Presets:
                  </span>
                  <button
                    type="button"
                    className="rounded border px-1.5 py-0.5 text-[11px]"
                    style={buttonStyle}
                    onClick={() => setPresetDate('now-iso')}
                  >
                    Current UTC Time
                  </button>
                  <button
                    type="button"
                    className="rounded border px-1.5 py-0.5 text-[11px]"
                    style={buttonStyle}
                    onClick={() => setPresetDate('today')}
                  >
                    Today (YYYY-MM-DD)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Datatype validation check feedback */}
          {!validation.valid && (
            <div className="text-[11px] flex items-center gap-1" style={{ color: 'var(--astra-error)' }}>
              <span>⚠️</span>
              <span>{validation.error}</span>
            </div>
          )}

          {validation.valid && fieldType === 'dollarDate' && validation.parsedValue !== undefined && (
            <div className="text-[11px]" style={{ color: 'var(--astra-muted)' }}>
              Extended JSON preview: <code className="font-mono">{JSON.stringify(validation.parsedValue)}</code>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-1 border-t" style={{ borderColor: 'var(--astra-border)' }}>
            <button
              type="button"
              className={buttonClass}
              style={buttonStyle}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={buttonClass}
              style={{
                ...buttonStyle,
                background: 'var(--astra-accent)',
                borderColor: 'var(--astra-accent)',
                color: '#fff',
              }}
              disabled={!validation.valid}
            >
              Review & Save
            </button>
          </div>
        </form>
      ) : (
        /* Confirmation step */
        <div className="flex flex-col gap-2">
          <div
            className="rounded p-2 text-xs flex flex-col gap-1.5"
            style={{
              background: 'var(--astra-bg)',
              borderColor: 'var(--astra-border)',
              borderWidth: 1,
            }}
          >
            <div className="font-semibold" style={{ color: 'var(--astra-text)' }}>
              Confirm Update
            </div>
            <div className="text-[11px]" style={{ color: 'var(--astra-muted)' }}>
              Are you sure you want to update <code className="font-mono font-bold">{displayPath(escapedPath)}</code> ({fieldType})?
            </div>

            <div className="flex flex-col gap-1 mt-1 font-mono text-[11px]">
              <div className="flex items-start gap-2">
                <span className="text-red-400 font-bold shrink-0">Current:</span>
                <span className="break-all opacity-80">{formatDisplayValue(currentValue)}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-green-400 font-bold shrink-0">New:</span>
                <span className="break-all font-semibold">{formatDisplayValue(validation.parsedValue)}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1 border-t" style={{ borderColor: 'var(--astra-border)' }}>
            <button
              type="button"
              className={buttonClass}
              style={buttonStyle}
              onClick={() => setIsConfirming(false)}
              disabled={isSaving}
            >
              Back
            </button>
            <button
              type="button"
              className={buttonClass}
              style={{
                ...buttonStyle,
                background: 'var(--astra-accent)',
                borderColor: 'var(--astra-accent)',
                color: '#fff',
              }}
              onClick={handleConfirmSave}
              disabled={isSaving}
            >
              {isSaving ? 'Updating Astra DB…' : 'Confirm & Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
