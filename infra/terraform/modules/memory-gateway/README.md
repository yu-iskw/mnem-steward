# Memory gateway Terraform skeleton

This module is a **Milestone 1 skeleton**. It does not yet provision Memory Bank, load balancers, Cloud Armor, or VPC Service Controls.

Required variables for a bootable revision: `auth_jwks_url`, `reasoning_engine_id`, plus the existing `project_id`, `image`, and `public_base_url`. `GOOGLE_CLOUD_LOCATION` defaults to `eu`.

Recommended production ingress remains `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER` as described in [RFC 0001](../../../../docs/rfc/0001-enterprise-agent-memory-platform.md).
