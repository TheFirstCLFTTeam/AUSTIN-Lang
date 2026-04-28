# Word-level Timestamps from Whisper

**Goal.** Produce per-word `{start, end}` alongside the transcript so the
review UI can drive an accurate playhead-follow highlight (replacing the
linear-interpolation approximation currently in `src/lib/transcriptEdits.js
:: rawWordIntervals`).

**Current stack** (from `backend/transcription-service-2/main.py`):

- Model: `openai/whisper-large-v3-turbo`
- Runtime: Hugging Face `transformers.pipeline("automatic-speech-recognition")`
- Called with `return_timestamps=True` → produces **chunk-level** segment
  timestamps, not word-level.

Yes, word-level timestamps are achievable — there are four ladder rungs with
very different cost/accuracy trade-offs.

---

## Option 1 — Flip one flag in the existing pipeline (cheapest)

Whisper produces word-level timestamps via **Dynamic Time Warping (DTW)**
applied to its cross-attention weights. Hugging Face exposes this through the
same pipeline we already use.

**Change required** (`transcription-service-2/main.py:64`):

```python
pipe = pipeline(
    "automatic-speech-recognition",
    model=model,
    tokenizer=processor.tokenizer,
    feature_extractor=processor.feature_extractor,
    max_new_tokens=128,
    chunk_length_s=30,
-   batch_size=16,
-   return_timestamps=True,
+   batch_size=1,                 # required for word-level DTW to be reliable
+   return_timestamps="word",     # "word" instead of True
    torch_dtype=torch_dtype,
    device=device,
)
```

Response shape becomes:

```python
{
  "text": "...",
  "chunks": [
    {"text": " Good", "timestamp": (0.0, 0.28)},
    {"text": " morning", "timestamp": (0.28, 0.74)},
    ...
  ]
}
```

Then `transcription_orchestrator.py` (already maps `chunks → segments` at
line 96) can be extended to carry the word list into each
`rawTranscript.transcript_segments[*].words` array:

```python
{
  "id": 1, "start": 0.0, "end": 11.0,
  "text": "Good morning ...",
  "words": [{"word": "Good", "start": 0.0, "end": 0.28}, ...]
}
```

**Pros**
- One-line change in the model call plus a small passthrough in the
  orchestrator. No new dependency.
- Works with the fine-tuned LoRA adapters (they're just weight deltas, the
  DTW head uses the base model's cross-attention).

**Cons**
- `batch_size=1` is a real throughput hit — you lose the `batch_size=16`
  parallelism. Expect roughly 4-8× slower per job on the same GPU. For the
  non-realtime transcription jobs in this system, still fine; for bulk
  re-transcription of the corpus, painful.
- DTW timestamps are **approximate** — Whisper wasn't trained to produce
  aligned per-word timestamps, it infers them post-hoc from attention. The
  community has documented drift and "totally out-of-sync" periods,
  especially on long audio, silence, or overlapping speech.
- Known bugs with `return_timestamps="word"` on `large-v3` variants — there
  are open HF issues about word-level timestamp duration mismatch with the
  total audio length. Test on our corpus before shipping.

**Verdict.** Good first step to validate the UX end-to-end. Ship behind a
feature flag, measure quality on a sampled batch, then decide whether to
promote to default or move up the ladder.

---

## Option 2 — WhisperX (forced alignment via wav2vec2)

`m-bain/whisperX` runs Whisper (via faster-whisper) for the transcript, then
**force-aligns** the text against the audio using a phoneme-level wav2vec2
model. The wav2vec2 CTC output is much better at telling you *when* a
specific phoneme was said, so the resulting word timestamps are sharper than
DTW.

**Changes required**
- Swap or wrap the current pipeline with `whisperx` in
  `transcription-service-2/`. WhisperX uses faster-whisper as its transcription
  backend, so the LoRA adapter story gets more complicated — LoRA adapters
  are in PEFT format for the HF model, and faster-whisper uses CT2 weights.
  You'd either maintain two copies of the model (HF for fine-tuning, CT2
  converted-on-demand for inference) or skip WhisperX and run the alignment
  step separately (see Option 3).
- Add a wav2vec2 alignment model download per supported language (~300MB
  for `WAV2VEC2_ASR_LARGE_LV60K_960H` for English).

**Pros**
- Significantly more accurate word timestamps than DTW, especially on
  verbatim transcription of speech with disfluencies.
- Bonus: diarization ("who said what") is built in via pyannote.
- Designed to batch efficiently, so throughput isn't as bad as DTW at
  `batch_size=1`.

**Cons**
- Extra moving parts (wav2vec2 model, VAD, diarization) — more memory, more
  failure modes.
- wav2vec2 is noise-sensitive. Noisy finance calls (Zoom compression,
  speakerphone, background chatter) are where it degrades most.
- LoRA adapter compatibility is non-trivial — need to convert adapters to
  CT2 or run the alignment as a separate step after the HF pipeline
  transcribes.

**Verdict.** Right answer if we're willing to split "transcribe" from
"align" into two pipeline stages. Not a drop-in.

---

## Option 3 — HF pipeline (transcribe) + wav2vec2 forced alignment (align)

