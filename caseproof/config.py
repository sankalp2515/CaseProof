from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    runtime_backend: Literal["local", "google"] = "local"
    app_environment: Literal["demo", "evaluation", "production"] = "demo"
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore", populate_by_name=True)
    allow_fallback: bool = False
    llm_provider: str = "gemini"
    llm_mode: str = "live"
    gemini_api_key: SecretStr = Field(
        default="",
        validation_alias=AliasChoices("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY"),
    )
    groq_api_key: SecretStr = SecretStr("")
    nvidia_api_key: SecretStr = SecretStr("")
    gemini_model: str = ""
    google_cloud_project: str = ""
    google_cloud_location: str = "global"
    gemini_model_summary: str = ""
    groq_model: str = ""
    nvidia_model: str = ""
    llm_max_calls_per_case: int = 8
    llm_daily_call_cap: int = 500
    data_dir: Path = ROOT / "var"
    sqlite_url: str = "sqlite:///" + (ROOT / "var/caseproof.db").as_posix()
    duckdb_path: str = str(ROOT / "var/bank.duckdb")
    object_dir: Path = ROOT / "var/objects"
    storage_backend: str = "local"
    gcs_bucket: str = ""
    ocr_provider: Literal["llm", "documentai"] = "llm"
    documentai_location: str = "asia-south1"
    documentai_processor_id: str = ""
    documentai_processor_version: str = ""
    documentai_min_confidence: float = Field(default=0.8, ge=0, le=1)
    mock_services_url: str = "http://127.0.0.1:8765"
    policy_path: Path = ROOT / "policy/demo_policy_v2.json"
    eval_kit_v1: Path = ROOT / "eval_kit_v1"
    eval_kit_v2: Path = ROOT / "var/kit_v2"
    trail_feed_path: Path = ROOT / "var/kit_v3/trail_feed.json"
    eval_kit_v3: Path = ROOT / "var/kit_v3"
    demo_mode: bool = True
    agentic_investigate: bool = False
    local_ocr_url: str = "http://127.0.0.1:8770"
    trail_feed_url: str = ""
    local_service_hosts: list[str] = []
    external_worker: bool = False
    customer_portal: bool = False
    preloaded_demo: bool = False
    # Practice worlds the local worker keeps pre-built; 0 builds every session on demand.
    practice_pool_size: int = 3
    public_base_url: str = "http://127.0.0.1:8000"
    job_lease_seconds: int = 90
    firestore_namespace: str = ""
    bigquery_dataset: str = "caseproof_bank"
    bigquery_maximum_bytes: int = Field(default=100_000_000, ge=10_000_000, le=100_000_000)
    cloud_tasks_queue: str = "caseproof-processing"
    cloud_worker_url: str = ""
    cloud_tasks_account: str = ""
    cloud_scheduler_account: str = ""
    cloud_staff_audience: str = ""
    cloud_staff_principals: dict[str, dict[str, str]] = Field(default_factory=dict)
    # Synthetic demo only: analyst/reviewer personas without sign-in, confined to the
    # caller's own practice-session tenant. Never the shared or a configured tenant.
    cloud_practice_personas: bool = False
    cloud_practice_daily_limit: int = Field(default=50, ge=1, le=200)
    cloud_simulator_url: str = ""
    cloud_scanner_url: str = ""
    gcs_quarantine_bucket: str = ""
    llm_max_output_tokens: int = Field(default=4096, ge=256, le=8192)
    llm_max_input_chars: int = Field(default=60000, ge=1000, le=100000)
    cloud_max_cases: int = Field(default=500, ge=1, le=5000)  # complaints per UTC day

    @model_validator(mode="after")
    def production_boundary(self):
        if self.runtime_backend == "google" and (
            self.storage_backend != "gcs"
            or self.llm_provider != "vertex"
            or self.llm_mode != "live"
            or self.ocr_provider != "documentai"
            or self.allow_fallback
            or not self.external_worker
            or not self.firestore_namespace
            or not self.google_cloud_project
            or not self.gemini_model
            or not self.gcs_bucket
            or not self.gcs_quarantine_bucket
            or not self.documentai_processor_id
            or not self.documentai_processor_version
            or not self.cloud_worker_url
            or not self.cloud_tasks_account
            or not self.cloud_scanner_url
            or not self.cloud_simulator_url
        ):
            raise ValueError(
                "Google runtime requires explicit durable/AI/scan/task configuration; no local fallback"
            )
        if self.app_environment == "production":
            raise ValueError(
                "Production identity, bank and outbound adapters are not configured. "
                "Synthetic/local services cannot run as production."
            )
        return self

    @property
    def effective_mode(self):
        if self.llm_provider == "local":
            return "local"
        return "mock" if self.llm_mode == "mock" or self.llm_provider == "mock" else self.llm_mode
