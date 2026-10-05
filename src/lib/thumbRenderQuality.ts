/**
 * Final gpt-image-2 prompt lock shared by Clay + Mystery + Space agents.
 * Keep banner text treatment strong; push uniqueness, realism, and lighter objects.
 */
export const THUMB_RENDER_QUALITY = [
  "QUALITY LOCK (mandatory — efficient high-quality YouTube thumb):",
  "TEXT FIRST: on-image punch/banner must be the sharpest thing in frame — thick geometric ALL-CAPS sans, perfectly even letter spacing, ultra-crisp edges, high-contrast fill (white or yellow) with a hard black outline/shadow so every glyph pops at phone size.",
  "Do NOT warp, melt, glow, chrome, bubble, blur, shrink, or AI-distort letters. Text looks composited like a real YouTube editor, not generative mush.",
  "Max 2-5 blunt words. Huge readable type. Leave clear negative space if the reference uses a text zone.",
  "Make subjects and props DISTINCT for THIS title only — specific unique details (materials, wear, markings, stage of discovery) so the frame does not feel like a recycled generic template.",
  "Photoreal documentary realism: real stone/metal/paper/skin/space textures, believable depth of field, natural camera look — not plastic CGI, painterly mush, or over-processed AI sheen.",
  "Lighten objects and discovery subjects: brighter key light, lifted midtones, clean specular highlights; avoid crushed blacks, heavy mud, and dark vignettes that bury props.",
  "Sharper overall micro-contrast: crisp silhouettes on text AND objects; no soft blurry edges on the punch line or key props.",
  "Proper polished YouTube thumbnail: clear focal hierarchy, punchy-but-natural color, readable at small size, no watermarks/logos/UI chrome.",
].join(" ");

/** Short rules injected into the reasoning-model system brief. */
export const THUMB_QUALITY_SYSTEM_RULES = [
  "Render quality: TEXT must be thick, ultra-sharp, high-contrast ALL-CAPS (best-in-class YouTube punch type).",
  "Never invent AI glow/chrome/bubble fonts — match real competitor thumbnail typography.",
  "Keep punch lines short (2-5 words) and phone-readable.",
  "Push unique title-specific discovery details — not generic recycled props.",
  "Photoreal documentary lighting; lighten artifacts/objects (lifted midtones, clean highlights).",
  "Avoid muddy crushed blacks, soft mushy edges, and plastic CGI look.",
].join(" ");
