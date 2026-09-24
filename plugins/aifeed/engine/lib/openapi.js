'use strict';

const TYPE_MAP = { string: 'string', integer: 'integer', number: 'integer', boolean: 'boolean' };

function slug(value) {
  const cleaned = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return cleaned.replace(/^([0-9])/, 'op_$1').slice(0, 64) || 'operation';
}

function mapParam(name, schema, required, location, warnings, context) {
  const sourceType = schema && schema.type ? schema.type : 'string';
  const mapped = TYPE_MAP[sourceType];
  if (!mapped) {
    warnings.push(context + ': skipping parameter "' + name + '" with unsupported type "' + sourceType + '"');
    return null;
  }
  const param = { type: mapped, required: Boolean(required), in: location };
  if (sourceType === 'number') {
    warnings.push(context + ': parameter "' + name + '" mapped from number to integer (floats are not allowed)');
  }
  if (schema && schema.description) param.description = String(schema.description).slice(0, 200);
  if (schema && Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.length <= 100) {
    param.enum = schema.enum.slice(0, 100);
  }
  if (mapped === 'integer') {
    if (typeof schema.minimum === 'number' && Number.isInteger(schema.minimum)) param.minimum = schema.minimum;
    if (typeof schema.maximum === 'number' && Number.isInteger(schema.maximum)) param.maximum = schema.maximum;
  }
  if (mapped === 'string' && typeof schema.maxLength === 'number' && schema.maxLength > 0) {
    param.max_length = Math.min(schema.maxLength, 4096);
  }
  return param;
}

function returnsFor(operation, warnings, context) {
  const responses = operation.responses || {};
  const success = responses['200'] || responses['201'] || responses['2XX'];
  const schema = success && success.content && success.content['application/json'] && success.content['application/json'].schema;
  if (schema && schema.type === 'array') {
    return { type: 'array', description: 'See the API documentation for the item shape' };
  }
  if (schema && schema.type === 'object') {
    return { type: 'object', description: 'See the API documentation' };
  }
  warnings.push(context + ': no JSON success schema found; using object');
  return { type: 'object', description: 'See the API documentation' };
}

function convertOperation(path, method, operation, warnings, context) {
  const name = slug(operation.operationId || method + '_' + path);
  const params = {};
  const allParameters = Array.isArray(operation.parameters) ? operation.parameters : [];
  const bodyRequired = new Set();
  if (operation.requestBody && operation.requestBody.content && operation.requestBody.content['application/json']
      && operation.requestBody.content['application/json'].schema) {
    const bodySchema = operation.requestBody.content['application/json'].schema;
    if (Array.isArray(bodySchema.required)) {
      for (const key of bodySchema.required) bodyRequired.add(key);
    }
  }
  for (const parameter of allParameters) {
    const location = parameter.in;
    if (location === 'header' || location === 'cookie') {
      warnings.push(context + ': skipping "' + location + '" parameter "' + parameter.name + '" (query/path/body only)');
      continue;
    }
    const mapped = mapParam(
      parameter.name,
      parameter.schema || {},
      Boolean(parameter.required),
      location === 'body' ? 'body' : location,
      warnings,
      context
    );
    if (mapped) params[slug(parameter.name)] = mapped;
  }
  if (operation.requestBody && operation.requestBody.content && operation.requestBody.content['application/json']
      && operation.requestBody.content['application/json'].schema) {
    const bodySchema = operation.requestBody.content['application/json'].schema;
    const properties = bodySchema.properties || {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      const mapped = mapParam(key, propertySchema, bodyRequired.has(key), 'body', warnings, context);
      if (mapped) params[slug(key)] = mapped;
    }
  }

  const definition = {
    description: String(operation.summary || operation.description || name).slice(0, 500),
    endpoint: path,
    method: method.toUpperCase(),
    params,
    returns: returnsFor(operation, warnings, context),
    requires_auth: Array.isArray(operation.security) && operation.security.length > 0,
    human_confirmation_required: method.toUpperCase() !== 'GET'
  };
  const docsUrl = operation.externalDocs && operation.externalDocs.url;
  if (definition.requires_auth && typeof docsUrl === 'string' && docsUrl.startsWith('https://')) {
    definition.auth = { type: 'oauth2', documentation_url: docsUrl };
  }
  if (definition.requires_auth && !definition.auth) {
    warnings.push(context + ': security is declared but no https externalDocs URL was found; add the auth block manually');
  }
  if (method.toUpperCase() === 'GET') {
    const capability = { ...definition };
    delete capability.requires_auth;
    delete capability.human_confirmation_required;
    capability.auth_required = Array.isArray(operation.security) && operation.security.length > 0;
    return { kind: 'capabilities', name, value: capability };
  }
  return { kind: 'actions', name, value: definition };
}

function importOpenApi(specification) {
  const warnings = [];
  const capabilities = {};
  const actions = {};
  const paths = (specification && specification.paths) || {};
  let skipped = 0;

  for (const [route, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods || {})) {
      const normalized = String(method).toLowerCase();
      if (!['get', 'post', 'put', 'delete'].includes(normalized)) continue;
      if (!operation || typeof operation !== 'object') continue;
      const context = normalized.toUpperCase() + ' ' + route;
      const converted = convertOperation(route, normalized, operation, warnings, context);
      const target = converted.kind;
      if (Object.keys(target === 'capabilities' ? capabilities : actions).length >= 100) {
        skipped++;
        warnings.push(context + ': limit of 100 entries reached; skipped');
        continue;
      }
      if (target === 'capabilities' ? capabilities[converted.name] : actions[converted.name]) {
        warnings.push(context + ': duplicate operation id "' + converted.name + '"; skipped');
        continue;
      }
      if (converted.kind === 'capabilities') {
        capabilities[converted.name] = converted.value;
      } else {
        actions[converted.name] = converted.value;
      }
    }
  }

  return {
    fragment: { types: {}, capabilities, actions },
    stats: {
      capabilities: Object.keys(capabilities).length,
      actions: Object.keys(actions).length,
      warnings: warnings.length,
      skipped
    },
    warnings
  };
}

module.exports = { importOpenApi, slug, mapParam };
