'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  Combinator,
  Condition,
  ConditionOp,
  FilterGroup,
  FilterTree,
  FilterValue,
} from '@/lib/query/types';
import {
  type FieldInfo,
  type FieldType,
  deriveFields,
  isFieldIndexed,
} from '@/lib/astra/schema';
import { displayPath, validateFilter } from '@/lib/query/compile';
import type { CollectionCapabilities } from '@/lib/astra/gateway';

export interface FilterBuilderProps {
  documents: Record<string, unknown>[];
  appliedFilter: FilterTree;
  indexing?: CollectionCapabilities['indexing'];
  onApply: (filter: FilterTree) => void;
  onClose?: () => void;
}

const ALL_TYPE_OPS: { op: ConditionOp; label: string }[] = [
  { op: 'eq', label: 'is' },
  { op: 'ne', label: 'is not' },
  { op: 'exists', label: 'exists' },
  { op: 'notExists', label: 'does not exist' },
  { op: 'in', label: 'is one of' },
  { op: 'nin', label: 'is none of' },
];

const COMPARISON_OPS: { op: ConditionOp; label: string }[] = [
  { op: 'gt', label: 'greater than (>)' },
  { op: 'gte', label: 'at least (>=)' },
  { op: 'lt', label: 'less than (<)' },
  { op: 'lte', label: 'at most (<=)' },
  { op: 'between', label: 'between' },
];

const DATE_OPS: { op: ConditionOp; label: string }[] = [
  { op: 'before', label: 'before' },
  { op: 'after', label: 'after' },
  { op: 'dateBetween', label: 'between' },
];

const ARRAY_OPS: { op: ConditionOp; label: string }[] = [
  { op: 'containsAny', label: 'contains any' },
  { op: 'containsAll', label: 'contains all' },
  { op: 'sizeIs', label: 'has N items' },
];

const BOOLEAN_OPS: { op: ConditionOp; label: string }[] = [
  { op: 'isTrue', label: 'is true' },
  { op: 'isFalse', label: 'is false' },
];

function getOpsForType(type: FieldType): { op: ConditionOp; label: string }[] {
  switch (type) {
    case 'number':
      return [...ALL_TYPE_OPS, ...COMPARISON_OPS];
    case 'string':
    case 'mixed':
      return [...ALL_TYPE_OPS, ...COMPARISON_OPS];
    case 'isoDate':
    case 'dollarDate':
      return [...ALL_TYPE_OPS, ...DATE_OPS];
    case 'array':
      return [...ALL_TYPE_OPS, ...ARRAY_OPS];
    case 'boolean':
      return [...ALL_TYPE_OPS, ...BOOLEAN_OPS];
    default:
      return ALL_TYPE_OPS;
  }
}

function parseInputVal(raw: string, type: FieldType): FilterValue {
  if (type === 'number') {
    const n = Number(raw);
    return Number.isNaN(n) ? raw : n;
  }
  return raw;
}

function parseMultiVals(raw: string, type: FieldType): FilterValue[] {
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (type === 'number' && !Number.isNaN(Number(s)) ? Number(s) : s));
}

function formatMultiVals(values?: FilterValue[]): string {
  if (!values || values.length === 0) return '';
  return values.map((v) => String(v ?? '')).join(', ');
}

