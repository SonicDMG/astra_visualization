// Pure module (plus guarded localStorage access): persisted column layout per collection.

export type ColumnLayout = {
  /** Column id -> visible. Missing ids are visible. `$vector` defaults to hidden. */
  columnVisibility: Record<string, boolean>;
  /** User-chosen column order (column ids). May contain ids that are not currently shown. */
  columnOrder: string[];
  /** Column id -> width in px. */
  columnSizing: Record<string, number>;
  /** Escaped paths of expanded object columns. */
  expanded: string[];
};

export function layoutStorageKey(keyspace: string, collection: string): string {
  return `astra-col-layout-${keyspace}-${collection}`;
}

export function defaultLayout(): ColumnLayout {
  return { columnVisibility: { $vector: false }, columnOrder: [], columnSizing: {}, expanded: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function loadLayout(keyspace: string, collection: string): ColumnLayout {
  const layout = defaultLayout();
  if (typeof window === 'undefined') return layout;
  try {
    const raw = window.localStorage.getItem(layoutStorageKey(keyspace, collection));
    if (!raw) return layout;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return layout;

    if (isRecord(parsed.columnVisibility)) {
      for (const [id, visible] of Object.entries(parsed.columnVisibility)) {
        if (typeof visible === 'boolean') layout.columnVisibility[id] = visible;
      }
    }
    if (isRecord(parsed.columnSizing)) {
      for (const [id, width] of Object.entries(parsed.columnSizing)) {
        if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
          layout.columnSizing[id] = width;
        }
      }
    }
    layout.columnOrder = stringArray(parsed.columnOrder);
    layout.expanded = stringArray(parsed.expanded);
  } catch {
    // Corrupt or inaccessible storage: fall back to defaults.
  }
  return layout;
}

export function saveLayout(keyspace: string, collection: string, layout: ColumnLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(layoutStorageKey(keyspace, collection), JSON.stringify(layout));
  } catch {
    // Quota exceeded or storage disabled: persistence is best-effort.
  }
}
