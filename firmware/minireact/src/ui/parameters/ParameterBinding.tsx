import { describeParameter, isAvailable, type Parameter } from "../../domain";
import { differsFromDefault, firmwareVersion, isEdited } from "../../state";
import { useAppState, useRuntime } from "../runtimeContext";
import { Control } from "./Control";

/**
 * The only component per parameter that reads the store (SPEC.md 6.1,
 * invariant 1).
 *
 * The store's rules are *per address and over time*: the optimistic write, the
 * dump that overrules every value except the one under an active pointer, and
 * that exception falling away when the bank changes. Spread across 189 reading
 * controls, "the address under an active pointer" becomes 189 pieces of local
 * state; behind one binding it stays one field of the reducer.
 *
 * This is a legibility decision and not a performance one: a full dump
 * repainting the worst case this design allows was measured at 2.5 ms median
 * against a 16 ms frame, which is why nothing here is memoised (SPEC.md 7.6).
 *
 * The cost it does carry is stated: every dump repaints the whole mounted
 * section. If the one-section-at-a-time architecture ever changes, re-measure.
 */
export function ParameterBinding({ parameter }: { parameter: Parameter }) {
  const runtime = useRuntime();
  const { parameters } = useAppState();
  const values = parameters.values;

  // No device, no state: the app before the first dump is the gate, so a
  // binding only ever renders with a store behind it (SPEC.md 5.2).
  if (!values) return null;

  const version = firmwareVersion(parameters);
  // The two LEDs are read once, here, and travel twice: to the control that
  // lights them and to the one producer of everything the app *says* about a
  // parameter (SPEC.md 6.1, invariant 5). A control composing that sentence
  // itself is the invariant being broken.
  const divergence = {
    edited: isEdited(parameters, parameter.address),
    offDefault: differsFromDefault(parameters, parameter.address),
  };

  return (
    <Control
      parameter={parameter}
      value={values[parameter.address]}
      unequipped={!isAvailable(parameter, version)}
      divergence={divergence}
      description={describeParameter(parameter, {
        firmwareVersion: version,
        changedFromStoredBank: divergence.edited,
        differsFromDefault: divergence.offDefault,
      })}
      // Optimism, and its subordination to the connection, are the reducer's:
      // an edit with no wire is refused there, not drawn away here.
      onChange={(value) => runtime.setParameter(parameter.address, value)}
      onPointerDown={() => runtime.pointerDown(parameter.address)}
      onPointerUp={() => runtime.pointerUp()}
    />
  );
}
