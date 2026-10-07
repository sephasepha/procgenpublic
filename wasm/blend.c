// Transition WFC in C, compiled to WebAssembly (wasm/build.sh). A line-for-line port of blend() in
// gen/dressing.js: a WFC over tile corners that decides, where areas meet, which area each corner belongs to,
// with no saddles. Same RNG (mulberry32), same heap and propagation order, so it gives bit-identical corners;
// tests/wasm.js checks that on every run.
#include "rt.h"

// ---------- tables, uploaded once by gen/wasm.js ----------
#define MAXG 16
static const u8 *groupOf, *blendsOf; static int G = 1;
EXPORT void bl_init(int g, const u8 *grp, const u8 *bl) { G = g; groupOf = grp; blendsOf = bl; }

static u32 rs;
static double rnd(void) {
  rs += 0x6D2B79F5u; u32 a = rs;
  u32 t = (a ^ (a >> 15)) * (1u | a);
  t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
  return (double)(t ^ (t >> 14)) / 4294967296.0;
}

static int W, H, N, CW, CH, NC;
typedef signed char i8;
static u16 *dom; static i32 *rep; static i8 *home; static u8 *nearN;

// ---------- heap: keys (options + a random tie-break), lazy ----------
static double *hk; static int *hc; static int hn, hcap;
static void hpush(int c) {
  if (hn == hcap) { int nc = hcap * 2; hk = grow(hk, hcap * 8, nc * 8); hc = grow(hc, hcap * 4, nc * 4); hcap = nc; }
  hk[hn] = (double)popcount(dom[c]) + rnd() * 0.5; hc[hn] = c; int k = hn++;
  while (k > 0) { int q = (k - 1) >> 1; if (hk[q] <= hk[k]) break; double e = hk[q]; hk[q] = hk[k]; hk[k] = e; int t = hc[q]; hc[q] = hc[k]; hc[k] = t; k = q; }
}
static int hpop(void) {
  int top = hc[0]; hn--;
  if (hn) {
    hk[0] = hk[hn]; hc[0] = hc[hn]; int k = 0;
    for (;;) { int l = 2 * k + 1, r = l + 1, m = k; if (l < hn && hk[l] < hk[m]) m = l; if (r < hn && hk[r] < hk[m]) m = r; if (m == k) break; double e = hk[m]; hk[m] = hk[k]; hk[k] = e; int t = hc[m]; hc[m] = hc[k]; hc[k] = t; k = m; }
  }
  return top;
}

// ---------- propagation: a stack of cells to revise ----------
static int *st; static int sn, scap;
static void spush(int i) { if (sn == scap) { st = grow(st, scap * 4, scap * 8); scap *= 2; } st[sn++] = i; }
static int one(u32 m) { return m && !(m & (m - 1)); }
// push the cells around corner c (NW, NE, SW, SE of it, the JS order), except cell `skip`
static void around(int c, int skip) {
  int cx = c % CW, cy = c / CW;
  static const int ox[4] = { -1, 0, -1, 0 }, oy[4] = { -1, -1, 0, 0 };
  for (int k = 0; k < 4; k++) { int x = cx + ox[k], y = cy + oy[k]; if (x >= 0 && y >= 0 && x < W && y < H) { int n = y * W + x; if (n != skip) spush(n); } }
}
static int changed[4]; static int nch;
static void revise(int i) {
  int x = i % W, y = i / W, c = y * CW + x, k[4] = { c, c + 1, c + CW + 1, c + CW };
  nch = 0;
  for (int j = 0; j < 4; j++) {
    u32 opp = dom[k[(j + 2) & 3]], s1 = dom[k[(j + 1) & 3]], s2 = dom[k[(j + 3) & 3]];
    if (!one(opp) || !one(s1) || s1 != s2 || opp == s1) continue;
    if ((dom[k[j]] & opp) && dom[k[j]] != opp) { dom[k[j]] &= (u16)~opp; changed[nch++] = k[j]; }
  }
}
static void propagate(void) {
  while (sn) {
    int i = st[--sn]; revise(i);
    int n = nch, ch[4]; for (int q = 0; q < n; q++) ch[q] = changed[q];
    for (int q = 0; q < n; q++) { int c = ch[q]; if (!dom[c]) dom[c] = (u16)(1u << home[c]); hpush(c); around(c, i); }
  }
}

