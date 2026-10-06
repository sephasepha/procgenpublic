// Dressing WFC in C, compiled to WebAssembly (wasm/build.sh). A line-for-line port of dress() in
// gen/dressing.js: same RNG, same entropy (fdlibm log, as V8's Math.log), same heap and propagation
// order, so it produces bit-identical tiles. tests/wasm.js checks that on every run.
#include "rt.h"

// ---------- tilesets, uploaded once by gen/wasm.js ----------
#define MAXSETS 16
#define NCLS 512
typedef struct {
  int n, offset, fbFloor, fbWall, fbRock;
  const double *weight;   // n
  const u32 *allow;       // [4][n][KW]
  const u32 *cls;         // [NCLS][KW]
  const u8 *clsHas;       // [NCLS]
} Set;
static Set sets[MAXSETS];
static int nsets = 0, KW = 1;

EXPORT void ds_init(int n, int kw) { nsets = n; KW = kw; }
EXPORT void ds_set(int si, int n, int offset, int fbF, int fbW, int fbR, const double *w, const u32 *allow, const u32 *cls, const u8 *has) {
  Set *s = &sets[si]; s->n = n; s->offset = offset; s->fbFloor = fbF; s->fbWall = fbW; s->fbRock = fbR;
  s->weight = w; s->allow = allow; s->cls = cls; s->clsHas = has;
}

// ---------- state for one call ----------
static int W, H, N;
static const u8 *pass, *setOf;
static u32 *dom, *ver;
static u16 *clsOf;
static u32 rngState;
static double rng(void) {
  rngState += 0x6D2B79F5u; u32 a = rngState;
  u32 t = (a ^ (a >> 15)) * (1u | a);
  t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
  return (double)(t ^ (t >> 14)) / 4294967296.0;
}
static const int DX[4] = { 0, 1, 0, -1 }, DY[4] = { -1, 0, 1, 0 };

static int classAt(int x, int y) {
  int self = pass[y * W + x], m = 0;
#define AT(xx, yy) (((xx) < 0 || (yy) < 0 || (xx) >= W || (yy) >= H) ? 0 : pass[(yy) * W + (xx)])
  for (int d = 0; d < 4; d++) if (AT(x + DX[d], y + DY[d]) != self) m |= 1 << d;
  if (m == 0) {
    if (AT(x + 1, y - 1) != self) m |= 16; if (AT(x + 1, y + 1) != self) m |= 32;
    if (AT(x - 1, y + 1) != self) m |= 64; if (AT(x - 1, y - 1) != self) m |= 128;
  }
#undef AT
  return m | (self ? 256 : 0);
}
static int fallbackOf(int i) { const Set *s = &sets[setOf[i]]; return pass[i] ? s->fbFloor : (clsOf[i] == 0 ? s->fbRock : s->fbWall); }
static void setSingle(int i, int t) { u32 *d = dom + i * KW; for (int w = 0; w < KW; w++) d[w] = 0; d[t >> 5] = 1u << (t & 31); }
static int count(int i) { int n = 0; const u32 *d = dom + i * KW; for (int w = 0; w < KW; w++) n += popcount(d[w]); return n; }

