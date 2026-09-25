// Loads the C# game engine (game/Engine, compiled to WebAssembly by
// `npm run game:build`) and decodes the flat frame buffer it returns.
// All movement, physics, combat and AI run inside the C# engine; this side
// only draws what it reports.

export async function loadEngine(onProgress) {
  if (typeof WebAssembly !== 'object') throw new Error('This browser does not support WebAssembly.');
  const { dotnet } = await import('../engine/_framework/dotnet.js');

  let builder = dotnet;
  try {
    builder = builder.withModuleConfig({
      onDownloadResourceProgress: (loaded, total) => onProgress?.(loaded, total)
    });
  } catch {
    // Progress reporting is optional.
  }

  const runtime = await builder.create();
  const exports = await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName);
  const api = exports.CrimsonArena.Web.GameExports;
  const layout = JSON.parse(api.Layout());
  const decode = createDecoder(layout);

  return {
    layout,
    start: (seed) => api.Start(seed),
    step: (dt, buttons) => decode(api.Step(dt, buttons)),
    mood: () => api.Mood()
  };
}

/** Turn the engine's flat double[] into plain objects, using the layout it publishes. */
export function createDecoder(layout) {
  const eventNames = invert(layout.events);

  return (buf) => {
    let i = 0;
    const read = (fields) => {
      const o = {};
      for (const f of fields) o[f] = buf[i++];
      return o;
    };
    const list = (fields) => {
      const n = buf[i++];
      const out = new Array(n);
      for (let k = 0; k < n; k++) out[k] = read(fields);
      return out;
    };

    const snap = read(layout.header);
    snap.player = read(layout.player);
    snap.enemies = list(layout.enemy);
    snap.projectiles = list(layout.projectile);
    snap.traps = list(layout.trap);
    snap.pickups = list(layout.pickup);
    snap.events = list(layout.event);
    for (const e of snap.events) e.name = eventNames[e.type];
    return snap;
  };
}

function invert(map) {
  const out = {};
  for (const [k, v] of Object.entries(map)) out[v] = k;
  return out;
}
