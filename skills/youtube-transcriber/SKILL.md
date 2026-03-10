---
name: youtube-transcriber
description: Extract audio from YouTube URLs and generate transcripts locally. Use when a user asks for transcript text from a YouTube video and native YouTube captions are unavailable or disabled.
---

# YouTube Transcriber

Generate transcripts from YouTube videos by downloading audio and running local ASR.

## Run

```bash
bash skills/youtube-transcriber/scripts/transcribe_youtube.sh "https://youtu.be/VIDEO_ID"
```

Optional flags:

```bash
bash skills/youtube-transcriber/scripts/transcribe_youtube.sh "<url>" --model base --lang en --out /tmp/yt-transcripts
```

## Output

The script writes:

- `<video-id>.txt` (plain transcript)
- `<video-id>.srt` (timestamps)
- `<video-id>.meta.json` (metadata)

## Notes

- Requires: `yt-dlp`, `ffmpeg`, `python3`, and Python package `openai-whisper`.
- If dependencies are missing, the script prints exact install commands.
- Prefer `--lang en` when language is known for faster and cleaner output.
