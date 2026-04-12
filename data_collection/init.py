import os
from dotenv import load_dotenv
from huggingface_hub import login
from utils.hf_data_loader import download_random_sample

# Specify the Hugging Face dataset cards you want to download from
DATASET_CARDS = [
    "ziyou-li/cantonese_daily",
    "AlienKevin/wordshk_cantonese_speech",
    "alvanlii/cantonese-youtube",
    "AlienKevin/mixed_cantonese_and_english_speech",
    "edmundchan70/Cantonese_fine_tune",
    # "ag_news",
    # Add more dataset cards here
]
NUM_SAMPLES = 10


def main():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    base_output_dir = os.path.join(current_dir, "sampled_datasets")
    cache_root = os.path.join(base_output_dir, ".hf_cache")
    datasets_cache_dir = os.path.join(cache_root, "datasets")

    os.makedirs(base_output_dir, exist_ok=True)
    os.makedirs(datasets_cache_dir, exist_ok=True)

    # Force Hugging Face caches into this project folder instead of user-level cache.
    os.environ["HF_HOME"] = cache_root
    os.environ["HF_DATASETS_CACHE"] = datasets_cache_dir

    # Load environment variables from .env located in the same directory
    env_path = os.path.join(current_dir, ".env")
    if os.path.exists(env_path):
        load_dotenv(env_path)

    hf_token = os.getenv("HF_TOKEN")
    if hf_token:
        print("Logging into Hugging Face...")
        login(token=hf_token)
    else:
        print("Warning: No HF_TOKEN found in .env file.")

    for dataset_name in DATASET_CARDS:
        print("\n========================================")
        print(f"Processing dataset: {dataset_name}")
        print("========================================")

        try:
            # Call the function from your hf_data_loader script
            sample = download_random_sample(
                dataset_name=dataset_name,
                split="train",
                num_samples=NUM_SAMPLES,
                seed=42,
                cache_dir=datasets_cache_dir,
            )

            # Mirror the dataset card path, e.g. sampled_datasets/owner/dataset_name/
            dataset_path_parts = [part for part in dataset_name.split("/") if part]
            dataset_dir = os.path.join(base_output_dir, "-".join(dataset_path_parts))
            os.makedirs(dataset_dir, exist_ok=True)

            output_path = os.path.join(dataset_dir, "sample.json")

            print(f"Saving {dataset_name} sample to {output_path}...")
            sample.to_json(output_path)
            print("Success!")

        except Exception as e:
            print(f"Failed to process {dataset_name}. Error: {e}")


if __name__ == "__main__":
    main()
