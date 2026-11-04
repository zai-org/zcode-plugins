"""Config helpers for the sample app (pure helpers, no I/O)."""


def merge_defaults(cfg):
    base = {"name": "sample-app", "port": 8080}
    base.update(cfg or {})
    return base


def format_endpoint(cfg):
    return "%s:%s" % (cfg.get("name", "app"), cfg.get("port", 80))
