import {
  PRESET_CODE_VALUE_COUNT,
  type PresetCodeRejection,
} from "../../domain";

/**
 * Why a pasted code was refused, in the words of Appendix A.7.
 *
 * A pure function of the codec's rejection, for the same reason the strip's
 * lines are one (SPEC.md 2.4): the wording is the one thing about a refusal
 * that can be wrong without anything failing, and it is exercised headless
 * rather than read off a screenshot.
 *
 * Every message is **specific about what is wrong and where**. "Invalid preset"
 * would be true of all four and useful in none of them: the index these carry
 * is the address the value would have gone to, so a code that came out of
 * another tool can be found and fixed rather than thrown away.
 *
 * The four causes are structural and that is the whole list (SPEC.md 11.2).
 * There is deliberately no message about a value outside a parameter's declared
 * range, because that is not a refusal this app makes.
 */
export function presetRejectionMessage(rejection: PresetCodeRejection): string {
  switch (rejection.kind) {
    case "not-base64":
      // The overwhelmingly likely case is a paste that caught something else,
      // so the sentence says what the thing is not rather than naming base64.
      return "That is not a preset code.";

    case "value-count":
      return `A preset code holds ${PRESET_CODE_VALUE_COUNT} values; this one holds ${rejection.count}.`;

    case "not-an-integer":
      return `Value ${rejection.index} is not a whole number.`;

    case "out-of-range":
      // The bound is the wire's, not the parameter's, and the sentence says so
      // by naming the minichord rather than a range the user could look up.
      return `Value ${rejection.index} is outside the range the minichord accepts.`;
  }
}
