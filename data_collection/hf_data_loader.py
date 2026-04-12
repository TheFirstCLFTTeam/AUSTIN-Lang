import argparse
from utils.hf_data_loader import download_random_sample


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Download a random subset of a Hugging Face dataset."
    )
    parser.add_argument(
        "dataset",
        type=str,
        help="Hugging Face dataset card/name (e.g., 'imdb', 'rotten_tomatoes')",
    )
    parser.add_argument(
        "--split",
        type=str,
        default="train",
        help="Dataset split to sample from (default: train)",
    )
    parser.add_argument(
        "--num_samples",
        "-n",
        type=int,
        default=10,
        help="Number of random samples to download (default: 10)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for reproducibility. Set to -1 for truly random.",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default="sample.json",
        help="Output path to save the sample (supports .json, .csv, .parquet)",
    )

    args = parser.parse_args()

    seed = args.seed if args.seed != -1 else None
    sample = download_random_sample(args.dataset, args.split, args.num_samples, seed)

    # Print a quick preview of the first item
    print("\n--- Preview of the first sampled instance ---")
    print(sample[0])
    print("-------------------------------------------\n")

    # Save the sample to disk
    if args.output:
        print(f"Saving to {args.output}...")
        if args.output.endswith(".json"):
            sample.to_json(args.output)
        elif args.output.endswith(".csv"):
            sample.to_csv(args.output)
        elif args.output.endswith(".parquet"):
            sample.to_parquet(args.output)
        else:
            print(
                f"Unsupported file extension for output: {args.output}. Defaulting to .json format."
            )
            sample.to_json(f"{args.output}.json")
        print("Done!")
