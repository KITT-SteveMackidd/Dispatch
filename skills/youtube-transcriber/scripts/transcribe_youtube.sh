#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <youtube-url> [--model base] [--lang en] [--out /path]"
  exit 1
fi

URL="$1"
shift || true

MODEL="base"
LANG=""
OUT_DIR="${PWD}/transcripts"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      MODEL="$2"; shift 2 ;;
    --lang)
      LANG="$2"; shift 2 ;;
    --out)
      OUT_DIR="$2"; shift 2 ;;
    *)
      echo "Unknown option: $1"; exit 1 ;;
  esac
done

need_bin() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing dependency: $1"
    return 1
  }
}

MISSING=0
need_bin yt-dlp || MISSING=1
need_bin ffmpeg || MISSING=1
need_bin python3 || MISSING=1

if [[ $MISSING -ne 0 ]]; then
  cat <<'EOF'
Install dependencies, then retry:
  - Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y ffmpeg python3 python3-pip
  - yt-dlp: sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp
  - Whisper: python3 -m pip install --user -U openai-whisper
EOF
  exit 2
fi

if ! python3 - <<'PY' >/dev/null 2>&1
import whisper
PY
then
  echo "Missing Python package: openai-whisper"
  echo "Install with: python3 -m pip install --user -U openai-whisper"
  exit 3
fi

mkdir -p "$OUT_DIR"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# Resolve video id (fallback-safe)
VIDEO_ID="$(yt-dlp --get-id "$URL" 2>/dev/null | head -n1 || true)"
if [[ -z "${VIDEO_ID}" ]]; then
  VIDEO_ID="video_$(date +%s)"
fi

AUDIO_PATH="$WORK_DIR/${VIDEO_ID}.%(ext)s"
yt-dlp -f bestaudio --no-playlist -o "$AUDIO_PATH" "$URL"

# Find downloaded audio file
audio_file="$(find "$WORK_DIR" -maxdepth 1 -type f | head -n1)"
if [[ -z "${audio_file}" ]]; then
  echo "Audio download failed."
  exit 4
fi

# Normalize to wav for whisper
WAV_PATH="$WORK_DIR/${VIDEO_ID}.wav"
ffmpeg -y -i "$audio_file" -ar 16000 -ac 1 "$WAV_PATH" >/dev/null 2>&1

TRANSCRIPT_TXT="$OUT_DIR/${VIDEO_ID}.txt"
TRANSCRIPT_SRT="$OUT_DIR/${VIDEO_ID}.srt"
META_JSON="$OUT_DIR/${VIDEO_ID}.meta.json"

LANG_ARG=()
if [[ -n "$LANG" ]]; then
  LANG_ARG=(--language "$LANG")
fi

python3 - <<PY
import json, whisper
from pathlib import Path

wav = Path(r"$WAV_PATH")
model_name = r"$MODEL"
out_txt = Path(r"$TRANSCRIPT_TXT")
out_srt = Path(r"$TRANSCRIPT_SRT")
meta_json = Path(r"$META_JSON")
lang = r"$LANG"

model = whisper.load_model(model_name)
kwargs = {}
if lang:
    kwargs["language"] = lang
result = model.transcribe(str(wav), **kwargs)

out_txt.write_text(result.get("text", "").strip() + "\n", encoding="utf-8")

segments = result.get("segments", [])

def fmt_ts(t):
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int((t - int(t)) * 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"

with out_srt.open("w", encoding="utf-8") as f:
    for i, seg in enumerate(segments, 1):
        f.write(f"{i}\n")
        f.write(f"{fmt_ts(seg['start'])} --> {fmt_ts(seg['end'])}\n")
        f.write(seg.get("text", "").strip() + "\n\n")

meta = {
    "model": model_name,
    "language": result.get("language"),
    "segments": len(segments)
}
meta_json.write_text(json.dumps(meta, indent=2), encoding="utf-8")
PY

echo "Transcript complete:"
echo "  TXT: $TRANSCRIPT_TXT"
echo "  SRT: $TRANSCRIPT_SRT"
echo "  META: $META_JSON"
