// Layout WFC in C, compiled to WebAssembly: a line-for-line port of WFC.restart/step/propagate/fix in
// gen/core.js (same RNG calls in the same order, float32 weights and entropies, fdlibm log), so it
// collapses to exactly the same tiles as the JavaScript. JS still builds the per-cell domains and weights.
#include "rt.h"

static int NC_, T_, COLS_, ROWS_;
static u8 *dom; static const u8 *init, *sock, *ex; static const float *Wt; static double *WL; // WL = w * log(w), once per cell and tile
static short *cnt; static float *ent;
static u32 rs;
static double rng(void) {
  rs += 0x6D2B79F5u; u32 a = rs;
  u32 t = (a ^ (a >> 15)) * (1u | a);
  t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
  return (double)(t ^ (t >> 14)) / 4294967296.0;
}
static const int DX[4] = { 0, 1, 0, -1 }, DY[4] = { -1, 0, 1, 0 };

static void recalc(int c) {
  int n = 0; double sw = 0, swl = 0; const u8 *d = dom + c * T_; const float *w = Wt + c * T_;
  const double *wl = WL + c * T_;
  for (int t = 0; t < T_; t++) if (d[t]) { n++; sw += (double)w[t]; swl += wl[t]; }
  cnt[c] = (short)n; ent[c] = n > 1 ? (float)(flog(sw) - swl / sw) : 0.0f;
}
static u32 sideMask(int c, int d) { u32 m = 0; const u8 *dd = dom + c * T_; for (int t = 0; t < T_; t++) if (dd[t]) m |= 1u << sock[t * 4 + d]; return m; }

static int *q; static int qN; static u8 *inQ;
static int propagate(void) {
  while (qN) {
    int c = q[--qN]; inQ[c] = 0;
    int x = c % COLS_, y = c / COLS_;
    for (int d = 0; d < 4; d++) {
      int nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= COLS_ || ny >= ROWS_) continue;
      int n = ny * COLS_ + nx;
      if (ex[c] || ex[n]) continue; // no constraints across a sector border
      u32 m = sideMask(c, d); int od = (d + 2) & 3; u8 *b = dom + n * T_; int changed = 0;
      for (int t = 0; t < T_; t++) if (b[t] && !(m & (1u << sock[t * 4 + od]))) { b[t] = 0; changed = 1; }
      if (changed) {
        recalc(n);
        if (cnt[n] == 0) return n;
        if (!inQ[n]) { inQ[n] = 1; q[qN++] = n; }
      }
    }
  }
  return -1;
}
// a fresh queue (the JS makes a new inQ array for each propagate call)
static void qstart(void) { for (int c = 0; c < NC_; c++) inQ[c] = 0; qN = 0; }
static void qadd(int c) { q[qN++] = c; inQ[c] = 1; }

static int resets, restarts, done, collapsed;
static void restart(void) {
  memcpy(dom, init, (unsigned long)NC_ * T_);
  for (int c = 0; c < NC_; c++) recalc(c);
  qstart(); for (int c = 0; c < NC_; c++) qadd(c);
  propagate();
  done = 0; collapsed = 0;
}
static void fix(int fail) {
  int r = 2;
  while (fail >= 0) {
    resets++;
    if (resets > 400) { restarts++; resets = 0; restart(); return; }
    int x0 = fail % COLS_, y0 = fail / COLS_;
    for (int y = y0 - r < 0 ? 0 : y0 - r; y <= (y0 + r > ROWS_ - 1 ? ROWS_ - 1 : y0 + r); y++)
      for (int x = x0 - r < 0 ? 0 : x0 - r; x <= (x0 + r > COLS_ - 1 ? COLS_ - 1 : x0 + r); x++) { int c = y * COLS_ + x; memcpy(dom + c * T_, init + c * T_, T_); recalc(c); }
    qstart();
    int r1 = r + 1;
    for (int y = y0 - r1 < 0 ? 0 : y0 - r1; y <= (y0 + r1 > ROWS_ - 1 ? ROWS_ - 1 : y0 + r1); y++)
      for (int x = x0 - r1 < 0 ? 0 : x0 - r1; x <= (x0 + r1 > COLS_ - 1 ? COLS_ - 1 : x0 + r1); x++) qadd(y * COLS_ + x);
    fail = propagate();
    r = r + 1 < 8 ? r + 1 : 8;
  }
}
static int step(void) {
  if (done) return 0;
  int best = -1; double be = 1e9;
  for (int c = 0; c < NC_; c++) if (cnt[c] > 1) { double e = (double)ent[c] + rng() * 1e-3; if (e < be) { be = e; best = c; } }
  if (best < 0) { done = 1; return 0; }
  u8 *b = dom + best * T_; const float *w = Wt + best * T_; double sw = 0;
  for (int t = 0; t < T_; t++) if (b[t]) sw += (double)w[t];
  double r = rng() * sw; int pick = -1;
  for (int t = 0; t < T_; t++) if (b[t]) { r -= (double)w[t]; pick = t; if (r <= 0) break; }
  for (int t = 0; t < T_; t++) b[t] = t == pick ? 1 : 0;
  recalc(best); collapsed++;
  qstart(); qadd(best);
  int fail = propagate();
  if (fail >= 0) fix(fail);
  return 1;
}

