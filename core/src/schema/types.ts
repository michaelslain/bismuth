// core/src/schema/types.ts
export type Severity = "error" | "warning" | "info";

export type PropertyType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "file"
  | "icon"
  | { kind: "enum"; values: string[]; caseInsensitive?: boolean; allowPrefixes?: string[] }
  | { kind: "list"; item?: PropertyType }
  | { kind: "object"; fields: Schema };

export interface SchemaEntry {
  type: PropertyType;
  required?: boolean;
  default?: unknown;
  doc?: string;
  min?: number;
  max?: number;
}

export type Schema = Record<string, SchemaEntry>;

export interface Diagnostic {
  path: string[];
  severity: Severity;
  message: string;
  suggestions?: string[];
}

export interface ValidateContext {
  resolveLink?: (target: string) => boolean;
}

export type ValidateMode = "frontmatter" | "settings";
