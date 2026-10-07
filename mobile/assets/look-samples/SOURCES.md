# Look samples

`original.jpg` is an illustrative AI-generated scene made with the built-in
image generation tool on 2026-10-07. It is not a real camera reference or calibration
photograph. The source was resized to 960 × 720 and saved at JPEG quality 95.

All six named variants are rendered from that source by the actual VibeCam photo
shader, bundled LUTs and default recipe, with seed 2026 and no date stamp. They
illustrate the app's photo looks. Video only uses the colour transform.

To rebuild the variants after a renderer change, run `node tools/build-look-samples.mjs`
from `mobile`, open `http://127.0.0.1:8084` in a browser with WebGL enabled, and wait
for the success message. Stop the development server afterward. The local builder
only writes the six known sample filenames. The app loads bundled JPEGs offline;
it does not generate a grid of GPU previews at runtime.

## Generation prompt

Create one photorealistic neutral reference photo for a camera app's sample scene,
landscape 4:3 composition. A candid daylight moment at a small outdoor Mediterranean
cafe: an adult woman with medium brown skin and short dark curly hair, wearing an
understated cream cotton shirt, sits at a small terracotta red table holding a plain
cobalt-blue ceramic cup. A bowl with a couple of oranges on the table, green climbing
foliage behind her, pale warm stone wall, a glimpse of clear blue sky. Frame from waist
up with her centered and generous surrounding details so square crops still keep
face, cup, table, foliage visible. She looks slightly away, relaxed, not posed like an
advertisement. Soft natural daylight with some gentle shadow detail and bright
textured highlights. Neutral white balance, restrained realistic colors, standard
ungraded camera JPEG appearance, sharp natural detail. No simulated vintage effects,
no grain, no vignette, no color grading, no text, no logos, no borders, no watermark.
This will be the same source image passed through different app color transformations;
preserve a broad natural range of skin, greens, blues, reds, whites and oranges.
