// Runtime for the WebAssembly generator: one bump allocator shared by every kernel.
#include "rt.h"
extern unsigned char __heap_base;
static unsigned long heapTop = 0, scratchBase = 0;
static void ensure(unsigned long end) {
  unsigned long have = __builtin_wasm_memory_size(0) * 65536ul;
  if (end > have) __builtin_wasm_memory_grow(0, (end - have + 65535) / 65536);
}
void *alloc(unsigned long n) {
  if (!heapTop) heapTop = (unsigned long)&__heap_base;
  heapTop = (heapTop + 15) & ~15ul;
  void *p = (void *)heapTop; heapTop += n; ensure(heapTop); return p;
}
EXPORT void *rt_alloc(int n) { return alloc((unsigned long)n); }        // permanent: call before rt_mark
EXPORT void rt_mark(void) { if (!heapTop) heapTop = (unsigned long)&__heap_base; scratchBase = heapTop; }
EXPORT void rt_reset(void) { if (scratchBase) heapTop = scratchBase; } // frees all scratch
EXPORT void *rt_scratch(int n) { return alloc((unsigned long)n); }
void *memcpy(void *d, const void *s, unsigned long n) { u8 *a = d; const u8 *b = s; while (n--) *a++ = *b++; return d; }
void *memset(void *d, int c, unsigned long n) { u8 *a = d; while (n--) *a++ = (u8)c; return d; }
void *grow(void *p, unsigned long oldBytes, unsigned long newBytes) { void *q = alloc(newBytes); memcpy(q, p, oldBytes); return q; }
EXPORT double rt_log(double x) { return flog(x); } // for the parity test
