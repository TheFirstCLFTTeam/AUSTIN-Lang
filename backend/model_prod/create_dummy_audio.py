import wave
import struct

def create_dummy_wav(filename="test_audio.wav", duration=1.0, sample_rate=16000):
    num_samples = int(duration * sample_rate)
    with wave.open(filename, 'w') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 2 bytes per sample (16-bit PCM)
        wav_file.setframerate(sample_rate)
        # Generate silence
        data = struct.pack('<' + 'h' * num_samples, *[0] * num_samples)
        wav_file.writeframes(data)
    print(f"Created dummy audio file: {filename}")

if __name__ == "__main__":
    create_dummy_wav("backend/model_prod/test_audio.wav")
