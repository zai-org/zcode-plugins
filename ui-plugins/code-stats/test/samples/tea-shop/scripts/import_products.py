#!/usr/bin/env python3
"""从供应商表导入商品。

用法：python3 import_products.py products.csv
"""
import csv
import sys


def main(path):
    # 跳过空行
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if not row.get("sku"):
                continue
            print(row["sku"], row["name"])


if __name__ == "__main__":
    main(sys.argv[1])
