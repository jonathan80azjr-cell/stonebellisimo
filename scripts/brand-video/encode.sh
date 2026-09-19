set -e
cd /private/tmp/claude-501/-Users-maxj-Documents-stonebellisimo-main/9ff63c57-5dcd-45cd-88a7-effc2fc036aa/scratchpad
OUT=/Users/maxj/Documents/stonebellisimo-main/brand-assets/video

# ProRes 4444 with alpha (drop into Premiere/Final Cut/Resolve/CapCut)
ffmpeg -y -v error -framerate 30 -i frames/logo_white/f_%04d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -vendor apl0 "$OUT/stone-bellisimo-logo-white-alpha.mov"
ffmpeg -y -v error -framerate 30 -i frames/logo_brown/f_%04d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -vendor apl0 "$OUT/stone-bellisimo-logo-brown-alpha.mov"

# WebM VP9 with alpha (web / smaller file)
ffmpeg -y -v error -framerate 30 -i frames/logo_white/f_%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 26 -row-mt 1 "$OUT/stone-bellisimo-logo-white-alpha.webm"
ffmpeg -y -v error -framerate 30 -i frames/logo_brown/f_%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 26 -row-mt 1 "$OUT/stone-bellisimo-logo-brown-alpha.webm"

# End card 9:16 mp4 + poster png
ffmpeg -y -v error -framerate 30 -i frames/endcard/f_%04d.png -c:v libx264 -pix_fmt yuv420p -crf 17 -preset slow -movflags +faststart "$OUT/stone-bellisimo-endcard-9x16.mp4"
cp out/endcard_poster.png "$OUT/stone-bellisimo-endcard-9x16.png"
ls -la "$OUT"
