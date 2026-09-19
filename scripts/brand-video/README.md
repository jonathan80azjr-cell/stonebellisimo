# Brand video generator

Renders the animated Stone Bellisimo logo (transparent, for overlaying on videos)
and the 9:16 end card into `brand-assets/video/` (gitignored).

How it works: `build_html.mjs` rebuilds the logo as an animated HTML page —
the frame is a vector path that draws itself on; the lettering is lifted
pixel-perfect from `public/logo.png` and recolored with a clean alpha matte.
`render.mjs` screenshots each frame through Playwright/Chromium with a
transparent background; `encode.sh` turns frames into ProRes 4444 / VP9 / H.264.

Regenerate:

    node scripts/brand-video/build_html.mjs   # writes logo.html + endcard.html next to the script
    node scripts/brand-video/render.mjs still    # quick QA stills
    node scripts/brand-video/render.mjs logo     # 2 x 210 frames (white + brown, alpha)
    node scripts/brand-video/render.mjs endcard  # 240 frames
    bash scripts/brand-video/encode.sh           # writes brand-assets/video/

Note: the scripts were written with scratchpad-relative paths; if the session
scratchpad is gone, update the `here`/output paths at the top of each file first.
Timings, colors and copy (phone, domain, tagline) are all in `build_html.mjs`.
