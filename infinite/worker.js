// Generates sectors off the main thread so play stays smooth. The generator runs in WebAssembly
// (wasm/gen.wasm) once loaded, falling back to the bit-identical JavaScript if it can't load.
importScripts('../gen/mazes.js', '../gen/core.js', '../gen/dressing.js', '../gen/rooms.js', '../gen/world.js', '../gen/wasm.js');
const ready = GenWasm.load('../wasm/gen.wasm');
onmessage = async e => {
  await ready;
  const { gen, settings, sx, sy } = e.data;
  let r;
  try { r = genSector(settings, sx, sy); } catch (err) { r = { sx, sy, ok: false, error: String(err) }; }
  if (r.timing) r.timing.wasmError = GenWasm.ready ? null : GenWasm.error || 'not loaded';
  if (r.ok) postMessage({ gen, r }, [r.pass.buffer, r.col.buffer].concat(r.deco ? [r.deco.buffer] : []));
  else postMessage({ gen, r });
};
