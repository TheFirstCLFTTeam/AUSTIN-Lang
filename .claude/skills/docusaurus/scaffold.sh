#!/bin/bash
#
# Docusaurus Project Scaffolding Script
# Usage: bash scaffold.sh <project-name> [typescript]
#

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if project name is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: Project name is required${NC}"
    echo "Usage: bash scaffold.sh <project-name> [typescript]"
    echo ""
    echo "Examples:"
    echo "  bash scaffold.sh my-docs-site"
    echo "  bash scaffold.sh my-docs-site typescript"
    exit 1
fi

PROJECT_NAME="$1"
USE_TYPESCRIPT="$2"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js 18.0 or higher"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${YELLOW}Warning: Node.js version is $NODE_VERSION, but 18+ is recommended${NC}"
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed${NC}"
    exit 1
fi

# Check if directory already exists
if [ -d "$PROJECT_NAME" ]; then
    echo -e "${RED}Error: Directory '$PROJECT_NAME' already exists${NC}"
    exit 1
fi

echo -e "${BLUE}=== Creating Docusaurus Project ===${NC}"
echo -e "${BLUE}Project name: ${GREEN}$PROJECT_NAME${NC}"

# Build the npx command
NPX_CMD="npx create-docusaurus@latest $PROJECT_NAME classic"

if [ "$USE_TYPESCRIPT" = "typescript" ]; then
    NPX_CMD="$NPX_CMD --typescript"
    echo -e "${BLUE}TypeScript: ${GREEN}enabled${NC}"
else
    echo -e "${BLUE}TypeScript: ${YELLOW}disabled${NC}"
fi

echo ""
echo -e "${BLUE}Running: ${NC}$NPX_CMD"
echo ""

# Execute the command
$NPX_CMD

# Check if creation was successful
if [ ! -d "$PROJECT_NAME" ]; then
    echo -e "${RED}Error: Project creation failed${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✓ Project created successfully!${NC}"
echo ""

# Show project structure
echo -e "${BLUE}=== Project Structure ===${NC}"
if command -v tree &> /dev/null; then
    tree -L 2 "$PROJECT_NAME"
else
    ls -la "$PROJECT_NAME"
fi

echo ""
echo -e "${GREEN}=== Next Steps ===${NC}"
echo -e "1. Navigate to your project:"
echo -e "   ${BLUE}cd $PROJECT_NAME${NC}"
echo ""
echo -e "2. Start the development server:"
echo -e "   ${BLUE}npm start${NC}"
echo -e "   or"
echo -e "   ${BLUE}bash .claude/skills/docusaurus/start-dev.sh $PROJECT_NAME${NC}"
echo ""
echo -e "3. Open your browser:"
echo -e "   ${BLUE}http://localhost:3000${NC}"
echo ""
echo -e "${GREEN}Happy documenting! 📚${NC}"
