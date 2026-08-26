terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0"
    }
  }
}

resource "google_service_account" "gateway" {
  account_id   = "memory-gateway"
  display_name = "Mnem Steward gateway"
}

resource "google_cloud_run_v2_service" "gateway" {
  name     = var.service_name
  location = var.location
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account = google_service_account.gateway.email
    containers {
      image = var.image
      env {
        name  = "AUTH_MODE"
        value = "jwks"
      }
      env {
        name  = "MEMORY_STORE"
        value = "google"
      }
      env {
        name  = "PUBLIC_BASE_URL"
        value = var.public_base_url
      }
      env {
        name  = "AUTH_JWKS_URL"
        value = var.auth_jwks_url
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = var.memory_bank_location
      }
      env {
        name  = "GOOGLE_REASONING_ENGINE_ID"
        value = var.reasoning_engine_id
      }
    }
  }
}

output "service_uri" {
  value = google_cloud_run_v2_service.gateway.uri
}
