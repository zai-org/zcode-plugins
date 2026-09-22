'use strict';

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  if (typeof value === 'number') return 'number';
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

function resolvePointer(root, pointer) {
  const parts = pointer.split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = root;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

function validate(value, schema, options = {}) {
  const errors = [];
  const root = options.root || schema;
  walk(value, schema, '$', errors, { ...options, root });
  return errors;
}

function push(errors, path, keyword, message) {
  errors.push({ path, keyword, message });
}

function walk(value, schema, path, errors, options) {
  if (!schema || typeof schema !== 'object') return;

  if (schema.$ref && schema.$ref.startsWith('#/')) {
    const target = resolvePointer(options.root, schema.$ref.slice(2));
    if (!target) {
      push(errors, path, '$ref', 'unresolvable reference: ' + schema.$ref);
      return;
    }
    walk(value, target, path, errors, options);
    return;
  }

  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    push(errors, path, 'const', 'must equal ' + JSON.stringify(schema.const));
    return;
  }

  if (schema.enum && !schema.enum.some((candidate) => deepEqual(value, candidate))) {
    push(errors, path, 'enum', 'must be one of ' + JSON.stringify(schema.enum));
    return;
  }

  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => validate(value, candidate, options).length === 0);
    if (matches.length !== 1) {
      push(errors, path, 'oneOf', 'must match exactly one subschema');
      return;
    }
  }

  if (schema.type && !matchesType(value, schema.type)) {
    push(errors, path, 'type', 'must be of type ' + schema.type);
    return;
  }

  const actual = typeOf(value);

  if (actual === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) {
      push(errors, path, 'minLength', 'minimum length is ' + schema.minLength);
    }
    if (schema.maxLength !== undefined && length > schema.maxLength) {
      push(errors, path, 'maxLength', 'maximum length is ' + schema.maxLength);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      push(errors, path, 'pattern', 'must match ' + schema.pattern);
    }
  }

  if (actual === 'number' || actual === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      push(errors, path, 'minimum', 'must be >= ' + schema.minimum);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      push(errors, path, 'maximum', 'must be <= ' + schema.maximum);
    }
  }

  if (actual === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      push(errors, path, 'minItems', 'minimum items is ' + schema.minItems);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      push(errors, path, 'maxItems', 'maximum items is ' + schema.maxItems);
    }
    if (schema.items) {
      value.forEach((item, index) => walk(item, schema.items, path + '[' + index + ']', errors, options));
    }
  }

  if (actual === 'object') {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      push(errors, path, 'minProperties', 'minimum properties is ' + schema.minProperties);
    }
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
      push(errors, path, 'maxProperties', 'maximum properties is ' + schema.maxProperties);
    }
    if (schema.required) {
      for (const name of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, name)) {
          push(errors, path, 'required', 'missing required property: ' + name);
        }
      }
    }
    const properties = schema.properties || {};
    const patternProperties = schema.patternProperties || {};
    const patternMatchers = Object.keys(patternProperties).map((pattern) => ({
      pattern,
      regex: new RegExp(pattern),
      schema: patternProperties[pattern]
    }));
    for (const key of keys) {
      const childPath = path + '.' + key;
      let matched = false;
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        walk(value[key], properties[key], childPath, errors, options);
        matched = true;
      }
      for (const matcher of patternMatchers) {
        if (matcher.regex.test(key)) {
          walk(value[key], matcher.schema, childPath, errors, options);
          matched = true;
        }
      }
      if (!matched) {
        if (schema.additionalProperties === false) {
          push(errors, childPath, 'additionalProperties', 'unknown property: ' + key);
        } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          walk(value[key], schema.additionalProperties, childPath, errors, options);
        }
      }
    }
  }
}

module.exports = { validate, typeOf, deepEqual };
