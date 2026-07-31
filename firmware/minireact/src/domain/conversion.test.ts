import { describe, expect, it } from "vitest";

import {
  defaultWire,
  format,
  nudge,
  parse,
  positionToWire,
  wireMax,
  wireMin,
  wireToPosition,
} from "./conversion";
import { byAddress, parameters, type Parameter } from "./parameters";

function parameterAt(address: number): Parameter {
  const parameter = byAddress.get(address);
  if (parameter === undefined) {
    throw new Error(`no parameter at address ${address}`);
  }
  return parameter;
}

/** `bank color`: linear int, 0..360. */
const linearInt = parameterAt(20);
/** `harp attack`: exponential int, 0..5000 declared, ms. */
const exponential = parameters.find(
  (p) => p.curve === "exponential" && p.max === 5000,
);
if (exponential === undefined) throw new Error("no 0..5000 exponential");
/** `global gain`: linear float, 0..1 in real units, 0..100 on the wire. */
const linearFloat = parameterAt(2);

describe("the wire range", () => {
  it("passes integers through", () => {
    expect(wireMin(linearInt)).toBe(0);
    expect(wireMax(linearInt)).toBe(360);
  });

  it("multiplies float bounds by 100", () => {
    expect(wireMin(linearFloat)).toBe(0);
    expect(wireMax(linearFloat)).toBe(100);
  });

  it("floors an exponential parameter at 1, not at its declared minimum", () => {
    expect(exponential.min).toBe(0);
    expect(wireMin(exponential)).toBe(1);
    expect(wireMax(exponential)).toBe(5000);
  });

  it("multiplies every float bound in the real file by 100", () => {
    for (const parameter of parameters) {
      if (parameter.dataType !== "float") continue;
      if (parameter.curve === "exponential") continue;
      expect(wireMin(parameter)).toBe(Math.round(parameter.min * 100));
      expect(wireMax(parameter)).toBe(Math.round(parameter.max * 100));
    }
  });
});

describe("positionToWire", () => {
  it("maps the ends of the travel onto the ends of the wire range", () => {
    for (const parameter of parameters) {
      expect(positionToWire(parameter, 0)).toBe(wireMin(parameter));
      expect(positionToWire(parameter, 1)).toBe(wireMax(parameter));
    }
  });

  it("clamps a position outside 0..1", () => {
    expect(positionToWire(linearInt, -3)).toBe(0);
    expect(positionToWire(linearInt, 7)).toBe(360);
  });

  it("is linear in the middle of a linear parameter", () => {
    expect(positionToWire(linearInt, 0.5)).toBe(180);
    expect(positionToWire(linearFloat, 0.25)).toBe(25);
  });

  it("follows wire = round(max ** t) on an exponential parameter", () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(positionToWire(exponential, t)).toBe(Math.round(5000 ** t));
    }
  });

  it("sends 1 across the first ~4.8% of an exponential travel", () => {
    // ln(1.5) / ln(5000) = 4.76% of the run is owed to the value 1. This is
    // the curve behaving correctly, not dead travel.
    expect(positionToWire(exponential, 0)).toBe(1);
    expect(positionToWire(exponential, 0.047)).toBe(1);
    expect(positionToWire(exponential, 0.05)).toBe(2);
  });
});

describe("wireToPosition", () => {
  it("maps the ends of the wire range onto the ends of the travel", () => {
    for (const parameter of parameters) {
      expect(wireToPosition(parameter, wireMin(parameter))).toBe(0);
      expect(wireToPosition(parameter, wireMax(parameter))).toBe(1);
    }
  });

  it("maps every wire value at or below 1 to position 0 on an exponential", () => {
    expect(wireToPosition(exponential, 1)).toBe(0);
    expect(wireToPosition(exponential, 0)).toBe(0);
    expect(wireToPosition(exponential, -5)).toBe(0);
  });

  it("clamps a wire value above the range to position 1", () => {
    expect(wireToPosition(exponential, 9000)).toBe(1);
    expect(wireToPosition(linearInt, 400)).toBe(1);
    expect(wireToPosition(linearInt, -1)).toBe(0);
  });

  it("inverts the exponential law", () => {
    expect(wireToPosition(exponential, 5000 ** 0.5)).toBeCloseTo(0.5, 12);
  });

  it("is continuous, so a position is not quantised to an integer step", () => {
    const a = wireToPosition(exponential, 4991);
    const b = wireToPosition(exponential, 5000);
    expect(a).toBeLessThan(b);
    expect(b - a).toBeLessThan(0.001);
  });
});

