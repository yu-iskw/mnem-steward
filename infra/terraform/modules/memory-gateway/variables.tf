variable "project_id" {
  type        = string
  description = "Google Cloud project for the memory gateway"
}

variable "location" {
  type        = string
  description = "Region or multi-region (eu or us). Do not use global for production memory."
  default     = "europe-west1"
}

variable "service_name" {
  type        = string
  default     = "mnem-steward-gateway"
}

variable "image" {
  type        = string
  description = "Container image for the gateway"
}

variable "public_base_url" {
  type = string
}

variable "auth_jwks_url" {
  type        = string
  description = "JWKS URL for AUTH_MODE=jwks"
}

variable "reasoning_engine_id" {
  type        = string
  description = "Vertex AI Agent Engine (reasoning engine) id for Memory Bank"
}

variable "memory_bank_location" {
  type        = string
  description = "Memory Bank location (eu, us, or a region). Distinct from the Cloud Run region."
  default     = "eu"
}
