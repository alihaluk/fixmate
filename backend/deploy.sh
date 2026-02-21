#!/bin/bash
set -e

# Load env variables
if [ -f .env ]; then
  export $(cat .env | xargs)
fi

PROJECT_ID="gen-lang-client-0376846443"
REGION="us-central1"
SERVICE_NAME="fixmate-backend"
IMAGE_TAG="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest"

echo "Submitting build to Google Cloud Build (no local Docker required)..."
gcloud builds submit --tag $IMAGE_TAG . --project $PROJECT_ID

echo "Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE_TAG \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars="GEMINI_API_KEY=${GEMINI_API_KEY}"

echo "Deployment complete!"
