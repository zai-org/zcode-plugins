import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// src/role-registry.ts
function isRoleRegistration(value) {
  return value !== undefined && value.kind !== "workflow_lock" && typeof value.role === "string";
}
function isWorkflowLock(value) {
  return value?.kind === "workflow_lock";
}
function orphanedRegistrationKeys(registry, workflowId) {
  const locked = new Set(Object.values(registry).filter(isWorkflowLock).map((lock) => lock.workflow_id));
  const keys = [];
  for (const [key, value] of Object.entries(registry)) {
    if (!isRoleRegistration(value))
      continue;
    const orphaned = workflowId === undefined ? value.workflow_id !== null && !locked.has(value.workflow_id) : value.workflow_id === workflowId;
    if (orphaned)
      keys.push(key);
  }
  return keys;
}
export {
  orphanedRegistrationKeys,
  isWorkflowLock,
  isRoleRegistration
};
