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

resource "google_service_account" "memory_bank" {
  count        = var.memory_bank_service_account_id == null ? 0 : 1
  account_id   = var.memory_bank_service_account_id
  display_name = "Mnem Steward Memory Bank executor"
}

locals {
  created_memory_bank_sa_email = (
    length(google_service_account.memory_bank) > 0
    ? google_service_account.memory_bank[0].email
    : null
  )
  memory_bank_sa_email = coalesce(local.created_memory_bank_sa_email, var.memory_bank_service_account_email)
  use_impersonate      = local.memory_bank_sa_email != null
}

resource "google_service_account_iam_member" "gateway_token_creator" {
  count              = local.use_impersonate ? 1 : 0
  service_account_id = "projects/${var.project_id}/serviceAccounts/${local.memory_bank_sa_email}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.gateway.email}"
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
      env {
        name  = "GOOGLE_CREDENTIAL_MODE"
        value = local.use_impersonate ? "impersonate" : "adc"
      }
      dynamic "env" {
        for_each = local.use_impersonate ? [local.memory_bank_sa_email] : []
        content {
          name  = "GOOGLE_IMPERSONATE_SERVICE_ACCOUNT"
          value = env.value
        }
      }
    }
  }
}

output "service_uri" {
  value = google_cloud_run_v2_service.gateway.uri
}

output "gateway_service_account_email" {
  value = google_service_account.gateway.email
}

output "memory_bank_service_account_email" {
  value = local.memory_bank_sa_email
}
