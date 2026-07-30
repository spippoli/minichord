import {
  FIRMWARE_VERSION_ADDRESS,
  RESTING_LINE,
  byAddress,
  describeParameter,
} from "../../domain";
import { useAppState } from "../runtimeContext";
import styles from "./Readout.module.css";
import { useReadoutTarget } from "./readoutChannel";

/**
 * There is **exactly one** of these in the tree (SPEC.md 6.2).
 *
 * It explains whatever is under the pointer or the focus, and it is
 * `aria-hidden`: a reader has already been told the same words as the control's
 * own description, and a live region here fires again, out of order (SPEC.md
 * 12.5). It is also not the strip — that one says what happened to the device,
 * on a different clock, and merging the two loses both decisions (invariant 7).
 *
 * It reads the store for one thing only, the firmware version, which decides
 * whether the slot the pointer is on exists on this device. It draws no
 * parameter and holds no value, so invariant 1 is untouched; and it composes no
 * text of its own — every string here comes out of `describeParameter`
 * (invariant 5).
 */
export function Readout() {
  const target = useReadoutTarget();
  const { parameters } = useAppState();

  const parameter = target ? byAddress.get(target.address) : undefined;
  const description = parameter
    ? describeParameter(parameter, {
        firmwareVersion: parameters.values?.[FIRMWARE_VERSION_ADDRESS] ?? 0,
      })
    : null;

  return (
    <div className={styles.readout} aria-hidden="true">
      {description ? (
        <>
          <p className={styles.where}>{description.where}</p>
          <p className={styles.what}>
            {description.tooltip}{" "}
            <span
              className={
                description.unequipped ? styles.unequipped : styles.note
              }
            >
              {description.note}
            </span>
          </p>
        </>
      ) : (
        <p className={styles.resting}>{RESTING_LINE}</p>
      )}
    </div>
  );
}