// ---------- entropy heap (same sift order as the JS) ----------
static double *hE; static int *hI; static u32 *hV; static int hN, hCap;
static double entropy(int i) {
  const double *wt = sets[setOf[i]].weight; double sw = 0, swl = 0; const u32 *d = dom + i * KW;
  for (int w = 0; w < KW; w++) { u32 b = d[w]; while (b) { u32 low = b & (0u - b); int t = w * 32 + 31 - clz(low); double x = wt[t]; sw += x; swl += x * flog(x); b ^= low; } }
  return flog(sw) - swl / sw + rng() * 1e-4;
}
static void hswap(int a, int b) { double e = hE[a]; hE[a] = hE[b]; hE[b] = e; int i = hI[a]; hI[a] = hI[b]; hI[b] = i; u32 v = hV[a]; hV[a] = hV[b]; hV[b] = v; }
static void hpush(int i) {
  if (count(i) <= 1) return;
  ver[i]++;
  if (hN == hCap) { int nc = hCap * 2; hE = grow(hE, hCap * 8, nc * 8); hI = grow(hI, hCap * 4, nc * 4); hV = grow(hV, hCap * 4, nc * 4); hCap = nc; }
  hE[hN] = entropy(i); hI[hN] = i; hV[hN] = ver[i]; int k = hN++;
  while (k > 0) { int p = (k - 1) >> 1; if (hE[p] <= hE[k]) break; hswap(p, k); k = p; }
}
static void hpop(double *e, int *i, u32 *v) {
  *e = hE[0]; *i = hI[0]; *v = hV[0];
  hN--;
  if (hN) {
    hE[0] = hE[hN]; hI[0] = hI[hN]; hV[0] = hV[hN];
    int k = 0;
    for (;;) { int l = 2 * k + 1, r = l + 1, m = k; if (l < hN && hE[l] < hE[m]) m = l; if (r < hN && hE[r] < hE[m]) m = r; if (m == k) break; hswap(m, k); k = m; }
  }
}

// ---------- propagation ----------
static int *q; static int qN, qCap;
static u32 *trail; static int trN, trCap, trailOn;
static u32 A[8];
static void qpush(int i) { if (qN == qCap) { q = grow(q, qCap * 4, qCap * 8); qCap *= 2; } q[qN++] = i; }
static void allowedFrom(int s, int d, int i) {
  for (int w = 0; w < KW; w++) A[w] = 0;
  const Set *S = &sets[s]; const u32 *dd = dom + i * KW;
  for (int w = 0; w < KW; w++) { u32 b = dd[w]; while (b) { u32 low = b & (0u - b); int t = w * 32 + 31 - clz(low); const u32 *m = S->allow + ((d * S->n + t) * KW); for (int k = 0; k < KW; k++) A[k] |= m[k]; b ^= low; } }
}
static int propagate(void) {
  while (qN) {
    int i = q[--qN], s = setOf[i], x = i % W, y = i / W;
    for (int d = 0; d < 4; d++) {
      int nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      int n = ny * W + nx;
      if (setOf[n] != s) continue;
      allowedFrom(s, d, i);
      u32 *o = dom + n * KW; int changed = 0, empty = 1;
      for (int w = 0; w < KW; w++) { u32 nv = o[w] & A[w]; if (nv != o[w]) changed = 1; if (nv) empty = 0; }
      if (!changed) continue;
      if (empty) return n;
      if (trailOn) { if (trN + KW + 1 > trCap) { trail = grow(trail, trCap * 4, trCap * 8); trCap *= 2; } trail[trN++] = (u32)n; for (int w = 0; w < KW; w++) trail[trN++] = o[w]; }
      for (int w = 0; w < KW; w++) o[w] &= A[w];
      qpush(n); hpush(n);
    }
  }
  return -1;
}