describe("the round trip", () => {
  it("returns every reachable wire value of every parameter", () => {
    for (const parameter of parameters) {
      const low = wireMin(parameter);
      const high = wireMax(parameter);
      for (let wire = low; wire <= high; wire += 1) {
        const back = positionToWire(parameter, wireToPosition(parameter, wire));
        expect(back, `${parameter.name} @${parameter.address} = ${wire}`).toBe(
          wire,
        );
      }
    }
  });

  it("recovers the 5000 values the legacy's integer position left unreachable", () => {
    const reachable = new Set<number>();
    for (let wire = 1; wire <= 5000; wire += 1) {
      reachable.add(
        positionToWire(exponential, wireToPosition(exponential, wire)),
      );
    }
    expect(reachable.size).toBe(5000);
  });
});

describe("format", () => {
  it("prints an integer as it travels", () => {
    expect(format(linearInt, 180)).toBe("180");
    expect(format(exponential, 1)).toBe("1");
  });

  it("prints a float divided by 100, to two decimals", () => {
    expect(format(linearFloat, 100)).toBe("1.00");
    expect(format(linearFloat, 45)).toBe("0.45");
    expect(format(linearFloat, 7)).toBe("0.07");
  });
});

describe("parse", () => {
  it("round-trips what format prints", () => {
    for (const parameter of parameters) {
      for (const wire of [
        wireMin(parameter),
        wireMax(parameter),
        Math.round((wireMin(parameter) + wireMax(parameter)) / 2),
      ]) {
        expect(parse(parameter, format(parameter, wire))).toBe(wire);
      }
    }
  });

  it("multiplies a typed float by 100", () => {
    expect(parse(linearFloat, "0.5")).toBe(50);
    expect(parse(linearFloat, "0.456")).toBe(46);
  });

  it("accepts a comma as a decimal separator", () => {
    expect(parse(linearFloat, "0,5")).toBe(50);
    expect(parse(linearFloat, "1,00")).toBe(100);
  });

  it("tolerates surrounding whitespace and a leading plus or minus", () => {
    expect(parse(linearInt, "  42  ")).toBe(42);
    expect(parse(linearInt, "+42")).toBe(42);
    expect(parse(linearInt, "-42")).toBe(0);
  });

  it("clamps into wireMin..wireMax", () => {
    expect(parse(linearInt, "1000")).toBe(360);
    expect(parse(linearInt, "-1")).toBe(0);
    expect(parse(linearFloat, "9")).toBe(100);
    expect(parse(exponential, "0")).toBe(1);
    expect(parse(exponential, "99999")).toBe(5000);
  });

  it("returns null only on non-numeric text", () => {
    expect(parse(linearInt, "")).toBeNull();
    expect(parse(linearInt, "   ")).toBeNull();
    expect(parse(linearInt, "abc")).toBeNull();
    expect(parse(linearInt, "12ms")).toBeNull();
    expect(parse(linearInt, "1,2,3")).toBeNull();
    expect(parse(linearInt, "0")).toBe(0);
  });
});

describe("nudging by value, not by position (SPEC.md 8.2)", () => {
  it("moves the wire value by the given step", () => {
    expect(nudge(linearInt, 40, 1)).toBe(41);
    expect(nudge(linearInt, 40, -10)).toBe(30);
  });

  it("stops at the wire bounds rather than wrapping", () => {
    expect(nudge(linearInt, 355, 10)).toBe(360);
    expect(nudge(linearInt, 4, -10)).toBe(0);
    // The exponential floor is 1, not the declared minimum.
    expect(nudge(exponential, 3, -10)).toBe(1);
    expect(nudge(exponential, 4995, 10)).toBe(5000);
  });

  it("reaches the values the position cannot (SPEC.md 4.3)", () => {
    // Near the top of a 0..5000 exponential the travel jumps by nine; the
    // arrows are the only way to 4993.
    expect(nudge(exponential, 4992, 1)).toBe(4993);
  });
});

describe("the factory default (SPEC.md 8.2, 8.4)", () => {
  it("is the declared default, on the wire", () => {
    expect(defaultWire(linearInt)).toBe(linearInt.defaultValue);
    expect(defaultWire(linearFloat)).toBe(50);
  });

  it("leaves a picker's out-of-range default alone", () => {
    const picker = parameterAt(10);
    expect(picker.min).toBe(21);
    expect(defaultWire(picker)).toBe(0);
  });
});
