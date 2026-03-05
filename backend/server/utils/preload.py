from huggingface_hub import snapshot_download
from dotenv import load_dotenv
import os

# Load .env from backend/
_env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
load_dotenv(dotenv_path=_env_path)

HF_TOKEN = os.environ.get("HF_TOKEN")
if not HF_TOKEN:
    raise ValueError(
        "HF_TOKEN not found. Make sure backend/.env exists and contains HF_TOKEN=..."
    )

# Models to download. snapshot_download mirrors the full repo, including
# custom config/modeling .py files required by models like MERaLiON-2.
model_ids = [
    "openai/whisper-base",
    "MERaLiON/MERaLiON-2-10B-ASR",
]

local_dir = os.path.join(os.path.dirname(__file__), "..", "pretrained_weights")

for model_id in model_ids:
    # Preserve org/model structure: pretrained_weights/openai/whisper-base/
    model_id_modded = model_id.replace("-", "_")  # Replace / with _ for local dir
    org, model_name = model_id_modded.split("/", 1)
    pretrain_dir = os.path.join(local_dir, org, model_name)

    if os.path.exists(pretrain_dir) and os.listdir(pretrain_dir):
        print(f"{pretrain_dir} already exists and is not empty. Skipping download.")
        continue

    os.makedirs(pretrain_dir, exist_ok=True)
    print(f"Downloading {model_id} to {pretrain_dir}...")
    snapshot_download(
        repo_id=model_id,
        local_dir=pretrain_dir,
        token=HF_TOKEN,
    )
    print(f"Downloaded {model_id} successfully.")

# Load locally (custom code files are present in the snapshot, so trust_remote_code works):
# from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
# processor = AutoProcessor.from_pretrained(pretrain_dir, trust_remote_code=True)
# model = AutoModelForSpeechSeq2Seq.from_pretrained(pretrain_dir, trust_remote_code=True)
