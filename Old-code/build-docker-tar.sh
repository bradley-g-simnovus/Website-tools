#!/bin/bash
# Build and export Docker image as a tar file
# This allows the Docker image to be distributed and loaded without needing to build locally

set -e

# Configuration
IMAGE_NAME="tools"
IMAGE_TAG="latest"
OUTPUT_DIR="./docker-builds"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
TAR_FILE="${OUTPUT_DIR}/tools-${TIMESTAMP}.tar.gz"

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

echo "🐳 Building image: $IMAGE_NAME:$IMAGE_TAG"
podman build -t "$IMAGE_NAME:$IMAGE_TAG" .

echo "💾 Exporting image to tar file..."
podman save "$IMAGE_NAME:$IMAGE_TAG" -o tools.tar
cp tools.tar "$TAR_FILE"

echo "✅ Done!"
echo "📦 tools.tar"
ls -lh tools.tar | awk '{print $5, $9}'
