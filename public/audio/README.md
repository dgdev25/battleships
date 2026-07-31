# Battle audio sources

`explosion.ogg` is **Explosion 10.ogg**, recorded and released into the public
domain by Wikimedia Commons user tcpp.

- Source: https://commons.wikimedia.org/wiki/File:Explosion_10.ogg
- Original SHA-1: `e24332ca6f3caf39bb5acb30ea91a722b9001163`
- Local file is the unchanged 24,083-byte Ogg Vorbis original.

The missile whistle, low-frequency impact layers, and fallback detonation are
synthesized locally with the Web Audio API.

`water-splashes.ogg` is **Bathtub water splashes.ogg**, recorded and released
into the public domain by Wikimedia Commons user gradha.

- Source: https://commons.wikimedia.org/wiki/File:Bathtub_water_splashes.ogg
- Original SHA-1: `1d6b2a2579890d091b04112621b07878028e6070`
- Local file is the unchanged 768,038-byte Ogg Vorbis original.

The game selects short, isolated impacts from this recording at playback time,
avoiding destructive re-encoding while giving repeated misses some variation.

The following project-owner-provided recordings supply the foreground combat
audio. They are copied unchanged from `data/sounds/`; no external attribution
or licensing metadata was included with the supplied files.

- `bomb-explosion.mp3` — SHA-1 `45e77cdb1c6ee1e3b0af88ab64af3af2b873e7f7`
- `falling-bomb-whistle.mp3` — SHA-1 `7cde26458e84158cd556ab022fac88d91588b591`
- `ship-fire-rocket.mp3` — SHA-1 `f161fbb2c716e7a33af05c3277c562db7502bcc4`
- `ww2-sea-background.mp3` — SHA-1 `1d19ae76ebf5664e169a69514a0fbde5355396d7`
- `victory.mp3` — SHA-1 `0a1947c3f6c5ee6d3f79fa1ea3fd38ceb9da0897`
- `defeat.mp3` — SHA-1 `6cb4d63cba3627758304ca5094121d0e7f9e93ad`

The WWII sea recording loops at a deliberately quiet 7% gain after the
browser's first audio-enabling gesture. Combat recordings also use conservative
per-sample gain limits. The global Sound toggle stops and restarts the loop
along with muting or enabling every launch, whistle, impact, and fanfare.
The victory or defeat recording is selected after the final shell has landed;
the synthesized end cue remains available only if its recording cannot load.
