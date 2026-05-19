#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
output_dir="${POCKEDIO_PREVIEW_DIR:-$HOME/.pockedio/audio/previews}"
python_path="${POCKEDIO_FISHAUDIO_PYTHON:-$repo_root/.cache/mlx-speech-venv/bin/python}"
script_path="${POCKEDIO_FISHAUDIO_SCRIPT:-$repo_root/.cache/mlx-speech/scripts/generate/fish_s2_pro.py}"
model_dir="${POCKEDIO_FISHAUDIO_MODEL_DIR:-/Users/leonw/.cache/huggingface/hub/models--appautomaton--fishaudio-s2-pro-8bit-mlx/snapshots/29ab46393de21f696a82050d8594a677a5797f7e}"

mkdir -p "$output_dir"

generate_preview() {
  local id="$1"
  local text_file="$repo_root/spikes/dj-previews/$id.txt"
  local output_file="$output_dir/$id.wav"

  echo "Generating $id preview..."
  "$python_path" "$script_path" \
    --text "$(cat "$text_file")" \
    --model-dir "$model_dir" \
    --output "$output_file" \
    --trim-leading-silence \
    --normalize-peak 0.95
  echo "Wrote $output_file"
}

generate_preview mina
generate_preview nova

echo
echo "DJ previews generated:"
echo "  $output_dir/mina.wav"
echo "  $output_dir/nova.wav"

