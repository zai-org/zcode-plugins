-- 茶铺小店数据库（MySQL）
CREATE TABLE `customers` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '客户编号',
  `name` VARCHAR(50) NOT NULL COMMENT '姓名',
  `phone` VARCHAR(20) UNIQUE COMMENT '手机号',
  `city` VARCHAR(30),
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='客户';

CREATE TABLE `products` (
  `sku` VARCHAR(32) PRIMARY KEY COMMENT '货号',
  `title` VARCHAR(100) NOT NULL COMMENT '品名',
  `price` DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '售价',
  `category_id` INT COMMENT '分类'
) COMMENT='商品';

CREATE TABLE `categories` (
  `id` INT PRIMARY KEY,
  `name` VARCHAR(50) NOT NULL
);

CREATE TABLE `orders` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `customer_id` BIGINT NOT NULL COMMENT '下单客户',
  `status` ENUM('paid','shipped','done') NOT NULL DEFAULT 'paid',
  `total` DECIMAL(10,2) NOT NULL,
  CONSTRAINT fk_order_customer FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
) COMMENT='订单';

CREATE TABLE `order_items` (
  `order_id` BIGINT NOT NULL REFERENCES orders(id),
  `sku` VARCHAR(32) NOT NULL,
  `qty` INT NOT NULL DEFAULT 1,
  `price` DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (`order_id`, `sku`)
) COMMENT='订单明细';

ALTER TABLE `order_items` ADD CONSTRAINT fk_item_sku FOREIGN KEY (`sku`) REFERENCES `products` (`sku`);
ALTER TABLE `orders` ADD FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`);