// solve from a fresh restart, as the world does: while (wfc.step() && guard++ < maxSteps) {}
// in: init[NC*T], W[NC*T] (float32), sock[T*4], ex[NC]; out: dom[NC*T], cnt[NC], stats [resets, restarts, done, collapsed]
EXPORT int wfc_solve(int cols, int rows, int T, const u8 *initIn, const float *wIn, const u8 *sockIn, const u8 *exIn, int seed, int maxSteps, u8 *domOut, short *cntOut, int *stats) {
  COLS_ = cols; ROWS_ = rows; NC_ = cols * rows; T_ = T;
  init = initIn; Wt = wIn; sock = sockIn; ex = exIn; dom = domOut; cnt = cntOut;
  ent = rt_scratch(NC_ * 4); q = rt_scratch(NC_ * 4 * 4); inQ = rt_scratch(NC_);
  WL = rt_scratch(NC_ * T_ * 8);
  for (int k = 0; k < NC_ * T_; k++) if (init[k]) { double x = Wt[k]; WL[k] = x * flog(x); }
  rs = (u32)seed; resets = 0; restarts = 0;
  restart();
  int guard = 0;
  for (;;) { if (!step()) break; if (!(guard++ < maxSteps)) break; }
  stats[0] = resets; stats[1] = restarts; stats[2] = done; stats[3] = collapsed;
  return 0;
}

// ---------- domains and weights (WFC.buildInit / allowed / buildWeights in gen/core.js) ----------
// per cell: set (allowed styles bitmask), prim, sec (-1 none), req, wide, stamp, onPath, portalOut, ex, maze (0 = none)
// per tile: style (-1 rock), gateA/gateB (-1 none), sock[4], tw; cross[ns*ns]; per style: solid weight, maze k
EXPORT void wfc_prepare(int cols, int rows, int T, int ns,
    const u8 *set, const u8 *prim, const signed char *sec, const u8 *req, const u8 *wide, const u8 *stamp, const u8 *onPath, const u8 *portalOut, const u8 *exIn, const u8 *maze, int hasMaze,
    const signed char *tStyle, const signed char *gA, const signed char *gB, const u8 *sk, const float *tw,
    const signed char *cross, const double *solid, const double *mazeK, double strength,
    u8 *initOut, float *wOut) {
  int NC = cols * rows;
  for (int c = 0; c < NC; c++) {
    int x = c % cols, y = c / cols, rq = req[c];
    u8 *in = initOut + c * T; float *wo = wOut + c * T;
    for (int t = 0; t < T; t++) {
      int ok = 1;
      if (exIn[c]) ok = t == 0;
      else {
        if (tStyle[t] == -1) { if (rq || stamp[c]) ok = 0; }
        else if (gA[t] >= 0) {
          int a = gA[t], b = gB[t];
          if (!((set[c] >> a) & 1) || !((set[c] >> b) & 1)) ok = 0;
          else { int k = cross[a * ns + b]; if (!k || (k == 2 && !onPath[c])) ok = 0; else if (k == 1 && !rq && !(sec[c] >= 0)) ok = 0; }
        } else if (!((set[c] >> tStyle[t]) & 1)) ok = 0;
        for (int d = 0; d < 4 && ok; d++) {
          int nx = x + DX[d], ny = y + DY[d], so = sk[t * 4 + d], po = (portalOut[c] >> d) & 1;
          int edge = nx < 0 || ny < 0 || nx >= cols || ny >= rows || exIn[ny * cols + nx];
          if (edge && so != 0 && !po) ok = 0;
          else if (po && so % 2 != 1) ok = 0;
          else if (((rq >> d) & 1) && so == 0) ok = 0;
          else if (((wide[c] >> d) & 1) && !(so > 0 && so % 2 == 0)) ok = 0;
        }
      }
      in[t] = (u8)ok;
      wo[t] = 0.0f;
      if (!ok) continue;
      int st = prim[c]; double k = hasMaze ? strength * mazeK[st] : 0; int m = hasMaze ? maze[c] : 0;
      double w = t == 0 ? solid[st] : (double)tw[t];
      if (k > 0) {
        for (int d = 0; d < 4; d++) {
          int to = sk[t * 4 + d] > 0, mo = ((m >> d) & 1) == 1;
          if (to && mo) w *= 1 + 5 * k;
          else if (to && !mo) { double f = 1 - 0.9 * k; w *= f > 0.03 ? f : 0.03; }
          else if (!to && mo) { double f = 1 - 0.85 * k; w *= f > 0.03 ? f : 0.03; }
        }
      }
      wo[t] = (float)(w > 1e-6 ? w : 1e-6);
    }
  }
}
