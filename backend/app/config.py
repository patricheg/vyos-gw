from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # VyOS HTTP API (service https api rest). Defaults target the on-device
    # container (loopback); external/dev mode overrides via .env
    vyos_api_url: str = "https://127.0.0.1:8443"
    vyos_api_key: str = ""
    # On-device: the bootstrap writes the generated API key into this file,
    # mounted read-only into the container
    vyos_api_key_file: Optional[str] = "/config/auth/vyos-gw/api.key"
    vyos_api_verify_tls: bool = False  # lab uses self-signed cert
    vyos_api_timeout: int = 30
    # Legacy SSH access (kept for maintenance scripts)
    vyos_host: str = "127.0.0.1"
    vyos_username: str = "vyos"
    vyos_password: str = ""
    vyos_port: int = 22
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    # On-device mode: the app runs as a container on the VyOS router itself,
    # file access is local instead of SSH. Set via container env (Dockerfile).
    on_device: bool = Field(default=False, validation_alias="VGW_ON_DEVICE")
    data_dir: Optional[str] = Field(default=None, validation_alias="VGW_DATA_DIR")
    dist_dir: Optional[str] = Field(default=None, validation_alias="VGW_DIST_DIR")

    class Config:
        env_file = ".env"

settings = Settings()

if not settings.vyos_api_key and settings.vyos_api_key_file:
    try:
        with open(settings.vyos_api_key_file) as f:
            settings.vyos_api_key = f.read().strip()
    except OSError:
        pass
