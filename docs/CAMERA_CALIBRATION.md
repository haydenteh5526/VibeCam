# Camera fidelity and the next calibration pass

The six bundled looks are creative interpretations. A static colour table cannot
reproduce a different lens, sensor, autofocus, flash geometry or lost highlight detail.
The existing reference profiles describe unrelated sample photos; they do not prove
that an iPhone and a named camera render the same scene identically.

## What this revision fixes

The actual PNG tables store red fastest, then green, then blue. The old photo shader
and video generator assumed a different strip layout and exchanged the green/blue
input axes. The shared shader and regenerated video cubes now agree with the CPU
reference on all six bundled tables. Highlight rolloff compresses rather than brightens.
Photo recipes provide restrained exposure, warmth, look strength and texture controls.

Old rendered Film Roll items are intentionally preserved. Open one and choose its
camera again to apply the corrected renderer from the retained original, then save
the new edit. Already exported Photos copies cannot be changed by this update.

## How to calibrate a named look

1. Specify the exact camera model, JPEG picture style, white balance, ISO, lens and
   flash settings. X100 generations and Sony RX100 generations are not interchangeable.
2. Capture paired iPhone and camera originals of the same scene, from the same position
   and within seconds. Include a colour chart and grey card. Keep the original files
   and capture metadata; do not use social-media recompressions.
3. Cover daylight, open shade, tungsten, mixed light, direct flash and low light, with
   varied skin tones, foliage, saturated colours, shadows and near-clipped highlights.
4. Separate fitting scenes from held-out scenes. Align exposure/white balance using
   the cards, then fit smooth colour/tone transforms and evaluate the held-out set.
   Report chart colour error and clipping alongside side-by-side human review.
5. Measure spatial differences separately: noise versus luminance, sharpening halos,
   corner falloff, softness and chromatic aberration. Check video for temporal flicker.
6. Bake versioned tables, run the CPU/GPU/video parity tests, and compare exported JPEGs
   and MP4s on a physical iPhone. Record capture latency, memory and thermal behaviour.

## Next experience improvements

- A native processed live viewfinder so framing and exposure decisions use the actual
  selected look. Current expo-camera preview is unprocessed and labelled accordingly.
- Per-camera capture guidance and calibrated defaults, based on the paired evidence.
- Video character/exposure controls only after measuring a stable native render budget.
- A TestFlight feedback pass focused on first capture, switching cameras, comparing,
  saving and finding a photo again, including VoiceOver and larger text.
