# 20 Feb 2026 Meeting Minutes with Sponsor

- Showed them:
   	- The new frontend segmented transcript
   	- Working whisper model
- Meralion is very distorted / a lot of bg noise
- at least 2 min audio files
- Maybe can find a way to distinguish the 2 voices, so that info is not lost.
- 1. train the model on Meralion to fix the accent issues first; 2. then use the synth dataset to train for finance words
- Superconvergence: Finding the optimal learning rate
   	- using short training cycles to find the optimal learning rate, then use it to find the decay.
   	- Some paper by Leslie N. Smith
- Maybe use movie audio + scripts to train
- Use synth data (gen text > gen audio > add background noise (to mimic live audio) > train model)
- TLDR
   	- We're moving on to:
		- prep for week 8 mid term presentation
		- dataset generate/cleaning
		- re-train

Next step: Finalise end-to-end flow + Mid term presentation

1. Integrate Transcription to frontend & rest of back end
2. Prep
3. Search extensively on financial audio training datasets
	1. Right now we have Meralion (no financial terms) & Synthetic data (Havent created yet)
	2. See if can find any financial audio training dataset
