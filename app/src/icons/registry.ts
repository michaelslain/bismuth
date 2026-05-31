// app/src/icons/registry.ts
//
// Binds the pure registry (registry-core.ts) to lucide-solid's `icons`
// manifest (PascalCase name -> icon component). All resolution logic lives in
// registry-core so it can be unit tested without importing lucide-solid (which
// throws when imported outside a DOM).
import { icons } from "lucide-solid";
import type { LucideIcon } from "lucide-solid";
import { createIconRegistry, type IconEntry } from "./registry-core";

const registry = createIconRegistry<LucideIcon>(icons as unknown as Record<string, LucideIcon>);

/**
 * Resolve an icon spec (a Lucide name in any casing, the legacy "Li"/"Lu"
 * convention, or an emoji/arbitrary glyph) to a Lucide component, or `null`
 * when it isn't a known icon (caller should render the raw glyph as text).
 */
export const resolveIcon = (spec: string | null | undefined): LucideIcon | null => registry.resolve(spec);

/** True when `spec` names a Lucide icon (vs. an emoji / arbitrary glyph). */
export const isIconName = (spec: string | null | undefined): boolean => registry.resolve(spec) !== null;

/** Every Lucide icon (canonical name + component), sorted by name. For the picker. */
export const allIcons = (): IconEntry<LucideIcon>[] => registry.all();

/** All canonical icon names, sorted — for autocomplete suggestions. */
export const iconNames = (): string[] => registry.names();
