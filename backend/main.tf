terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

variable "project_id" {
  description = "The Google Cloud Project ID"
  type        = string
}

variable "region" {
  description = "The Google Cloud Region"
  type        = string
  default     = "us-central1"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs
resource "google_project_service" "cloudbuild" {
  service            = "cloudbuild.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "cloudrun" {
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

# We will build the image locally and push it, but for a pure 
# Terraform approach, Cloud Run expects an image to exist.
# Placeholder image used initially.
resource "google_cloud_run_v2_service" "fixmate_backend" {
  name     = "fixmate-backend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello" # Will be replaced by CI/CD
      ports {
        container_port = 8080
      }
      env {
        name  = "GEMINI_API_KEY"
        value = "placeholder - to be injected via Secret Manager or env vars"
      }
    }
  }

  depends_on = [
    google_project_service.cloudrun
  ]
}

# Allow full unauthenticated access to the Cloud Run service
resource "google_cloud_run_service_iam_member" "public" {
  location = google_cloud_run_v2_service.fixmate_backend.location
  project  = google_cloud_run_v2_service.fixmate_backend.project
  service  = google_cloud_run_v2_service.fixmate_backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "service_url" {
  value = google_cloud_run_v2_service.fixmate_backend.uri
}
