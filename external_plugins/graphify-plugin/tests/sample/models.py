"""Domain models."""

from utils import merge_defaults


class User:
    def __init__(self, name):
        self.name = name


class Order:
    def __init__(self, user):
        self.user = user
