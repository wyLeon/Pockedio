#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
model_dir="${FISH_AUDIO_MODEL_DIR:-"$HOME/.cache/huggingface/hub/models--appautomaton--fishaudio-s2-pro-8bit-mlx/snapshots/29ab46393de21f696a82050d8594a677a5797f7e"}"
runtime_dir="$repo_root/.cache/mlx-speech"
venv_dir="$repo_root/.cache/mlx-speech-venv"
output_file="$repo_root/spikes/fish-tts-sample.wav"
latency_file="$repo_root/spikes/fish-tts-latency.txt"

if [ ! -f "$model_dir/model.safetensors" ] || [ ! -f "$model_dir/codec-mlx/model.safetensors" ]; then
  echo "FishAudio MLX model is incomplete at $model_dir" | tee "$latency_file"
  exit 2
fi

if [ ! -d "$runtime_dir/.git" ]; then
  git clone https://github.com/appautomaton/mlx-speech.git "$runtime_dir"
fi

uv venv "$venv_dir" --python 3.13 --clear
uv pip install --python "$venv_dir/bin/python" -e "$runtime_dir"

{
  echo "Model dir: $model_dir"
  echo "Runtime dir: $runtime_dir"
  echo "Python: $("$venv_dir/bin/python" --version)"
  echo "Command: $venv_dir/bin/python $runtime_dir/scripts/generate/fish_s2_pro.py --text 'Pockedio is on air.' --model-dir '$model_dir' --output '$output_file'"
  time "$venv_dir/bin/python" "$runtime_dir/scripts/generate/fish_s2_pro.py" \
    --text "Pockedio is on air." \
    --model-dir "$model_dir" \
    --output "$output_file"
  file "$output_file"
} 2>&1 | tee "$latency_file"

test -s "$output_file"
