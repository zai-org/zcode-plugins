import csv
from collections import Counter


def top_products(path: str, n: int = 5) -> list[tuple[str, int]]:
    """统计销量最高的商品"""
    counts = Counter()
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            counts[row["sku"]] += int(row["qty"])
    return counts.most_common(n)


if __name__ == "__main__":
    for sku, qty in top_products("orders.csv"):
        print(f"{sku:<10} {qty:>5}")
