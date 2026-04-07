#!/bin/bash
# Build and export Docker image as a tar file
# This allows the Docker image to be distributed and loaded without needing to build locally

set -e

# Configuration
IMAGE_NAME="calculator-band-info"
IMAGE_TAG="latest"
OUTPUT_DIR="./docker-builds"
TAR_FILE="${OUTPUT_DIR}/Calculator-Band-Info.tar.gz"

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

echo "🐳 Building image: $IMAGE_NAME:$IMAGE_TAG"

# Remove old image if it exists to avoid conflicts
if podman image exists "$IMAGE_NAME:$IMAGE_TAG" 2>/dev/null; then
  echo "Removing old image..."
  podman rmi "$IMAGE_NAME:$IMAGE_TAG" -f || true
fi

podman build -t "$IMAGE_NAME:$IMAGE_TAG" .

echo "💾 Exporting image to tar file..."
podman save "$IMAGE_NAME:$IMAGE_TAG" -o "$TAR_FILE"

echo "✅ Done!"
ls -lh "$TAR_FILE" | awk '{print $5, $9}'
