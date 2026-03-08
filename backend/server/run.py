"""
Run script for the AUSTIN-Lang Transcription Server.
Usage: python run.py [--port PORT] [--model MODEL]
"""

import argparse
import os

import uvicorn




def main():
    parser = argparse.ArgumentParser(
        description="Run the AUSTIN-Lang Transcription Server"
    )
    parser.add_argument(
        "--host", default="0.0.0.0", help="Host to bind to (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("SERVER_PORT", 8003)),
        help="Port to bind to (default: 8003 or the SERVER_PORT environment variable)",
    )
    # should use port 8003
    parser.add_argument(
        "--model",
        default="base",
        choices=["tiny", "base", "small", "medium", "large", "large-v2", "large-v3"],
        help="Whisper model to use (default: base)",
    )
    parser.add_argument(
        "--reload", action="store_true", help="Enable hot reload for development"
    )
    parser.add_argument(
        "--workers", type=int, default=1, help="Number of worker processes"
    )

    args = parser.parse_args()

    # Set environment variable for the model
    os.environ["CURRENT_MODEL"] = args.model

    print(f"Starting server with Whisper model: {args.model}")
    print(f"Server will be available at: http://{args.host}:{args.port}")
    print(f"API docs available at: http://{args.host}:{args.port}/docs")

    uvicorn.run(
        "main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        workers=args.workers if not args.reload else 1,
    )


if __name__ == "__main__":
    main()
