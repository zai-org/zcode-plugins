"""Entry point of the sample app."""
import json
import os

from models import User
from utils import merge_defaults, format_endpoint


class App:
    def __init__(self, config):
        self.config = config

    def run(self):
        print("running with", self.config)


def main():
    cfg = merge_defaults({"name": "demo"})
    user = User("sara")
    app = App(cfg)
    print(format_endpoint(cfg))
    app.run()


if __name__ == "__main__":
    main()
