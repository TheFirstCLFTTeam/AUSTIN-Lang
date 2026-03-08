# Run AUSTIN-Lang Devcontainer in VS Code

This guide explains how to start the project's devcontainer from VS Code.

## Prerequisites

- Docker Desktop installed and running
- VS Code installed
- Dev Containers extension installed (`ms-vscode-remote.remote-containers`)

## Project Devcontainer Files

- `.devcontainer/devcontainer.json`
- `.devcontainer/Dockerfile`

Current setup highlights:

- Linux base image: Ubuntu 24.04
- Frontend and backend ports forwarded: 3000 and 8010
- Frontend dependencies installed on container creation with:
    - `cd frontend && npm install`

## Open the Project in the Devcontainer

1. Open the repository folder in VS Code.
2. Press `F1` (or `Ctrl+Shift+P`) to open Command Palette.
3. Run: `Dev Containers: Reopen in Container`.
4. Wait for build and container startup.

VS Code will use `.devcontainer/devcontainer.json` and build from `.devcontainer/Dockerfile`.

## Verify the Environment

After the container opens, run these in the VS Code terminal:

- `node -v`
- `npm -v`
- `python3 --version`

## Run the Frontend

From the repo root inside the container:

1. `cd frontend`
2. `npm start`

Then open the forwarded port 3000 when VS Code prompts you.

## (Optional) Run Backend Server

From the repo root inside the container:

1. `cd backend/server`
2. install deps if needed (example): `pip install -r configs/requirements.txt`
3. `python run.py --host 0.0.0.0 --port 8010`

Then access it from forwarded port 8010.

## Troubleshooting

- If Docker is not running, start Docker Desktop and reopen in container.
- If dependencies changed, run:
    - `cd frontend && npm install`
- To fully rebuild the image:
    - Command Palette -> `Dev Containers: Rebuild and Reopen in Container`
