import os
import torch
import gc
import soundfile as sf
import librosa
from dataclasses import dataclass
from typing import Any, Dict, List, Union
from datasets import load_dataset, Features, Value
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

# --- MONKEY PATCH FOR OLDER TORCH VERSIONS ---
if not hasattr(torch.nn.Module, "set_submodule"):
    def set_submodule(self, target: str, module: torch.nn.Module) -> None:
        parts = target.split(".")
        obj = self
        for i in range(len(parts) - 1):
            obj = getattr(obj, parts[i])
        setattr(obj, parts[-1], module)
    torch.nn.Module.set_submodule = set_submodule
    print("Applied monkey-patch for torch.nn.Module.set_submodule")
# ---------------------------------------------

# 1. Configuration
MODEL_ID = "openai/whisper-tiny"#os.getenv("MODEL_ID") 
ADAPTER_NAME = "fypaudio"#os.getenv("ADAPTER_NAME")
MANIFEST_PATH = os.path.join("data", f"{ADAPTER_NAME}_manifest.jsonl") #os.getenv("MANIFEST_PATH", "data/meralion_manifest.jsonl")
OUTPUT_DIR = os.path.join("adapters", ADAPTER_NAME) #os.getenv("OUTPUT_DIR", "adapters/meralion_v1")
BASE_ADAPTER_PATH = None #os.getenv("BASE_ADAPTER_PATH", None) 
EPOCHS = 50
BATCH_SIZE = 5
MAX_STEPS = EPOCHS * BATCH_SIZE

def train_one_round():
    # 0. Device Detection & Cleanup
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Detecting device: {device.upper()}")
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    # Define features explicitly - we keep audio_path as string to avoid torchcodec issues
    features = Features({
        "audio_path": Value("string"),
        "sentence": Value("string"),
    })

    # 2. Load Dataset (Streaming Mode saves massive RAM)
    print(f"Loading dataset in streaming mode from {MANIFEST_PATH}...")
    dataset = load_dataset(
        "json", 
        data_files=MANIFEST_PATH, 
        split="train", 
        streaming=True,
        features=features
    )
    
    processor = WhisperProcessor.from_pretrained(MODEL_ID)

    # 3. Data Collator
    @dataclass
    class DataCollatorSpeechSeq2SeqWithPadding:
        processor: Any
        def __call__(self, features: List[Dict[str, Any]]) -> Dict[str, torch.Tensor]:
            # Feature extraction is now done per-batch to save RAM
            input_features_list = []
            label_features_list = []

            for feature in features:
                # Normalize path for the current OS
                raw_path = feature["audio_path"].replace("\\", "/")
                path = os.path.normpath(raw_path)
                # path = os.path.normpath(feature["audio_path"])
                sentence = feature["sentence"]

                try:
                    # Load and resample manually to avoid datasets.Audio issues
                    array, sampling_rate = sf.read(path)
                    if sampling_rate != 16000:
                        array = librosa.resample(array, orig_sr=sampling_rate, target_sr=16000)

                    input_features = self.processor.feature_extractor(
                        array, sampling_rate=16000
                    ).input_features[0]
                    input_features_list.append({"input_features": input_features})

                    labels = self.processor.tokenizer(sentence).input_ids
                    label_features_list.append({"input_ids": labels})
                except Exception as e:
                    print(f"Error processing sample {path}: {e}")
                    continue

            if not input_features_list:
                return {}

            batch = self.processor.feature_extractor.pad(input_features_list, return_tensors="pt")
            labels_batch = self.processor.tokenizer.pad(label_features_list, return_tensors="pt")

            labels = labels_batch["input_ids"].masked_fill(labels_batch.attention_mask.ne(1), -100)
            batch["labels"] = labels
            return batch

    data_collator = DataCollatorSpeechSeq2SeqWithPadding(processor=processor)

    # 4. Load Model
    if device == "cuda":
        print(f"Loading model {MODEL_ID} in 4-bit for GPU...")
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.float16,
            bnb_4bit_use_double_quant=True,
        )
        model = WhisperForConditionalGeneration.from_pretrained(
            MODEL_ID, 
            quantization_config=bnb_config, 
            device_map="auto",
            low_cpu_mem_usage=True
        )
        model = prepare_model_for_kbit_training(model)
    else:
        print(f"Loading model {MODEL_ID} on CPU...")
        model = WhisperForConditionalGeneration.from_pretrained(
            MODEL_ID,
            device_map={"": "cpu"},
            low_cpu_mem_usage=True
        )

    model.config.forced_decoder_ids = None
    model.config.suppress_tokens = []

    # 5. PEFT (LoRA) Setup
    if BASE_ADAPTER_PATH and os.path.exists(BASE_ADAPTER_PATH) and BASE_ADAPTER_PATH != "None":
        print(f"Loading existing adapter from {BASE_ADAPTER_PATH}...")
        model = PeftModel.from_pretrained(model, BASE_ADAPTER_PATH, is_trainable=True)
    else:
        print("Initializing fresh LoRA adapters...")
        config = LoraConfig(
            r=8, 
            lora_alpha=16, 
            target_modules=["q_proj", "v_proj"], 
            lora_dropout=0.05, 
            bias="none"
        )
        model = get_peft_model(model, config)

    # 6. Training Arguments (Ultra-low RAM settings)
    training_args = Seq2SeqTrainingArguments(
        output_dir=OUTPUT_DIR,
        per_device_train_batch_size=BATCH_SIZE, 
        gradient_accumulation_steps=1, 
        learning_rate=1e-3,
        warmup_steps=5,
        max_steps=MAX_STEPS, 
        fp16=(device == "cuda"),
        optim="paged_adamw_8bit" if device == "cuda" else "adamw_torch",
        gradient_checkpointing=False, 
        eval_strategy="no",
        save_strategy="steps",
        save_steps=50,
        save_total_limit=1,
        logging_steps=10,
        report_to=["tensorboard"],
        remove_unused_columns=False,
        push_to_hub=False,
        label_names=["labels"],
        dataloader_num_workers=0,
        dataloader_pin_memory=False
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

    # 8. Save
    print(f"Saving LoRA adapters to {OUTPUT_DIR}...")
    model.save_pretrained(OUTPUT_DIR)
    processor.save_pretrained(OUTPUT_DIR)

if __name__ == "__main__":
    train_one_round()