// result: number of mixed cells, or -1 when there is nothing to blend (the JS returns null)
EXPORT int bl_blend(const u8 *setOf, int w, int h, int seed, const int *fixed, int nfixed, u8 *corners, u8 *mixed) {
  W = w; H = h; N = W * H; CW = W + 1; CH = H + 1; NC = CW * CH; rs = (u32)seed;
  u8 *isFixed = alloc(N), *gA = alloc(N), *canBlend = alloc(N);
  int first = -1, any = 0;
  for (int i = 0; i < N; i++) {
    int si = setOf[i]; gA[i] = groupOf[si]; canBlend[i] = blendsOf[si]; isFixed[i] = 0;
    if (!canBlend[i]) isFixed[i] = 1; else if (first < 0) first = gA[i]; else if (gA[i] != first) any = 1;
  }
  if (!any) return -1;
  for (int f = 0; f < nfixed; f++) isFixed[fixed[f]] = 1;
  i32 *sat = alloc((W + 1) * (H + 1) * 4);
  for (int x = 0; x <= W; x++) sat[x] = 0;
  for (int y = 0; y < H; y++) {
    int row = 0; sat[(y + 1) * (W + 1)] = 0;
    for (int x = 0; x < W; x++) {
      int i = y * W + x, e = ((x + 1 < W && gA[i + 1] != gA[i]) || (y + 1 < H && gA[i + W] != gA[i]) || (x > 0 && gA[i - 1] != gA[i]) || (y > 0 && gA[i - W] != gA[i])) ? 1 : 0;
      row += e; sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row;
    }
  }
  dom = alloc(NC * 2); rep = alloc(NC * G * 4); home = alloc(NC); nearN = alloc(NC * G);
  for (int k = 0; k < NC * G; k++) { rep[k] = -1; nearN[k] = 0; }
  for (int cy = 0; cy < CH; cy++) for (int cx = 0; cx < CW; cx++) {
    int c = cy * CW + cx, o = c * G;
    int x0 = cx - 2 < 0 ? 0 : cx - 2, y0 = cy - 2 < 0 ? 0 : cy - 2, x1 = cx + 2 > W ? W : cx + 2, y1 = cy + 2 > H ? H : cy + 2;
    int edges = (x1 <= x0 || y1 <= y0) ? 0 : sat[y1 * (W + 1) + x1] - sat[y0 * (W + 1) + x1] - sat[y1 * (W + 1) + x0] + sat[y0 * (W + 1) + x0];
    if (edges == 0) {
      int i = (cy < H - 1 ? cy : H - 1) * W + (cx < W - 1 ? cx : W - 1), gI = gA[i];
      home[c] = (i8)gI; dom[c] = (u16)(1u << gI); rep[o + gI] = setOf[i]; continue;
    }
    int fixedG = -1, best = -1, bestN = -1;
    for (int y = cy - 1; y <= cy; y++) for (int x = cx - 1; x <= cx; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      int i = y * W + x, gI = gA[i]; nearN[o + gI]++; if (rep[o + gI] < 0) rep[o + gI] = setOf[i]; if (isFixed[i]) fixedG = gI;
    }
    for (int gI = 0; gI < G; gI++) if (nearN[o + gI] > bestN) { bestN = nearN[o + gI]; best = gI; }
    home[c] = (i8)(fixedG >= 0 ? fixedG : best);
    if (fixedG >= 0) { dom[c] = (u16)(1u << home[c]); continue; }
    u32 m = 1u << home[c];
    for (int y = cy - 2; y < cy + 2; y++) for (int x = cx - 2; x < cx + 2; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      int i = y * W + x; if (!canBlend[i]) continue;
      int gI = gA[i]; m |= 1u << gI; if (rep[o + gI] < 0) rep[o + gI] = setOf[i];
    }
    dom[c] = (u16)m;
  }
  hcap = 1024; hn = 0; hk = alloc(hcap * 8); hc = alloc(hcap * 4);
  scap = 1024; sn = 0; st = alloc(scap * 4);
  int open = 0;
  for (int c = 0; c < NC; c++) if (popcount(dom[c]) > 1) { open++; hpush(c); }
  if (!open) return -1;
  double wts[MAXG];
  while (hn) {
    int c = hpop();
    if (popcount(dom[c]) <= 1) continue;
    int cx = c % CW, cy = c / CW; double sw = 0;
    for (int v = 0; v < G; v++) {
      if (!((dom[c] >> v) & 1)) { wts[v] = 0; continue; }
      double wv = 0.35 + 4.0 * (double)nearN[c * G + v]; u32 b = 1u << v;
      if (cx + 1 < CW && dom[c + 1] == b) wv += 3; if (cx > 0 && dom[c - 1] == b) wv += 3;
      if (cy + 1 < CH && dom[c + CW] == b) wv += 3; if (cy > 0 && dom[c - CW] == b) wv += 3;
      wts[v] = wv; sw += wv;
    }
    double rr = rnd() * sw; int pick = home[c];
    for (int v = 0; v < G; v++) { rr -= wts[v]; if (wts[v] > 0 && rr <= 0) { pick = v; break; } }
    dom[c] = (u16)(1u << pick);
    sn = 0; around(c, -1); propagate();
  }
  for (int c = 0; c < NC; c++) {
    int v = 31 - clz(dom[c]), cy = c / CW, cx = c % CW;
    int fb = (cy < H - 1 ? cy : H - 1) * W + (cx < W - 1 ? cx : W - 1); if (fb > N - 1) fb = N - 1;
    corners[c] = (u8)(rep[c * G + v] >= 0 ? rep[c * G + v] : setOf[fb]);
  }
  int count = 0;
  for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
    int i = y * W + x, g0 = gA[i], c = y * CW + x;
    mixed[i] = 0;
    if (groupOf[corners[c]] != g0 || groupOf[corners[c + 1]] != g0 || groupOf[corners[c + CW]] != g0 || groupOf[corners[c + CW + 1]] != g0) { mixed[i] = 1; count++; }
  }
  return count;
}
