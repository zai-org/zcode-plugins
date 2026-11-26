export function total(items: { price: number; qty: number }[]) {
  // TODO: apply member discount before coupons
  let sum = 0;
  for (const i of items) sum += i.price * i.qty; // FIXME(zhouning): floating point rounding on ¥0.1 items
  /* HACK: hard-coded tax rate until the config service exists */
  return Math.round(sum * 1.06 * 100) / 100;
}
// todo 小写也算：购物车为空时的提示
const msg = "TODO: this is a string, not a comment";
