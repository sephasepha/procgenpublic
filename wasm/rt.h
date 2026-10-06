// Minimal freestanding runtime for the WebAssembly generator: no libc, a bump allocator, bit helpers,
// and fdlibm's log (the same algorithm V8 uses for Math.log, so results match JS bit for bit).
#pragma once
typedef unsigned int u32; typedef int i32; typedef unsigned short u16; typedef unsigned char u8;
typedef unsigned long long u64;
#define EXPORT __attribute__((visibility("default")))

static inline int popcount(u32 x) { return __builtin_popcount(x); }
static inline int clz(u32 x) { return __builtin_clz(x); }

// ---------- memory (rt.c): a permanent region (tilesets) below a scratch region reset per generation ----------
void *alloc(unsigned long n);
void *grow(void *p, unsigned long oldBytes, unsigned long newBytes);
void *rt_scratch(int n);
void *memcpy(void *d, const void *s, unsigned long n);
void *memset(void *d, int c, unsigned long n);

// ---------- fdlibm __ieee754_log ----------
static inline u32 HI(double x) { union { double d; u64 u; } v = { x }; return (u32)(v.u >> 32); }
static inline u32 LO(double x) { union { double d; u64 u; } v = { x }; return (u32)v.u; }
static inline double SETHI(double x, u32 hi) { union { double d; u64 u; } v = { x }; v.u = ((u64)hi << 32) | (v.u & 0xffffffffull); return v.d; }
static const double ln2_hi = 6.93147180369123816490e-01, ln2_lo = 1.90821492927058770002e-10, two54 = 1.80143985094819840000e+16,
  Lg1 = 6.666666666666735130e-01, Lg2 = 3.999999999940941908e-01, Lg3 = 2.857142874366239149e-01, Lg4 = 2.222219843214978396e-01,
  Lg5 = 1.818357216161805012e-01, Lg6 = 1.531383769920937332e-01, Lg7 = 1.479819860511658591e-01;
static double flog(double x) {
  double hfsq, f, s, z, R, w, t1, t2, dk;
  i32 k = 0, hx = (i32)HI(x), i, j; u32 lx = LO(x);
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) == 0) return -two54 / 0.0;
    if (hx < 0) return (x - x) / 0.0;
    k -= 54; x *= two54; hx = (i32)HI(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  i = (hx + 0x95f64) & 0x100000;
  x = SETHI(x, (u32)(hx | (i ^ 0x3ff00000)));
  k += (i >> 20);
  f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f == 0.0) { if (k == 0) return 0.0; dk = (double)k; return dk * ln2_hi + dk * ln2_lo; }
    R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k == 0) return f - R;
    dk = (double)k; return dk * ln2_hi - ((R - dk * ln2_lo) - f);
  }
  s = f / (2.0 + f); dk = (double)k; z = s * s; i = hx - 0x6147a; w = z * z; j = 0x6b851 - hx;
  t1 = w * (Lg2 + w * (Lg4 + w * Lg6)); t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7))); i |= j; R = t2 + t1;
  if (i > 0) { hfsq = 0.5 * f * f; if (k == 0) return f - (hfsq - s * (hfsq + R)); return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f); }
  if (k == 0) return f - s * (f - R);
  return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
}
