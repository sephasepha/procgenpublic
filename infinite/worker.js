// Generates sectors off the main thread so walking stays smooth.
importScripts('../gen/mazes.js', '../gen/core.js', '../gen/world.js');
onmessage = e => {
  const { gen, settings, sx, sy } = e.data;
  let r;
  try { r = genSector(settings, sx, sy); } catch (err) { r = { sx, sy, ok: false, error: String(err) }; }
  if (r.ok) postMessage({ gen, r }, [r.pass.buffer, r.col.buffer]);
  else postMessage({ gen, r });
};