export default function FilterBuilder({
  documents,
  appliedFilter,
  indexing,
  onApply,
  onClose,
}: FilterBuilderProps) {
  // Retain previously derived fields so empty query results don't blank out field picker
  const [availableFields, setAvailableFields] = useState<FieldInfo[]>(() => deriveFields(documents));

  useEffect(() => {
    if (documents.length > 0) {
      const derived = deriveFields(documents);
      if (derived.length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAvailableFields(derived);
      }
    }
  }, [documents]);

  const fieldMap = useMemo(
    () => new Map(availableFields.map((f) => [f.escapedPath, f])),
    [availableFields],
  );

  const [draft, setDraft] = useState<FilterTree>(() => appliedFilter);

  const defaultField = useMemo(() => {
    const firstIndexed = availableFields.find((f) => isFieldIndexed(f.escapedPath, indexing));
    return firstIndexed?.escapedPath ?? availableFields[0]?.escapedPath ?? '_id';
  }, [availableFields, indexing]);

  const createDefaultCondition = (): Condition => ({
    kind: 'condition',
    field: defaultField,
    op: 'eq',
    value: '',
  });

  const isDraftDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(appliedFilter),
    [draft, appliedFilter],
  );

  const validationIssues = useMemo(() => {
    return validateFilter(draft, { indexing });
  }, [draft, indexing]);

  const hasErrors = validationIssues.length > 0;

  // Handlers for modifying draft
  const setCombinator = (combinator: Combinator) => {
    setDraft((prev) => ({ ...prev, combinator }));
  };

  const addRootCondition = () => {
    setDraft((prev) => ({
      ...prev,
      children: [...prev.children, createDefaultCondition()],
    }));
  };

  const addRootGroup = () => {
    const newGroup: FilterGroup = {
      kind: 'group',
      combinator: 'and',
      not: false,
      children: [createDefaultCondition()],
    };
    setDraft((prev) => ({
      ...prev,
      children: [...prev.children, newGroup],
    }));
  };

  const removeRootChild = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      children: prev.children.filter((_, i) => i !== index),
    }));
  };

  const updateRootCondition = (index: number, updated: Condition) => {
    setDraft((prev) => {
      const next = [...prev.children];
      next[index] = updated;
      return { ...prev, children: next };
    });
  };

  const updateRootGroup = (index: number, updated: FilterGroup) => {
    setDraft((prev) => {
      const next = [...prev.children];
      next[index] = updated;
      return { ...prev, children: next };
    });
  };

  const handleApply = () => {
    if (hasErrors) return;
    onApply(draft);
  };

  const handleClearAll = () => {
    const empty: FilterTree = { combinator: 'and', children: [] };
    setDraft(empty);
    onApply(empty);
  };

  const buttonStyle = {
    background: 'var(--astra-surface)',
    borderColor: 'var(--astra-border)',
    color: 'var(--astra-text)',
  };

  return (
    <div
      className="flex flex-col gap-3 rounded border p-3 text-xs mb-1"
      style={{
        background: 'var(--astra-surface)',
        borderColor: 'var(--astra-border)',
      }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm" style={{ color: 'var(--astra-text)' }}>
            Filter Builder
          </span>
          <div className="inline-flex rounded border" style={{ borderColor: 'var(--astra-border)' }}>
            <button
              type="button"
              className={`px-2 py-0.5 rounded-l text-xs font-medium ${
                draft.combinator === 'and' ? 'bg-[var(--astra-accent)] text-white' : ''
              }`}
              onClick={() => setCombinator('and')}
            >
              AND (Match All)
            </button>
            <button
              type="button"
              className={`px-2 py-0.5 rounded-r text-xs font-medium ${
                draft.combinator === 'or' ? 'bg-[var(--astra-accent)] text-white' : ''
              }`}
              onClick={() => setCombinator('or')}
            >
              OR (Match Any)
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-2.5 py-1 rounded border text-xs font-medium disabled:opacity-40"
            style={buttonStyle}
            onClick={addRootCondition}
          >
            + Add Condition
          </button>
          <button
            type="button"
            className="px-2.5 py-1 rounded border text-xs font-medium disabled:opacity-40"
            style={buttonStyle}
            onClick={addRootGroup}
          >
            + Add Group
          </button>
          <button
            type="button"
            className="px-2.5 py-1 rounded border text-xs font-medium disabled:opacity-40 text-red-400"
            style={buttonStyle}
            onClick={handleClearAll}
          >
            Clear All
          </button>
          <button
            type="button"
            className="px-3 py-1 rounded border text-xs font-semibold bg-[var(--astra-accent)] text-white disabled:opacity-40"
            onClick={handleApply}
            disabled={hasErrors}
          >
            Apply {isDraftDirty ? '*' : ''}
          </button>
          {onClose && (
            <button
              type="button"
              className="p-1 rounded text-base leading-none hover:opacity-75"
              style={{ color: 'var(--astra-muted)' }}
              onClick={onClose}
              title="Close panel"
              aria-label="Close panel"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {validationIssues.length > 0 && (
        <div
          role="alert"
          className="rounded border p-2 text-xs"
          style={{ borderColor: 'var(--astra-error)', color: 'var(--astra-error)' }}
        >
          <ul className="list-disc pl-4 space-y-0.5">
            {validationIssues.map((issue, idx) => (
              <li key={idx}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {draft.children.length === 0 ? (
        <div
          className="rounded border border-dashed p-4 text-center text-xs"
          style={{ borderColor: 'var(--astra-border)', color: 'var(--astra-muted)' }}
        >
          No filter conditions. Click <strong>+ Add Condition</strong> or{' '}
          <strong>+ Add Group</strong> to build a filter query.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {draft.children.map((child, index) => {
            if (child.kind === 'condition') {
              return (
                <ConditionRow
                  key={`root-cond-${index}`}
                  condition={child}
                  fields={availableFields}
                  fieldMap={fieldMap}
                  indexing={indexing}
                  onChange={(c) => updateRootCondition(index, c)}
                  onRemove={() => removeRootChild(index)}
                />
              );
            }
            return (
              <GroupCard
                key={`root-group-${index}`}
                group={child}
                fields={availableFields}
                fieldMap={fieldMap}
                indexing={indexing}
                createDefaultCondition={createDefaultCondition}
                onChange={(g) => updateRootGroup(index, g)}
                onRemove={() => removeRootChild(index)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Condition Row Component ────────────────────────────────────────────────

interface ConditionRowProps {
  condition: Condition;
  fields: FieldInfo[];
  fieldMap: Map<string, FieldInfo>;
  indexing?: CollectionCapabilities['indexing'];
  onChange: (updated: Condition) => void;
  onRemove: () => void;
}

function ConditionRow({
  condition,
  fields,
  fieldMap,
  indexing,
  onChange,
  onRemove,
}: ConditionRowProps) {
  const currentFieldInfo = fieldMap.get(condition.field);
  const fieldType: FieldType = currentFieldInfo?.type ?? 'string';
  const ops = useMemo(() => getOpsForType(fieldType), [fieldType]);

  const isIndexed = isFieldIndexed(condition.field, indexing);

  const inputStyle = {
    background: 'var(--astra-sidebar)',
    borderColor: 'var(--astra-border)',
    color: 'var(--astra-text)',
  };

  const showKeywordHint =
    (fieldType === 'string' || fieldType === 'mixed') &&
    (condition.op === 'eq' || condition.op === 'ne' || condition.op === 'in');

  const handleFieldChange = (newField: string) => {
    const newInfo = fieldMap.get(newField);
    const newType = newInfo?.type ?? 'string';
    const newOps = getOpsForType(newType);
    const opStillValid = newOps.some((o) => o.op === condition.op);
    const nextOp = opStillValid ? condition.op : newOps[0]?.op ?? 'eq';
    onChange({
      ...condition,
      field: newField,
      op: nextOp,
    });
  };

  const handleOpChange = (newOp: ConditionOp) => {
    onChange({ ...condition, op: newOp });
  };

  return (
    <div className="flex flex-col gap-1 rounded border p-2" style={{ borderColor: 'var(--astra-border)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Field Select */}
        <select
          value={condition.field}
          onChange={(e) => handleFieldChange(e.target.value)}
          className="rounded border px-2 py-1 text-xs"
          style={inputStyle}
          aria-label="Filter field"
        >
          {fields.map((f) => {
            const indexed = isFieldIndexed(f.escapedPath, indexing);
            return (
              <option
                key={f.escapedPath}
                value={f.escapedPath}
                disabled={!indexed}
                title={indexed ? undefined : 'Not indexed'}
              >
                {f.path} ({f.type}){indexed ? '' : ' — (Not indexed)'}
              </option>
            );
          })}
          {!currentFieldInfo && (
            <option value={condition.field}>{displayPath(condition.field)}</option>
          )}
        </select>

        {/* Operator Select */}
        <select
          value={condition.op}
          onChange={(e) => handleOpChange(e.target.value as ConditionOp)}
          className="rounded border px-2 py-1 text-xs"
          style={inputStyle}
          aria-label="Filter operator"
        >
          {ops.map((o) => (
            <option key={o.op} value={o.op}>
              {o.label}
            </option>
          ))}
        </select>

        {/* Value Input by Operator */}
        <ValueInput
          condition={condition}
          fieldType={fieldType}
          onChange={onChange}
          inputStyle={inputStyle}
        />

        {/* Remove Button */}
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto px-2 py-0.5 rounded text-xs hover:bg-red-900/30 text-red-400"
          title="Remove condition"
          aria-label="Remove condition"
        >
          ✕
        </button>
      </div>

      {!isIndexed && (
        <p className="text-[11px] text-amber-400">
          ⚠️ Field &quot;{displayPath(condition.field)}&quot; is not indexed in this collection.
        </p>
      )}

      {showKeywordHint && (
        <p className="text-[11px]" style={{ color: 'var(--astra-muted)' }}>
          ℹ️ The Data API has no contains/regex for text. Use Keyword search for word matching.
        </p>
      )}
    </div>
  );
}

// ─── Value Input Component ──────────────────────────────────────────────────

interface ValueInputProps {
  condition: Condition;
  fieldType: FieldType;
  onChange: (updated: Condition) => void;
  inputStyle: React.CSSProperties;
}

function ValueInput({ condition, fieldType, onChange, inputStyle }: ValueInputProps) {
  const { op, value, value2, values } = condition;

  // No input for unary ops
  if (op === 'isTrue' || op === 'isFalse' || op === 'exists' || op === 'notExists') {
    return null;
  }

  // Multi-value list for in / nin / containsAny / containsAll
  if (op === 'in' || op === 'nin' || op === 'containsAny' || op === 'containsAll') {
    return (
      <input
        type="text"
        placeholder="val1, val2, val3..."
        value={formatMultiVals(values)}
        onChange={(e) =>
          onChange({
            ...condition,
            values: parseMultiVals(e.target.value, fieldType),
          })
        }
        className="flex-1 min-w-[150px] rounded border px-2 py-1 text-xs"
        style={inputStyle}
      />
    );
  }

  // Range inputs for between / dateBetween
  if (op === 'between' || op === 'dateBetween') {
    const isDate = op === 'dateBetween' || fieldType === 'isoDate' || fieldType === 'dollarDate';
    const inputType = isDate ? 'date' : fieldType === 'number' ? 'number' : 'text';

    return (
      <div className="flex items-center gap-1 flex-1 min-w-[200px]">
        <input
          type={inputType}
          placeholder="Min / From"
          value={String(value ?? '')}
          onChange={(e) =>
            onChange({
              ...condition,
              value: parseInputVal(e.target.value, fieldType),
            })
          }
          className="w-full rounded border px-2 py-1 text-xs"
          style={inputStyle}
        />
        <span style={{ color: 'var(--astra-muted)' }}>to</span>
        <input
          type={inputType}
          placeholder="Max / To"
          value={String(value2 ?? '')}
          onChange={(e) =>
            onChange({
              ...condition,
              value2: parseInputVal(e.target.value, fieldType),
            })
          }
          className="w-full rounded border px-2 py-1 text-xs"
          style={inputStyle}
        />
      </div>
    );
  }

  // Dates for before / after
  if (op === 'before' || op === 'after') {
    return (
      <input
        type="date"
        value={String(value ?? '')}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
        className="flex-1 min-w-[140px] rounded border px-2 py-1 text-xs"
        style={inputStyle}
      />
    );
  }

  // Size for sizeIs
  if (op === 'sizeIs') {
    return (
      <input
        type="number"
        min={0}
        placeholder="Count"
        value={value !== undefined ? String(value) : ''}
        onChange={(e) =>
          onChange({
            ...condition,
            value: Number.parseInt(e.target.value, 10) || 0,
          })
        }
        className="w-24 rounded border px-2 py-1 text-xs"
        style={inputStyle}
      />
    );
  }

  // Single scalar value
  const inputType = fieldType === 'number' ? 'number' : 'text';
  return (
    <input
      type={inputType}
      placeholder="Value"
      value={value !== undefined && value !== null ? String(value) : ''}
      onChange={(e) =>
        onChange({
          ...condition,
          value: parseInputVal(e.target.value, fieldType),
        })
      }
      className="flex-1 min-w-[120px] rounded border px-2 py-1 text-xs"
      style={inputStyle}
    />
  );
}

// ─── Group Card Component ───────────────────────────────────────────────────

interface GroupCardProps {
  group: FilterGroup;
  fields: FieldInfo[];
  fieldMap: Map<string, FieldInfo>;
  indexing?: CollectionCapabilities['indexing'];
  createDefaultCondition: () => Condition;
  onChange: (updated: FilterGroup) => void;
  onRemove: () => void;
}

function GroupCard({
  group,
  fields,
  fieldMap,
  indexing,
  createDefaultCondition,
  onChange,
  onRemove,
}: GroupCardProps) {
  const setCombinator = (combinator: Combinator) => {
    onChange({ ...group, combinator });
  };

  const toggleNot = () => {
    onChange({ ...group, not: !group.not });
  };

  const addCondition = () => {
    onChange({
      ...group,
      children: [...group.children, createDefaultCondition()],
    });
  };

  const updateCondition = (idx: number, updated: Condition) => {
    const next = [...group.children];
    next[idx] = updated;
    onChange({ ...group, children: next });
  };

  const removeCondition = (idx: number) => {
    onChange({
      ...group,
      children: group.children.filter((_, i) => i !== idx),
    });
  };

  const buttonStyle = {
    background: 'var(--astra-surface)',
    borderColor: 'var(--astra-border)',
    color: 'var(--astra-text)',
  };

  return (
    <div
      className="flex flex-col gap-2 rounded border-l-4 border p-2.5"
      style={{
        background: 'var(--astra-sidebar)',
        borderColor: 'var(--astra-border)',
        borderLeftColor: group.not ? 'var(--astra-error)' : 'var(--astra-accent)',
      }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-xs" style={{ color: 'var(--astra-muted)' }}>
            Group
          </span>
          <div className="inline-flex rounded border" style={{ borderColor: 'var(--astra-border)' }}>
            <button
              type="button"
              className={`px-2 py-0.5 rounded-l text-xs font-medium ${
                group.combinator === 'and' ? 'bg-[var(--astra-accent)] text-white' : ''
              }`}
              onClick={() => setCombinator('and')}
            >
              AND
            </button>
            <button
              type="button"
              className={`px-2 py-0.5 rounded-r text-xs font-medium ${
                group.combinator === 'or' ? 'bg-[var(--astra-accent)] text-white' : ''
              }`}
              onClick={() => setCombinator('or')}
            >
              OR
            </button>
          </div>

          <label className="flex items-center gap-1 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={group.not}
              onChange={toggleNot}
              className="rounded"
            />
            <span className={group.not ? 'text-red-400 font-bold' : ''}>NOT (Invert)</span>
          </label>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="px-2 py-0.5 rounded border text-xs"
            style={buttonStyle}
            onClick={addCondition}
          >
            + Add Condition
          </button>
          <button
            type="button"
            className="px-2 py-0.5 rounded border text-xs text-red-400"
            style={buttonStyle}
            onClick={onRemove}
            title="Remove group"
          >
            Remove Group
          </button>
        </div>
      </div>

      {group.children.length === 0 ? (
        <p className="text-xs italic" style={{ color: 'var(--astra-muted)' }}>
          Empty group. Add conditions above.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 pl-2 border-l" style={{ borderColor: 'var(--astra-border)' }}>
          {group.children.map((cond, idx) => (
            <ConditionRow
              key={idx}
              condition={cond}
              fields={fields}
              fieldMap={fieldMap}
              indexing={indexing}
              onChange={(c) => updateCondition(idx, c)}
              onRemove={() => removeCondition(idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
