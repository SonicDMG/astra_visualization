import { type FieldType, isDollarDate } from './schema';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  parsedValue?: unknown;
}

const ISO_DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)?$/;

/**
 * Validates and converts raw user input into the target datatype.
 * Ensures updates strictly conform to the field's data type and formatting requirements.
 */
export function validateAndParseFieldValue(
  type: FieldType,
  rawInput: string,
  originalValue?: unknown,
): ValidationResult {
  const trimmed = rawInput.trim();

  switch (type) {
    case 'string':
      return { valid: true, parsedValue: rawInput };

    case 'number': {
      if (trimmed === '') {
        return { valid: false, error: 'Number value cannot be empty.' };
      }
      const num = Number(trimmed);
      if (Number.isNaN(num) || !Number.isFinite(num)) {
        return { valid: false, error: 'Please enter a valid numeric value.' };
      }
      return { valid: true, parsedValue: num };
    }

    case 'boolean': {
      if (trimmed === 'true') return { valid: true, parsedValue: true };
      if (trimmed === 'false') return { valid: true, parsedValue: false };
      return { valid: false, error: 'Value must be either true or false.' };
    }

    case 'isoDate': {
      if (trimmed === '') {
        return { valid: false, error: 'Date value cannot be empty.' };
      }
      const isDateOnly = ISO_DATE_ONLY_REGEX.test(trimmed);
      const isDateTime = ISO_DATETIME_REGEX.test(trimmed);

      if (!isDateOnly && !isDateTime) {
        return {
          valid: false,
          error:
            'Must follow ISO 8601 format (e.g. YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ).',
        };
      }

      const timestamp = Date.parse(trimmed);
      if (Number.isNaN(timestamp)) {
        return { valid: false, error: 'Invalid calendar date or time value.' };
      }

      // Preserve date-only formatting if original was date-only and input is date-only
      if (typeof originalValue === 'string' && ISO_DATE_ONLY_REGEX.test(originalValue) && isDateOnly) {
        return { valid: true, parsedValue: trimmed };
      }

      return { valid: true, parsedValue: trimmed };
    }

    case 'dollarDate': {
      if (trimmed === '') {
        return { valid: false, error: 'Date value cannot be empty.' };
      }
      // If user entered a number (epoch milliseconds)
      if (/^-?\d+$/.test(trimmed)) {
        const millis = Number(trimmed);
        if (Number.isFinite(millis)) {
          return { valid: true, parsedValue: { $date: millis } };
        }
      }

      // Otherwise parse as date string
      const timestamp = Date.parse(trimmed);
      if (Number.isNaN(timestamp)) {
        return {
          valid: false,
          error: 'Must be a valid ISO date string or epoch timestamp (milliseconds).',
        };
      }
      return { valid: true, parsedValue: { $date: timestamp } };
    }

    case 'null': {
      if (trimmed === 'null' || trimmed === '') {
        return { valid: true, parsedValue: null };
      }
      return { valid: true, parsedValue: trimmed };
    }

    case 'array': {
      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) {
          return { valid: false, error: 'Value must be a valid JSON array ([...]).' };
        }
        return { valid: true, parsedValue: parsed };
      } catch (e) {
        return { valid: false, error: `Invalid JSON syntax: ${(e as Error).message}` };
      }
    }

    case 'object': {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return { valid: false, error: 'Value must be a valid JSON object ({...}).' };
        }
        return { valid: true, parsedValue: parsed };
      } catch (e) {
        return { valid: false, error: `Invalid JSON syntax: ${(e as Error).message}` };
      }
    }

    case 'mixed':
    default: {
      // For mixed or unknown types, attempt JSON parse if it looks like JSON, else string
      if (trimmed === 'null') return { valid: true, parsedValue: null };
      if (trimmed === 'true') return { valid: true, parsedValue: true };
      if (trimmed === 'false') return { valid: true, parsedValue: false };
      if (!Number.isNaN(Number(trimmed)) && trimmed !== '') {
        return { valid: true, parsedValue: Number(trimmed) };
      }
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return { valid: true, parsedValue: JSON.parse(trimmed) };
        } catch {
          // fallback to string
        }
      }
      return { valid: true, parsedValue: rawInput };
    }
  }
}

/**
 * Formats a value for initial editing display based on its type.
 */
export function formatValueForEditor(type: FieldType, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (type === 'dollarDate' && isDollarDate(value)) {
    const d = new Date(value.$date);
    return Number.isNaN(d.getTime()) ? String(value.$date) : d.toISOString();
  }
  if (type === 'object' || type === 'array') {
    return JSON.stringify(value, null, 2);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
