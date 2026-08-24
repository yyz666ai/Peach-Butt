#!/bin/zsh
set -euo pipefail

if [[ $# -ne 1 ]]; then
  print -u2 "usage: $0 /absolute/path/to/image.png"
  exit 2
fi

source_image="$1"
repo_root="${0:A:h:h}"
output_dir="$repo_root/assets/app-icon"
iconset_dir="$(mktemp -d)/pipeach.iconset"

mkdir -p "$output_dir" "$iconset_dir"

# ImageGen source uses a nearly-white studio background. Remove only pixels
# close to that background, then keep generous transparent breathing room.
magick "$source_image" \
  -alpha on -fuzz 4% -transparent white \
  -trim +repage -resize 880x880 \
  -gravity center -background none -extent 1024x1024 \
  "$output_dir/pipeach-icon-master.png"

for size in 16 32 128 256 512; do
  magick "$output_dir/pipeach-icon-master.png" -resize "${size}x${size}" "$iconset_dir/icon_${size}x${size}.png"
  double_size=$((size * 2))
  magick "$output_dir/pipeach-icon-master.png" -resize "${double_size}x${double_size}" "$iconset_dir/icon_${size}x${size}@2x.png"
done

iconutil -c icns "$iconset_dir" -o "$output_dir/pipeach.icns"
magick "$output_dir/pipeach-icon-master.png" \
  -define icon:auto-resize=256,128,64,48,32,16 \
  "$output_dir/pipeach.ico"

print "Built $output_dir/pipeach-icon-master.png"
print "Built $output_dir/pipeach.icns"
print "Built $output_dir/pipeach.ico"
