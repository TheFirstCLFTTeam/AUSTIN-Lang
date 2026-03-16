import os
import torch
import io
import librosa
import soundfile as sf
from dataclasses import dataclass
from typing import Any, Dict, List, Union
from datasets import load_dataset, Audio
from transformers import (
    WhisperProcessor, 
    WhisperForConditionalGeneration, 
    Seq2SeqTrainingArguments, 
    Seq2SeqTrainer,
    BitsAndBytesConfig
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training, PeftModel
from dotenv import load_dotenv

load_dotenv()

# 1. Configuration
MODEL_ID = os.getenv("MODEL_ID", "openai/whisper-large-v3-turbo")
MANIFEST_PATH = os.getenv("MANIFEST_PATH", "data/manifest.jsonl")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "adapters/meralion_v1")
BASE_ADAPTER_PATH = os.getenv("BASE_ADAPTER_PATH", None) 

def train_one_round():
    # 2. Load Dataset
    print(f"Loading dataset from {MANIFEST_PATH}...")
    dataset = load_dataset("json", data_files=MANIFEST_PATH, split="train")
    # Disable automatic decoding to avoid torchcodec issues
    dataset = dataset.cast_column("audio_path", Audio(decode=False))

    processor = WhisperProcessor.from_pretrained(MODEL_ID)

    def prepare_dataset(batch):
        audio_item = batch["audio_path"]
        
        # If it's a dict with 'bytes', use them. If it's a string path, read it.
        if isinstance(audio_item, dict) and audio_item.get("bytes"):
            audio_bytes = audio_item["bytes"]
            with io.BytesIO(audio_bytes) as b:
                array, sampling_rate = sf.read(b)
        elif isinstance(audio_item, str):
            array, sampling_rate = sf.read(audio_item)
        else:
            # Fallback for other datasets-specific structures
            path = audio_item.get("path") if isinstance(audio_item, dict) else audio_item
            array, sampling_rate = sf.read(path)
            
        # Ensure 16kHz
        if sampling_rate != 16000:
            array = librosa.resample(array, orig_sr=sampling_rate, target_sr=16000)
            
        batch["input_features"] = processor.feature_extractor(
            array, sampling_rate=16000
        ).input_features[0]
        
        # Process labels
        batch["labels"] = processor.tokenizer(batch["sentence"]).input_ids
        return batch

    print("Preprocessing dataset...")
    dataset = dataset.map(prepare_dataset, remove_columns=dataset.column_names)

    # 3. Data Collator
    @dataclass
    class DataCollatorSpeechSeq2SeqWithPadding:
        processor: Any
        def __call__(self, features: List[Dict[str, Union[List[int], torch.Tensor]]]) -> Dict[str, torch.Tensor]:
            input_features = [{"input_features": feature["input_features"]} for feature in features]
            batch = self.processor.feature_extractor.pad(input_features, return_tensors="pt")
            
            label_features = [{"input_ids": feature["labels"]} for feature in features]
            labels_batch = self.processor.tokenizer.pad(label_features, return_tensors="pt")
            
            labels = labels_batch["input_ids"].masked_fill(labels_batch.attention_mask.ne(1), -100)
            batch["labels"] = labels
            return batch

    data_collator = DataCollatorSpeechSeq2SeqWithPadding(processor=processor)
    # 4. Load Model with 8-bit Quantization
    print(f"Loading model {MODEL_ID} in 8-bit...")
    bnb_config = BitsAndBytesConfig(load_in_8bit=True)
    model = WhisperForConditionalGeneration.from_pretrained(
        MODEL_ID, 
        quantization_config=bnb_config, 
        device_map="auto"
    )

    # Official HF Fix: Clear decoder IDs to allow auto-detection of task/language
    model.config.forced_decoder_ids = None
    model.config.suppress_tokens = []

    # 5. Prepare for PEFT (LoRA)
    model = prepare_model_for_kbit_training(model)

    if BASE_ADAPTER_PATH and os.path.exists(BASE_ADAPTER_PATH):
        print(f"Loading existing adapter from {BASE_ADAPTER_PATH} for incremental training...")
        model = PeftModel.from_pretrained(model, BASE_ADAPTER_PATH, is_trainable=True)
    else:
        print("Initializing fresh LoRA adapters...")
        config = LoraConfig(
            r=32, 
            lora_alpha=64, 
            target_modules=["q_proj", "v_proj"], 
            lora_dropout=0.05, 
            bias="none"
        )
        model = get_peft_model(model, config)

    model.print_trainable_parameters()

    # 6. Training Arguments
    training_args = Seq2SeqTrainingArguments(
        output_dir=OUTPUT_DIR,
        per_device_train_batch_size=8,
        gradient_accumulation_steps=1,
        learning_rate=1e-3,
        warmup_steps=5,
        max_steps=50, 
        fp16=True,
        gradient_checkpointing=True, # Recommended for Whisper v3 stability
        eval_strategy="no",
        save_strategy="steps",
        save_steps=50,
        logging_steps=10,
        report_to=["tensorboard"],
        remove_unused_columns=False,
        push_to_hub=False,
        label_names=["labels"],
    )

    # 7. Start Training
    print("Starting fine-tuning...")
    trainer = Seq2SeqTrainer(
        args=training_args,
        model=model,
        train_dataset=dataset,
        data_collator=data_collator,
        processing_class=processor.feature_extractor,
    )

    model.config.use_cache = False
    trainer.train()

    # 8. Save the adapters
    print(f"Saving LoRA adapters to {OUTPUT_DIR}...")
    model.save_pretrained(OUTPUT_DIR)
    processor.save_pretrained(OUTPUT_DIR)

if __name__ == "__main__":
    train_one_round()