// result: [fallbacks, backtracks, violations]
EXPORT int ds_dress(const u8 *passIn, const u8 *setOfIn, int w, int h, int seed, const int *pins, int npins, u16 *out, int *stats) {
  // inputs live in the scratch region (gen/wasm.js resets it and allocates them first); work memory follows
  W = w; H = h; N = W * H; pass = passIn; setOf = setOfIn; rngState = (u32)seed;
  dom = alloc(N * KW * 4); ver = alloc(N * 4); clsOf = alloc(N * 2);
  hCap = 1024; hN = 0; hE = alloc(hCap * 8); hI = alloc(hCap * 4); hV = alloc(hCap * 4);
  qCap = 1024; qN = 0; q = alloc(qCap * 4);
  trCap = 1024; trN = 0; trail = alloc(trCap * 4); trailOn = 0;
  for (int i = 0; i < N; i++) ver[i] = 0;
  for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
    int i = y * W + x, c = classAt(x, y); clsOf[i] = (u16)c;
    const Set *s = &sets[setOf[i]];
    if (s->clsHas[c]) { const u32 *m = s->cls + c * KW; for (int k = 0; k < KW; k++) dom[i * KW + k] = m[k]; }
    else setSingle(i, fallbackOf(i));
  }
  for (int p = 0; p < npins; p++) { int i = pins[2 * p], t = pins[2 * p + 1]; if ((dom[i * KW + (t >> 5)] >> (t & 31)) & 1) setSingle(i, t); }
  int fallbacks = 0, backtracks = 0;
  // first pass: make every cell agree with its neighbours; anything impossible falls back to a plain tile
  u8 *fell = alloc(N); for (int i = 0; i < N; i++) fell[i] = 0;
  for (int guard = 0; guard < N; guard++) {
    qN = 0; for (int i = 0; i < N; i++) qpush(i);
    int bad = propagate();
    if (bad < 0) break;
    if (fell[bad]) {
      int x = bad % W, y = bad / W;
      for (int d = 0; d < 4; d++) { int nx = x + DX[d], ny = y + DY[d]; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; int n = ny * W + nx; if (!fell[n]) { fell[n] = 1; setSingle(n, fallbackOf(n)); fallbacks++; } }
      continue;
    }
    fell[bad] = 1; setSingle(bad, fallbackOf(bad)); fallbacks++;
  }
  for (int i = 0; i < N; i++) hpush(i);
  u32 saved[8];
  while (hN) {
    double e; int i; u32 v; hpop(&e, &i, &v);
    if (v != ver[i] || count(i) <= 1) continue;
    const double *wt = sets[setOf[i]].weight; double sw = 0; u32 *d = dom + i * KW;
    for (int w2 = 0; w2 < KW; w2++) { u32 b = d[w2]; while (b) { u32 low = b & (0u - b); sw += wt[w2 * 32 + 31 - clz(low)]; b ^= low; } }
    double r = rng() * sw; int pick = -1, last = -1;
    for (int w2 = 0; w2 < KW; w2++) { u32 b = d[w2]; while (b) { u32 low = b & (0u - b); int t = w2 * 32 + 31 - clz(low); last = t; if (pick < 0) { r -= wt[t]; if (r <= 0) pick = t; } b ^= low; } }
    if (pick < 0) pick = last;
    for (int k = 0; k < KW; k++) saved[k] = d[k];
    trailOn = 1; trN = 0;
    setSingle(i, pick);
    qN = 0; qpush(i);
    int bad = propagate();
    if (bad >= 0) {
      backtracks++;
      int KS = KW + 1;
      for (int k = trN - KS; k >= 0; k -= KS) { u32 *o = dom + trail[k] * KW; for (int w2 = 0; w2 < KW; w2++) o[w2] = trail[k + 1 + w2]; }
      for (int k = 0; k < KW; k++) d[k] = saved[k];
      d[pick >> 5] &= ~(1u << (pick & 31));
      trailOn = 0;
      if (count(i) == 0) { setSingle(i, fallbackOf(i)); fallbacks++; }
      else hpush(i);
      continue;
    }
    trailOn = 0;
  }
  for (int i = 0; i < N; i++) {
    int t = -1; const u32 *dd = dom + i * KW;
    for (int w2 = 0; w2 < KW && t < 0; w2++) if (dd[w2]) t = w2 * 32 + 31 - clz(dd[w2] & (0u - dd[w2]));
    out[i] = (u16)(sets[setOf[i]].offset + (t < 0 ? fallbackOf(i) : t));
  }
  int violations = 0;
  for (int i = 0; i < N; i++) {
    int x = i % W, s = setOf[i]; const Set *S = &sets[s]; int a = out[i] - S->offset;
#define OK(dd, b) ((S->allow[((dd) * S->n + a) * KW + ((b) >> 5)] >> ((b) & 31)) & 1)
    if (x + 1 < W && setOf[i + 1] == s && !OK(1, out[i + 1] - S->offset)) violations++;
    if (i + W < N && setOf[i + W] == s && !OK(2, out[i + W] - S->offset)) violations++;
#undef OK
  }
  stats[0] = fallbacks; stats[1] = backtracks; stats[2] = violations;
  return 0;
}
