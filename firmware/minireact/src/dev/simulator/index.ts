/**
 * Throwaway minichord protocol simulator.
 *
 * A fixture for design work, not a deliverable of the spec: it exists so that
 * prototypes have a device to talk to when no hardware is plugged in. See
 * README.md in this folder for what it does and does not model.
 */

export { MinichordSimulator, CALIBRATION } from './fakeMidiAccess'
export type { SimulatorOptions } from './fakeMidiAccess'
export {
  MinichordDevice,
  SIMULATED_FIRMWARE_VERSION,
  BANK_ADDRESS,
  FIRMWARE_VERSION_ADDRESS,
} from './minichordDevice'
export type { MinichordDeviceOptions } from './minichordDevice'
export { BANK_COUNT, PARAMETER_SIZE, DEFAULT_BANKS } from './defaultBanks'