Same idea as WhisperX but factored differently: keep the current HF pipeline
exactly as it is for transcription, then run a separate forced-alignment
step using a wav2vec2 CTC model (e.g., `facebook/wav2vec2-large-960h-lv60-self`
for English, or `jonatasgrosman/wav2vec2-large-xlsr-53-english`) to map the
already-produced transcript text onto audio time.

Minimal Python:

```python
from transformers import AutoProcessor, AutoModelForCTC
import torchaudio

aligner = AutoModelForCTC.from_pretrained("facebook/wav2vec2-large-960h-lv60-self")
aligner_proc = AutoProcessor.from_pretrained("facebook/wav2vec2-large-960h-lv60-self")

# Given the Whisper transcript text and the audio, run CTC forced alignment
# with torchaudio.functional.forced_align to get per-token {start, end}.
```

**Pros**
- Keeps Whisper's transcription quality (including our LoRA-tuned adapters)
  untouched.
- Gives WhisperX-class alignment accuracy without adopting WhisperX's
  faster-whisper runtime.
- Clean separation of concerns — alignment lives in its own service or
  function, easy to swap/upgrade independently.

**Cons**
- More implementation work than Option 1 (but less than Option 2's full
  WhisperX adoption). You write and maintain the alignment code.
- Same noise caveats as Option 2 — wav2vec2 isn't robust in noisy audio.
- Alignment model is language-specific (one more model per language we
  support).

**Verdict.** Best engineering ROI if Option 1's accuracy turns out to be
insufficient. Keeps the transcription service stable while adding a
well-isolated alignment stage.

---

## Option 4 — CrisperWhisper (model swap, purpose-trained)

`nyrahealth/faster_CrisperWhisper` is a Whisper fine-tune specifically trained
for accurate verbatim timestamps (the CrisperWhisper paper, 2024). It solves
the root cause — Whisper wasn't trained for per-word alignment — by training
for exactly that.

**Pros**
- Drop-in accuracy improvement on timestamps.
- Preserves Whisper's transcription quality.
- No separate alignment stage.

**Cons**
- Base model change — our LoRA adapters were trained against
  `whisper-large-v3-turbo`. Switching the base means retraining the adapters
  (the retraining pipeline exists, but re-running it is a project).
- `faster_*` variants mean CT2 runtime — same LoRA compatibility issue as
  Option 2.
- Less battle-tested than vanilla Whisper on the full range of audio we
  might see.

**Verdict.** Strong long-term option if we're willing to migrate the fine-tune
pipeline. Short-term blocker: it breaks our adapter story until we retrain.

---

## Recommendation

1. **Ship Option 1 first.** One-line change, lets us validate the frontend
   UX with real per-word timing without any architectural rework. Measure
   alignment quality against a sampled batch (~50 earnings/SPGI clips).
2. If Option 1's DTW drift is visibly bad (>200ms off on noticeable words
   during QA), escalate to **Option 3** — keep the HF pipeline, add a
   wav2vec2 alignment step in the orchestrator after transcription. This
   preserves the LoRA adapter story.
3. Defer Options 2 and 4 unless we take on a larger inference-path rewrite
   for other reasons (diarization, throughput, multi-language coverage).

---

## Frontend wiring, once word timestamps are available

`src/lib/transcriptEdits.js :: rawWordIntervals(rawSegment)` is the only
frontend function that needs to change. Current implementation derives
intervals by linear interpolation; the new implementation should prefer the
server-provided `segment.words[*]` if present and fall back to interpolation
otherwise:

```js
export function rawWordIntervals(rawSegment) {
  if (Array.isArray(rawSegment?.words) && rawSegment.words.length) {
    return rawSegment.words.map((w) => ({ start: w.start, end: w.end }));
  }
  // ... existing linear-interp fallback ...
}
```

`buildDiffView` and the view-mode renderer already key off `rawIndex` into
the `rawWordIntervals` array, so no further UI changes are needed. Inserted
(green) tokens still have no timestamp — that's inherent, not something real
word timestamps fix.

---

## Sources

- [HF Transformers — word-level timestamps implementation PR](https://github.com/huggingface/transformers/pull/23205)
- [HF issue: word-level timestamps on whisper-large-v3](https://github.com/huggingface/transformers/issues/27446)
- [HF issue: word-level timestamp duration mismatch](https://github.com/huggingface/transformers/issues/36228)
- [whisper-large-v3 model card](https://huggingface.co/openai/whisper-large-v3)
- [WhisperX repo — word-level + diarization](https://github.com/m-bain/whisperX)
- [WhisperX paper (Interspeech 2023)](https://www.isca-archive.org/interspeech_2023/bain23_interspeech.pdf)
- [Modal blog: choosing between Whisper variants](https://modal.com/blog/choosing-whisper-variants)
- [WhisperX vs MFA accuracy discussion](https://github.com/m-bain/whisperX/issues/1247)
- [Forced alignment method comparison paper (2024)](https://arxiv.org/html/2406.19363v1)
- [CrisperWhisper paper — accurate verbatim timestamps](https://arxiv.org/html/2408.16589v1)
- [nyrahealth/faster_CrisperWhisper](https://huggingface.co/nyrahealth/faster_CrisperWhisper)