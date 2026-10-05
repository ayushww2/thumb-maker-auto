/**
 * Final gpt-image-2 prompt lock shared by Clay + Mystery agents.
 * Keep banner text treatment strong; push uniqueness, realism, and lighter objects.
 */
export const THUMB_RENDER_QUALITY = [
  "QUALITY LOCK (mandatory):",
  "Keep the on-image banner/punch TEXT treatment strong and SUPER readable — thick ALL-CAPS, ultra-sharp letter edges, high-contrast fill with a clean outline/shadow so every word pops at phone size. Do not soften, blur, shrink, or muddle the text.",
  "Make subjects and props DISTINCT for THIS title only — specific unique details (materials, wear, markings, stage of discovery) so the frame does not feel like a recycled generic template.",
  "Photoreal documentary realism: real stone/metal/paper/skin textures, believable depth of field, natural camera look — not plastic CGI, painterly mush, or over-processed AI sheen.",
  "Lighten objects and discovery subjects: brighter key light, lifted midtones, clean specular highlights on artifacts/faces; avoid crushed blacks, heavy mud, and dark vignettes that bury props.",
  "Sharper overall micro-contrast: crisp silhouettes on text AND objects; no soft blurry edges on the punch line or key props.",
  "Proper polished YouTube thumbnail: clear focal hierarchy, punchy-but-natural color, readable at small size, no watermarks/logos/UI chrome.",
].join(" ");

/** Short rules injected into the reasoning-model system brief. */
export const THUMB_QUALITY_SYSTEM_RULES = [
  "Render quality: keep banner text thick, sharp, high-contrast (text treatment stays excellent).",
  "Push unique title-specific discovery details — not generic recycled props.",
  "Photoreal documentary lighting; lighten artifacts/objects (lifted midtones, clean highlights).",
  "Avoid muddy crushed blacks, soft mushy edges, and plastic CGI look.",
].join(" ");
