// Default rules from the spec ("Regras de UV e topologia"). Every value can be
// overridden per asset in asset.json.

export const CATEGORIES = {
  'prop-small':   { triangles: [300, 1500],   texelDensity: 512,  texture: 1024 },
  'prop-medium':  { triangles: [1500, 5000],  texelDensity: 512,  texture: 1024 },
  'prop-hero':    { triangles: [5000, 15000], texelDensity: 1024, texture: 2048 },
  'architecture': { triangles: [200, 2000],   texelDensity: 512,  texture: 1024 },
  'lowpoly':      { triangles: [50, 1500],    texelDensity: null, texture: 512 },
};

// Island padding / border margin in pixels, by texture resolution.
export const PADDING = {
  256:  { padding: 2,  margin: 1 },  // extrapolated (spec table starts at 512)
  512:  { padding: 4,  margin: 2 },
  1024: { padding: 8,  margin: 4 },
  2048: { padding: 16, margin: 8 },
  4096: { padding: 32, margin: 16 },
};

export const DEFAULTS = {
  smoothingAngle: 50,       // degrees; split normals above this (45° chamfers stay smooth)
  seamAngle: 60,            // degrees; hard edges at/above this are seams
  continuousAngle: 30,      // seams on edges flatter than this count as 'mid-surface'
  smoothContinuation: 35,   // charts always grow across edges flatter than this (12+ segment cylinders)
  dimensionTolerance: 0.02, // ±2%
  texelVariance: 0.10,      // ±10% between islands
  hiddenTexelFactor: 0.25,  // faces never seen (bottom on floor)
  maxDistortion: 0.05,      // 5% area/angle stretch per island
  minUtilization: 0.70,     // ≥70% of UV space used
  lightmapResolution: 128,
  lightmapPadding: 2,       // texels
  maxIterations: 5,
  minVisualScore: 8,
};

/** Merges category + global defaults + blueprint overrides into one rule set. */
export function resolveRules(bp) {
  const cat = CATEGORIES[bp.category] ?? CATEGORIES['prop-medium'];
  const texture = bp.texture?.resolution ?? cat.texture;
  const pad = PADDING[texture] ?? PADDING[1024];
  return {
    ...DEFAULTS,
    ...(bp.rules ?? {}),
    category: bp.category,
    triangles: bp.triangleBudget ?? cat.triangles,
    texelDensity: bp.texture?.texelDensity ?? cat.texelDensity,
    texture,
    // Without an explicit resolution, `studio3d uv` halves the texture while density stays ≥ target.
    autoResolution: !bp.texture?.resolution,
    padding: bp.texture?.padding ?? pad.padding,
    margin: bp.texture?.margin ?? pad.margin,
    lightmapResolution: bp.lightmap?.resolution ?? DEFAULTS.lightmapResolution,
    isStatic: bp.static !== false,
    style: bp.style ?? (bp.category === 'lowpoly' ? 'lowpoly' : 'pbr'),
  };
}
