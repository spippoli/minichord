/**
 * The 195 parameters of the device, normalised once at the boundary.
 *
 * Normalisation is camelCase, `address` spelled correctly, `section` promoted
 * to an explicit field taken from the JSON's three top-level keys, and the
 * firmware-only fields `method` and `iterate` dropped — both exist solely to
 * generate the firmware's C++ switch.
 *
 * No UI hierarchy is baked in here: `group` is carried as it comes, and what a
 * panel does with it is the `ui/` layer's business.
 */

import {
  RAW_SECTION_KEYS,
  rawParameterFile,
  sectionOfRawKey,
  type RawParameter,
  type Section,
} from "./rawParameters";

export type { Section } from "./rawParameters";

/** The group the generator uses for parameters that are never drawn. */
export const HIDDEN_GROUP = "hidden";

/** The domain model. Nothing outside this module sees `RawParameter`. */
export interface Parameter {
  name: string;
  group: string;
  section: Section;
  address: number;
  dataType: "int" | "float";
  curve: "linear" | "exponential";
  min: number;
  max: number;
  defaultValue: number;
  tooltip: string;
  introducedIn: number;
}

function normalise(raw: RawParameter, section: Section): Parameter {
  return {
    name: raw.name,
    group: raw.group,
    section,
    address: raw.sysex_adress,
    dataType: raw.data_type,
    curve: raw.curve,
    min: raw.min_value,
    max: raw.max_value,
    defaultValue: raw.default_value,
    tooltip: raw.tooltip,
    introducedIn: raw.introduction_version,
  };
}

/** All 195 parameters, in file order: global, then harp, then chord. */
export const parameters: readonly Parameter[] = RAW_SECTION_KEYS.flatMap(
  (key) =>
    rawParameterFile[key].map((raw) => normalise(raw, sectionOfRawKey(key))),
);

/**
 * The index by SysEx address. Addresses are globally unique across the three
 * sections and span 2..235, so the index is lossless.
 */
export const byAddress: ReadonlyMap<number, Parameter> = new Map(
  parameters.map((parameter) => [parameter.address, parameter]),
);

/** The 189 parameters a panel may draw, in the order of the full list. */
export const visibleParameters: readonly Parameter[] = parameters.filter(
  (parameter) => parameter.group !== HIDDEN_GROUP,
);

/**
 * Whether the connected firmware knows this parameter. The version is the
 * integer counter the device reports at address 7; a parameter newer than the
 * firmware exists in the manifest but does nothing on the wire.
 */
export function isAvailable(
  parameter: Parameter,
  firmwareVersion: number,
): boolean {
  return parameter.introducedIn <= firmwareVersion;
}
