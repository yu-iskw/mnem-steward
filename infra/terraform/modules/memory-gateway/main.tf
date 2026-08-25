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
  display_name = "Enterprise memory gateway"
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
    }
  }
}

output "service_uri" {
  value = google_cloud_run_v2_service.gateway.uri
}
