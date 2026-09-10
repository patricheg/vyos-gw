from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # VyOS HTTP API (service https api rest)
    vyos_api_url: str = "https://10.11.12.4"
    vyos_api_key: str = "11-future"
    vyos_api_verify_tls: bool = False  # lab uses self-signed cert
    vyos_api_timeout: int = 30
    # Legacy SSH access (kept for maintenance scripts)
    vyos_host: str = "10.11.12.4"
    vyos_username: str = "vyos"
    vyos_password: str = "11-future"
    vyos_port: int = 22
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    class Config:
        env_file = ".env"

settings = Settings()
