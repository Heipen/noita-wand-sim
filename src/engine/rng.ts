/**
 * Noita's engine RNG (`Random` / `SetRandomSeed`) re-implemented in TypeScript.
 *
 * The algorithm matches the C runtime RNG used by the game (Park–Miller style `rand()`
 * with the 16807/127773 Schrage step), plus the two-value seeding routine. This is the
 * same behaviour that community tools (kaliuresis/noa's orbs.js, salinecitrine's
 * simulator) validated against the game; it matters for shuffle-wand deck order and for
 * spells like RANDOM_SPELL / ZETA.
 */

const TWO32 = 1n << 32n;

function toUint32(value: bigint): bigint {
  return BigInt.asUintN(32, value);
}

function toInt32(value: bigint): bigint {
  return BigInt.asIntN(32, value);
}

/** Helper A of the seeding routine: bit-level decomposition of a float64 seed. */
function seedHelperFloat(value: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, true);
  const bits = view.getBigUint64(0, true);

  const exponent = (bits >> 32n) & 0x7fffffffn;
  if (exponent >= 0x7ff00000n || !Number.isFinite(value)) return 0n;
  if (value < -9223372036854775808 || value >= 9223372036854775808) return 0n;

  const abs = Math.abs(value);
  if (abs === 0) return 0n;

  const fraction = (bits & 0xfffffffffffffn) | 0x0010000000000000n;
  const shift = 0x433n - (bits >> 52n);
  const high = fraction >> shift;
  const negative = 0x433n < (((bits >> 32n) & 0xffffffffn) >> 20n) ? 1n : 0n;
  let mask = -negative;
  mask = (mask << 32n) | mask;
  let result = (~mask & high) | ((fraction << ((BigInt(Math.floor(abs)) >> 52n) - 0x433n)) & mask);
  const signMask = -BigInt(value === abs ? 1 : 0);
  result = (~signMask & -result) | (result & signMask);
  return result & 0xffffffffn;
}

/** Helper B of the seeding routine: Bob Jenkins' mix function. */
function seedHelperMix(a: number, b: number, c: number): bigint {
  let x = toUint32(BigInt(a));
  let y = toUint32(BigInt(b));
  let z = toUint32(BigInt(c));

  let u2 = toUint32(toInt32(x - y - z) ^ (z >> 13n));
  let u1 = toUint32(toInt32(y - u2 - z) ^ (u2 << 8n));
  let u3 = toUint32(toInt32(z - u2 - u1) ^ (u1 >> 13n));
  u2 = toUint32(toInt32(u2 - u1 - u3) ^ (u3 >> 12n));
  u1 = toUint32(toInt32(u1 - u2 - u3) ^ (u2 << 16n));
  u3 = toUint32(toInt32(u3 - u2 - u1) ^ (u1 >> 5n));
  u2 = toUint32(toInt32(u2 - u1 - u3) ^ (u3 >> 3n));
  u1 = toUint32(toInt32(u1 - u2 - u3) ^ (u2 << 10n));
  return toUint32(toInt32(u3 - u2 - u1) ^ (u1 >> 15n));
}

export class NoitaRng {
  private seed = 0;

  /** Engine `Random(min, max)` — returns an integer. */
  random(min: number, max: number): number {
    let value = BigInt(Math.floor(this.seed).toFixed(0)) * 0x41a7n + (BigInt(Math.floor(this.seed).toFixed(0)) / 0x1f31dn) * -0x7fffffffn;
    value = toInt32(value);
    if (value < 1n) value += 0x7fffffffn;
    value = toInt32(value);
    this.seed = Number(value);
    return ~~(min + ~~-((max - min + 1) * (this.seed * -4.656612875e-10)));
  }

  /** Engine `SetRandomSeed(a, b)` — the world seed is part of the mix. */
  setSeed(worldSeed: number, a: number, b: number): void {
    const mixed = worldSeed ^ 0x93262e6f;
    const low = mixed & 0xfff;
    const high = (mixed >> 12) & 0xfff;
    const x = a + low;
    let y = b + high;

    let r = x * 134217727.0;
    const e = seedHelperFloat(r);
    if (102400.0 <= Math.abs(y) || Math.abs(x) <= 1.0) {
      r = y * 134217727.0;
    } else {
      const yScaled = y * 3483.328 + Number(e);
      r = y * yScaled;
    }
    const f = seedHelperFloat(r);
    const mixedSeed = seedHelperMix(Number(e), Number(f), worldSeed);

    let s = Number(mixedSeed);
    s /= 4294967295.0;
    s *= 2147483639.0;
    s += 1.0;
    if (2147483647.0 <= s) s *= 0.5;
    this.seed = s;

    this.random(0, 0);
    let extra = worldSeed & 3;
    while (extra > 0) {
      this.random(0, 0);
      extra--;
    }
  }
}
