/**
 * The generator's `parameters.json` exactly as it is on disk.
 *
 * The file is imported at build time straight from `firmware/generator/`: Vite
 * inlines it into the bundle, so there is no fetch, no loading state and no
 * `async` between a pure module and the parameter list. The accepted cost is
 * that regenerating the JSON requires rebuilding the SPA.
 *
 * This module is the only place in the app where the domain's spelling of
 * `sysex_adress` — the typo that is part of the data contract — is allowed to
 * appear. Everything downstream sees the normalised `Parameter` of
 * `./parameters`, which spells `address` correctly.
 */

import parametersJson from "../../../generator/parameters.json";

/** The file as it is, typo and firmware-only fields included. */
export interface RawParameter {
  name: string;
  group: string;
  default_value: number;
  data_type: "int" | "float";
  sysex_adress: number;
  curve: "linear" | "exponential";
  min_value: number;
  max_value: number;
  tooltip: string;
  iterate: number;
  method: string;
  introduction_version: number;
}

/** The three top-level keys of the file, in file order. */
export const RAW_SECTION_KEYS = [
  "global_parameter",
  "harp_parameter",
  "chord_parameter",
] as const;

export type RawSectionKey = (typeof RAW_SECTION_KEYS)[number];

export type Section = "global" | "harp" | "chord";

export type RawParameterFile = Readonly<Record<RawSectionKey, RawParameter[]>>;

/**
 * The narrowing a JSON import cannot do for us: TypeScript infers
 * `data_type: string`, never the union. `rawParameters.test.ts` walks the real
 * file and asserts the shape and the closed domains this cast asserts blindly.
 */
export const rawParameterFile = parametersJson as unknown as RawParameterFile;

const SECTION_OF_RAW_KEY: Readonly<Record<RawSectionKey, Section>> = {
  global_parameter: "global",
  harp_parameter: "harp",
  chord_parameter: "chord",
};

export function sectionOfRawKey(key: RawSectionKey): Section {
  return SECTION_OF_RAW_KEY[key];
}
