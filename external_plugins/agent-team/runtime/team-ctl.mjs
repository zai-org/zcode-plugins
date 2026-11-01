var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/cli/main.ts
import fs13 from "node:fs";
import path14 from "node:path";
import { pathToFileURL } from "node:url";

// src/coord/replay.ts
import fs from "node:fs";
import path from "node:path";

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t2 = typeof data;
  switch (t2) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path: path15, errorMaps, issueData } = params;
  const fullPath = [...path15, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path15, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path15;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: (arg) => ZodString.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate.create({ ...arg, coerce: true })
};
var NEVER = INVALID;

// src/domain/errors.ts
var TeamError = class extends Error {
  code;
  constructor(code, message, options) {
    super(message, options);
    this.name = "TeamError";
    this.code = code;
  }
  toJSON() {
    return serializeTeamError(this);
  }
};
function serializeTeamError(err) {
  const out = { name: "TeamError", code: err.code, message: err.message };
  const seen = new WeakSet([err]);
  const cause = err.cause;
  if (cause !== void 0 && cause !== null) out.cause = serializeCause(cause, seen);
  return out;
}
function serializeCause(cause, seen) {
  if (!(cause instanceof Error)) return { message: String(cause) };
  if (seen.has(cause)) return { name: cause.name, message: "[circular cause]" };
  seen.add(cause);
  if (cause instanceof TeamError) {
    const serialized = {
      name: "TeamError",
      code: cause.code,
      message: cause.message
    };
    const inner2 = cause.cause;
    if (inner2 !== void 0 && inner2 !== null) serialized.cause = serializeCause(inner2, seen);
    return serialized;
  }
  const plain = { name: cause.name, message: cause.message };
  const inner = cause.cause;
  if (inner !== void 0 && inner !== null) plain.cause = serializeCause(inner, seen);
  return plain;
}

// src/domain/events.ts
var IMAGE_MEDIA_TYPES = ["png", "jpeg", "webp", "gif"];
function validateContentBlock(block) {
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    throw new Error("content block must be a JSON object");
  }
  const b = block;
  switch (b.type) {
    case "text":
    case "reasoning":
      if (typeof b.text !== "string") throw new Error(`${String(b.type)} block requires string text`);
      return block;
    case "image": {
      const a = b.attachment;
      if (typeof a !== "object" || a === null || Array.isArray(a)) {
        throw new Error("image block requires object attachment");
      }
      const att = a;
      if (typeof att.attachmentId !== "string") throw new Error("image attachment requires string attachmentId");
      if (typeof att.mediaType !== "string" || !IMAGE_MEDIA_TYPES.includes(att.mediaType)) {
        throw new Error(`image attachment mediaType must be one of ${IMAGE_MEDIA_TYPES.join("/")}`);
      }
      if (typeof att.bytes !== "number") throw new Error("image attachment requires number bytes");
      if (typeof att.width !== "number") throw new Error("image attachment requires number width");
      if (typeof att.height !== "number") throw new Error("image attachment requires number height");
      if (att.name !== void 0 && typeof att.name !== "string") {
        throw new Error("image attachment name must be a string when present");
      }
      return block;
    }
    case "tool-call": {
      if (typeof b.id !== "string") throw new Error("tool-call block requires string id");
      if (typeof b.name !== "string") throw new Error("tool-call block requires string name");
      if (!("arguments" in b)) throw new Error("tool-call block requires arguments");
      return block;
    }
    case "tool-result":
      throw new Error("retired tool-result wrapper is not accepted as Team message content");
    default:
      return block;
  }
}
var contentBlocksSchema = external_exports.array(external_exports.unknown()).superRefine((blocks, ctx) => {
  for (let i = 0; i < blocks.length; i++) {
    try {
      validateContentBlock(blocks[i]);
    } catch (err) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: [i],
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }
});
var TASK_ID_PATTERN = /^task-(\d+)$/;
function isLooseIdValid(id) {
  if (id.length === 0) return false;
  const m = id.match(TASK_ID_PATTERN);
  if (m && !Number.isSafeInteger(Number(m[1]))) return false;
  return true;
}
function taskNumberFromId(id) {
  const m = id.match(TASK_ID_PATTERN);
  return m ? Number(m[1]) : void 0;
}
var looseIdSchema = external_exports.string().refine(isLooseIdValid, { message: "invalid loose id" });
var memberSnapshotSchema = external_exports.strictObject({
  id: external_exports.string(),
  name: external_exports.string(),
  description: external_exports.string(),
  provider: external_exports.string(),
  context: external_exports.enum(["fresh", "fork"]),
  phase: external_exports.enum(["provisioning", "active", "failed"]),
  error: external_exports.string().optional()
});
var taskSnapshotSchema = external_exports.strictObject({
  id: looseIdSchema,
  revision: external_exports.number().refine((n) => Number.isSafeInteger(n) && n >= 1, {
    message: "revision must be a positive safe integer"
  }),
  subject: external_exports.string(),
  description: external_exports.string(),
  status: external_exports.enum(["pending", "in_progress", "completed", "deleted"]),
  ownerId: external_exports.string().optional(),
  blockedBy: external_exports.array(external_exports.string()),
  writeScopes: external_exports.array(external_exports.string())
});
var messageSnapshotSchema = external_exports.strictObject({
  id: looseIdSchema,
  senderId: external_exports.string(),
  senderName: external_exports.string(),
  targetId: external_exports.string(),
  content: contentBlocksSchema
});
var TEAM_EVENT_VERSION = 2;
var TEAM_EVENT_TYPES = [
  "team/member",
  "team/task",
  "team/message/queued",
  "team/message/delivered"
];
var memberEventSchema = external_exports.strictObject({
  type: external_exports.literal("team/member"),
  version: external_exports.literal(TEAM_EVENT_VERSION),
  teamId: external_exports.string(),
  member: memberSnapshotSchema
});
var taskEventSchema = external_exports.strictObject({
  type: external_exports.literal("team/task"),
  version: external_exports.literal(TEAM_EVENT_VERSION),
  teamId: external_exports.string(),
  task: taskSnapshotSchema
});
var messageQueuedEventSchema = external_exports.strictObject({
  type: external_exports.literal("team/message/queued"),
  version: external_exports.literal(TEAM_EVENT_VERSION),
  teamId: external_exports.string(),
  message: messageSnapshotSchema
});
var messageDeliveredEventSchema = external_exports.strictObject({
  type: external_exports.literal("team/message/delivered"),
  version: external_exports.literal(TEAM_EVENT_VERSION),
  teamId: external_exports.string(),
  messageId: external_exports.string(),
  targetId: external_exports.string()
});
var TEAM_EVENT_SCHEMAS = {
  "team/member": memberEventSchema,
  "team/task": taskEventSchema,
  "team/message/queued": messageQueuedEventSchema,
  "team/message/delivered": messageDeliveredEventSchema
};
var LEGACY_EVENT_TYPE_ALIASES = {
  "team/message": "team/message/queued"
};
function selectTeamEvent(raw, teamId) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { kind: "ignored" };
  const candidate = raw;
  const rawType = candidate.type;
  if (typeof rawType !== "string") return { kind: "ignored" };
  const eventType = TEAM_EVENT_TYPES.includes(rawType) ? rawType : LEGACY_EVENT_TYPE_ALIASES[rawType];
  if (eventType === void 0) return { kind: "ignored" };
  if (typeof candidate.teamId !== "string" || candidate.teamId !== teamId) {
    return { kind: "ignored" };
  }
  if (candidate.version !== TEAM_EVENT_VERSION) {
    return { kind: "unsupported-version", version: candidate.version };
  }
  const normalized = rawType === eventType ? raw : { ...candidate, type: eventType };
  const parsed = TEAM_EVENT_SCHEMAS[eventType].safeParse(normalized);
  if (!parsed.success) return { kind: "invalid-payload", type: eventType };
  return { kind: "event", event: parsed.data };
}
var deliveredIdsSchema = external_exports.preprocess((value) => {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (typeof item === "string") return item;
    if (typeof item === "object" && item !== null && typeof item.messageId === "string") {
      return item.messageId;
    }
    return item;
  });
}, external_exports.array(external_exports.string()));
var teamStateSchema = external_exports.strictObject({
  id: external_exports.string(),
  members: external_exports.array(memberSnapshotSchema),
  tasks: external_exports.array(taskSnapshotSchema),
  messages: external_exports.array(messageSnapshotSchema),
  delivered: deliveredIdsSchema,
  nextTaskNumber: external_exports.number().refine((n) => Number.isSafeInteger(n) && n >= 1, {
    message: "nextTaskNumber must be a positive safe integer"
  }),
  failure: external_exports.string().optional()
});

// src/domain/task-graph.ts
function validateTaskGraph(tasks) {
  const byId = new Map(tasks.map((t2) => [t2.id, t2]));
  const live = tasks.filter((t2) => t2.status !== "deleted");
  for (const task of live) {
    for (const bid of task.blockedBy) {
      if (bid === task.id) {
        throw new Error(`team task "${task.id}" cannot block itself`);
      }
    }
  }
  for (const task of live) {
    const seen = /* @__PURE__ */ new Set();
    for (const bid of task.blockedBy) {
      if (seen.has(bid)) {
        throw new Error(`team task "${task.id}" repeats blocker "${bid}"`);
      }
      seen.add(bid);
    }
  }
  for (const task of live) {
    for (const bid of task.blockedBy) {
      const blocker = byId.get(bid);
      if (blocker === void 0 || blocker.status === "deleted") {
        throw new Error(`blocker task "${bid}" for "${task.id}" is missing or deleted`);
      }
    }
  }
  detectCycle(live, byId);
}
function detectCycle(live, byId) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = /* @__PURE__ */ new Map();
  const visit = (task) => {
    color.set(task.id, GRAY);
    for (const bid of task.blockedBy) {
      const blocker = byId.get(bid);
      if (blocker === void 0 || blocker.status === "deleted") continue;
      const c = color.get(bid) ?? WHITE;
      if (c === GRAY) {
        throw new Error(`task dependency cycle includes "${bid}"`);
      }
      if (c === WHITE) visit(blocker);
    }
    color.set(task.id, BLACK);
  };
  for (const task of live) {
    if ((color.get(task.id) ?? WHITE) === WHITE) visit(task);
  }
}

// src/domain/task-view.ts
function taskReady(state, task) {
  return task.blockedBy.every((bid) => {
    const blocker = state.tasks.find((t2) => t2.id === bid);
    return blocker !== void 0 && blocker.status === "completed";
  });
}
function projectTaskView(state, task) {
  const view = {
    id: task.id,
    revision: task.revision,
    subject: task.subject,
    description: task.description,
    status: task.status,
    blockedBy: [...task.blockedBy],
    writeScopes: [...task.writeScopes],
    ready: task.status === "pending" && taskReady(state, task),
    writeScopeWarnings: writeScopeWarnings(state, task)
  };
  if (task.ownerId !== void 0) {
    const ownerName = task.ownerId === state.id ? "lead" : state.members.find((m) => m.id === task.ownerId)?.name;
    if (ownerName !== void 0) view.ownerName = ownerName;
  }
  return view;
}
function writeScopeWarnings(state, task) {
  if (task.status !== "in_progress") return [];
  const warnings = /* @__PURE__ */ new Set();
  for (const other of state.tasks) {
    if (other.id === task.id || other.status !== "in_progress") continue;
    if (scopesOverlap(task.writeScopes, other.writeScopes)) {
      warnings.add(`write scopes overlap with ${other.id}`);
    }
  }
  return [...warnings];
}
function scopesOverlap(left, right) {
  for (const l of left) {
    for (const r of right) {
      if (l === r || l.startsWith(r + "/") || r.startsWith(l + "/")) return true;
    }
  }
  return false;
}

// src/domain/projection.ts
var TEAM_PROJECTION_STATE_VERSION = 4;
function emptyTeamState(rootId) {
  return {
    id: rootId,
    members: [],
    tasks: [],
    messages: [],
    delivered: [],
    nextTaskNumber: 1
  };
}
function failed(state, failure) {
  return { ...state, failure };
}
function applyProjectionEvent(state, raw) {
  if (state.failure !== void 0) return state;
  const selected = selectTeamEvent(raw, state.id);
  switch (selected.kind) {
    case "ignored":
      return state;
    case "unsupported-version":
      return failed(state, `unsupported Agent Teams event version ${String(selected.version)}`);
    case "invalid-payload":
      return failed(state, `persisted Agent Teams ${selected.type} payload is invalid`);
    case "event":
      return applyCurrentTeamEvent(state, selected.event);
  }
}
function applyCurrentTeamEvent(state, event) {
  if (state.failure !== void 0) return state;
  switch (event.type) {
    case "team/member":
      return applyMember(state, event.member);
    case "team/task":
      return applyTask(state, event.task);
    case "team/message/queued":
      return applyMessageQueued(state, event.message);
    case "team/message/delivered":
      return applyMessageDelivered(state, event.messageId, event.targetId);
  }
}
function applyMember(state, member) {
  const prior = state.members.find((m) => m.id === member.id);
  if (prior === void 0) {
    if (member.phase !== "provisioning") {
      return failed(state, `teammate "${member.name}" must begin provisioning`);
    }
    if (state.members.some((m) => m.name === member.name)) {
      return failed(state, `teammate name "${member.name}" is reused by another member`);
    }
    return { ...state, members: [...state.members, member] };
  }
  if (prior.name !== member.name || prior.provider !== member.provider || prior.context !== member.context) {
    return failed(state, `teammate "${prior.id}" changed immutable identity fields`);
  }
  if (prior.phase !== "provisioning" || member.phase !== "active" && member.phase !== "failed") {
    return failed(
      state,
      `teammate "${member.name}" has an invalid ${prior.phase} -> ${member.phase} transition`
    );
  }
  return { ...state, members: state.members.map((m) => m.id === member.id ? member : m) };
}
function applyTask(state, task) {
  const prior = state.tasks.find((t2) => t2.id === task.id);
  const expectedRevision = prior === void 0 ? 1 : prior.revision + 1;
  if (task.revision !== expectedRevision) {
    return failed(
      state,
      prior === void 0 ? `team task "${task.id}" must begin at revision 1` : `team task "${task.id}" revision is not contiguous`
    );
  }
  const tasks = prior === void 0 ? [...state.tasks, task] : state.tasks.map((t2) => t2.id === task.id ? task : t2);
  try {
    validateTaskGraph(tasks);
  } catch (err) {
    return failed(state, err instanceof Error ? err.message : String(err));
  }
  let nextTaskNumber = state.nextTaskNumber;
  const n = taskNumberFromId(task.id);
  if (n !== void 0) {
    nextTaskNumber = Math.max(state.nextTaskNumber, Math.min(n + 1, Number.MAX_SAFE_INTEGER));
  }
  return { ...state, tasks, nextTaskNumber };
}
function applyMessageQueued(state, message) {
  if (state.messages.some((m) => m.id === message.id)) {
    return failed(state, `team message "${message.id}" was queued twice`);
  }
  return { ...state, messages: [...state.messages, message] };
}
function applyMessageDelivered(state, messageId, targetId) {
  const queued = state.messages.find((m) => m.id === messageId);
  if (queued === void 0) {
    return failed(state, `team message "${messageId}" was delivered before queueing`);
  }
  if (queued.targetId !== targetId) {
    return failed(state, `team message "${messageId}" target changed`);
  }
  if (state.delivered.includes(messageId)) {
    return failed(state, `team message "${messageId}" was delivered twice`);
  }
  return { ...state, delivered: [...state.delivered, messageId] };
}
var viewCache = /* @__PURE__ */ new WeakMap();
function teamProjectionView(state) {
  let byTasks = viewCache.get(state.members);
  if (byTasks === void 0) {
    byTasks = /* @__PURE__ */ new WeakMap();
    viewCache.set(state.members, byTasks);
  }
  let entry = byTasks.get(state.tasks);
  if (entry === void 0) {
    const members = [
      { id: state.id, name: "lead", role: "lead", phase: "active" },
      ...state.members.map((m) => ({ id: m.id, name: m.name, role: "teammate", phase: m.phase, ...m.error !== void 0 ? { error: m.error } : {} }))
    ];
    const tasks = state.tasks.filter((t2) => t2.status !== "deleted").map((t2) => projectTaskView(state, t2));
    entry = { healthy: { members, tasks } };
    byTasks.set(state.tasks, entry);
  }
  if (state.failure === void 0) return entry.healthy;
  if (entry.failed === void 0) {
    entry.failed = { ...entry.healthy, failure: state.failure };
  }
  return entry.failed;
}

// src/coord/replay.ts
var checkpointDocSchema = external_exports.strictObject({
  kind: external_exports.literal("agent-team-checkpoint"),
  stateVersion: external_exports.literal(TEAM_PROJECTION_STATE_VERSION),
  lastSeq: external_exports.number().int().nonnegative(),
  lastOffset: external_exports.number().int().nonnegative(),
  savedAt: external_exports.string(),
  state: teamStateSchema,
  view: external_exports.unknown()
});
function checkpointPath(teamDir) {
  return path.join(teamDir, "checkpoint.json");
}
async function load(teamDir, teamId) {
  const startedAt = Date.now();
  const eventsFile = path.join(teamDir, "events.jsonl");
  const raw = readBufferOrEmpty(eventsFile);
  let checkpointIgnored;
  let doc;
  try {
    const rawDoc = fs.readFileSync(checkpointPath(teamDir), "utf8");
    const parsed = checkpointDocSchema.safeParse(JSON.parse(rawDoc));
    if (!parsed.success) {
      checkpointIgnored = `checkpoint invalid: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`;
    } else if (parsed.data.state.id !== teamId) {
      checkpointIgnored = `checkpoint teamId mismatch (${parsed.data.state.id} != ${teamId})`;
    } else {
      doc = parsed.data;
    }
  } catch {
  }
  const writers = [];
  let state = emptyTeamState(teamId);
  let seq = 0;
  let fromCheckpoint = false;
  let corrupt;
  if (doc !== void 0) {
    const tail = raw.subarray(doc.lastOffset);
    const first = firstLineBytes(tail);
    if (tail.length > 0 && first === void 0) {
      checkpointIgnored = "checkpoint offset desync (tail not line-aligned) \u2014 full replay";
    } else if (first !== void 0 && JSON.parse(first.parsed).seq !== doc.lastSeq + 1) {
      checkpointIgnored = "checkpoint offset desync (seq continuity broken) \u2014 full replay";
    } else {
      state = doc.state;
      seq = doc.lastSeq;
      fromCheckpoint = true;
    }
  }
  const startOffset = fromCheckpoint && doc !== void 0 ? doc.lastOffset : 0;
  let offset = startOffset;
  let consumeRest = true;
  while (consumeRest && offset < raw.length) {
    const nl = raw.indexOf(10, offset);
    if (nl === -1) {
      corrupt = { line: seq + 1, reason: "trailing partial line (no newline)" };
      state = withFailure(state, raw.subarray(offset).toString("utf8"));
      seq += 1;
      consumeRest = false;
      break;
    }
    const lineText = raw.subarray(offset, nl).toString("utf8");
    const lineNo = seq + 1;
    offset = nl + 1;
    if (lineText.length === 0) {
      corrupt = { line: lineNo, reason: "empty line" };
      state = withFailure(state, lineText);
      seq = lineNo;
      consumeRest = false;
      break;
    }
    let parsed;
    try {
      parsed = JSON.parse(lineText);
    } catch {
      corrupt = { line: lineNo, reason: "invalid JSON" };
      state = withFailure(state, lineText);
      seq = lineNo;
      consumeRest = false;
      break;
    }
    const line = parsed;
    if (typeof line.writer === "string" && !writers.includes(line.writer)) writers.push(line.writer);
    if (typeof parsed !== "object" || parsed === null || typeof parsed.seq !== "number" || !("event" in parsed) || parsed.seq !== lineNo) {
      corrupt = { line: lineNo, reason: "line shape invalid or seq discontinuous" };
      state = withFailure(state, lineText);
      seq = lineNo;
      consumeRest = false;
      break;
    }
    state = applyProjectionEvent(state, line.event);
    seq = lineNo;
    if (state.failure !== void 0) {
      consumeRest = false;
    }
  }
  return {
    state,
    view: teamProjectionView(state),
    seq,
    fromCheckpoint,
    checkpointIgnored,
    corrupt,
    writers,
    replayMs: Date.now() - startedAt
  };
}
function readBufferOrEmpty(file) {
  try {
    return fs.readFileSync(file);
  } catch {
    return Buffer.alloc(0);
  }
}
function firstLineBytes(buf) {
  const nl = buf.indexOf(10);
  const first = (nl === -1 ? buf : buf.subarray(0, nl)).toString("utf8");
  if (first.length === 0) return void 0;
  try {
    JSON.parse(first);
    return { parsed: first };
  } catch {
    return void 0;
  }
}
function withFailure(state, rawLine) {
  const m = rawLine.match(/"type"\s*:\s*"(team\/[A-Za-z/-]+)"/);
  const type = m?.[1] ?? "stream";
  return { ...state, failure: `persisted Agent Teams ${type} payload is invalid` };
}

// src/cli/state.ts
function renderState(input, paint) {
  const { teamId, loaded, json } = input;
  if (json) {
    return JSON.stringify(
      {
        teamId,
        seq: loaded.seq,
        fromCheckpoint: loaded.fromCheckpoint,
        checkpointIgnored: loaded.checkpointIgnored,
        corrupt: loaded.corrupt,
        writers: loaded.writers,
        replayMs: loaded.replayMs,
        failure: loaded.state.failure,
        view: loaded.view,
        mailbox: {
          messages: loaded.state.messages,
          delivered: loaded.state.delivered
        }
      },
      null,
      2
    );
  }
  const lines = [];
  const mode = loaded.fromCheckpoint ? "checkpoint+tail" : "full-replay";
  lines.push(
    `${paint.bold(`Agent Team ${teamId}`)}  seq ${loaded.seq}  ${paint.dim(`${mode} \xB7 ${loaded.replayMs}ms \xB7 writers ${loaded.writers.length}`)}`
  );
  if (loaded.corrupt !== void 0) {
    lines.push(paint.red(`\u26A0 \u65E5\u5FD7\u635F\u574F fail-closed\uFF08\u884C ${loaded.corrupt.line}\uFF09\uFF1A${loaded.corrupt.reason}`));
  }
  if (loaded.state.failure !== void 0) {
    lines.push(paint.red(`\u26A0 FAILURE\uFF08\u7EC8\u6001\uFF0C\u540E\u7EED\u5408\u6CD5\u4E8B\u4EF6\u4E0D\u518D\u6539\u53D8\u89C6\u56FE\uFF09\uFF1A${loaded.state.failure}`));
  }
  const members = loaded.view.members;
  lines.push("");
  lines.push(paint.bold(`Roster (${members.length})`));
  if (members.length === 0) {
    lines.push(paint.dim("  \uFF08\u7A7A\uFF09"));
  } else {
    lines.push(`  ${pad("NAME", 16)}${pad("ROLE", 10)}PHASE`);
    for (const m of members) {
      const row = `  ${pad(m.name, 16)}${pad(m.role, 10)}${m.phase}`;
      lines.push(m.error !== void 0 ? paint.red(`${row}  \u26A0 ${m.error}`) : row);
    }
  }
  const tasks = loaded.view.tasks;
  lines.push("");
  lines.push(paint.bold(`Tasks (${tasks.length})`));
  if (tasks.length === 0) {
    lines.push(paint.dim("  \uFF08\u6682\u65E0\u4EFB\u52A1\uFF09"));
  } else {
    lines.push(`  ${pad("ID", 10)}${pad("STATUS", 12)}${pad("OWNER", 12)}${pad("REV", 5)}${pad("READY", 7)}SUBJECT`);
    for (const t2 of tasks) {
      const owner = t2.ownerName ?? "\u2014";
      const statusCell = pad(t2.status, 12);
      const status = t2.status === "completed" ? paint.green(statusCell) : t2.status === "in_progress" ? paint.yellow(statusCell) : statusCell;
      lines.push(`  ${pad(t2.id, 10)}${status}${pad(owner, 12)}${pad(String(t2.revision), 5)}${pad(String(t2.ready), 7)}${t2.subject}`);
      if (t2.blockedBy.length > 0) lines.push(paint.dim(`    ${" ".repeat(34)}blockedBy: ${t2.blockedBy.join(", ")}`));
    }
  }
  const deliveredIds = new Set(loaded.state.delivered);
  const pending = loaded.state.messages.filter((m) => !deliveredIds.has(m.id));
  lines.push("");
  lines.push(paint.bold(`Mailbox\uFF08pending ${pending.length} / delivered ${loaded.state.delivered.length}\uFF09`));
  if (loaded.state.messages.length === 0) {
    lines.push(paint.dim("  \uFF08\u90AE\u7BB1\u7A7A\u95F2\uFF09"));
  } else {
    for (const m of loaded.state.messages) {
      const state = deliveredIds.has(m.id) ? paint.green("delivered") : paint.yellow("queued");
      lines.push(`  ${m.id}  ${m.senderName} \u2192 ${targetLabel(loaded, m.targetId)}  [${state}]`);
    }
  }
  return lines.join("\n");
}
function targetLabel(loaded, targetId) {
  if (targetId === loaded.state.id) return "lead";
  return loaded.view.members.find((m) => m.id === targetId)?.name ?? targetId;
}
function pad(text, width) {
  return text.length >= width ? text + " " : text + " ".repeat(width - text.length);
}

// src/cli/tail.ts
import fs2 from "node:fs";
import path2 from "node:path";
function formatTailLine(input, paint) {
  if (input.kind === "invalid") {
    return paint.red(`!! \u65E0\u6CD5\u89E3\u6790\u7684\u884C\uFF1A${input.raw.slice(0, 160)}`);
  }
  const { line } = input;
  const time = localTime(line.ts);
  const summary = summarize(line);
  const type = line.event.type;
  const coloredType = type === "team/member" ? paint.cyan(type) : type === "team/task" ? paint.yellow(type) : type === "team/message/queued" || type === "team/message" ? paint.magenta(type) : type === "team/message/delivered" ? paint.green(type) : paint.dim(type);
  return `${paint.dim(time)}  ${paint.bold(String(line.seq).padStart(4))}  ${coloredType}  ${summary}  ${paint.dim(line.writer)}`;
}
function summarize(line) {
  const e = line.event;
  if (e.type === "team/member" && e.member !== void 0) {
    return `${e.member.name} (${e.member.id}) \u2192 ${e.member.phase}`;
  }
  if (e.type === "team/task" && e.task !== void 0) {
    return `${e.task.id} ${e.task.subject ?? ""} [${e.task.status ?? "?"} r${e.task.revision ?? "?"}]`;
  }
  if ((e.type === "team/message/queued" || e.type === "team/message") && e.message !== void 0) {
    return `${e.message.id} ${e.message.senderName} \u2192 ${e.message.targetId}`;
  }
  if (e.type === "team/message/delivered") {
    return `${e.messageId} \u2192 ${e.targetId}`;
  }
  return JSON.stringify(e);
}
function localTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "invalid-ts";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}
async function followEvents(eventsFile, opts) {
  const paint = opts.paint;
  const pollMs = opts.pollMs ?? 250;
  let offset = 0;
  let buffer = "";
  if (!fs2.existsSync(eventsFile)) {
    throw new Error(`events file not found: ${eventsFile}`);
  }
  const history = fs2.readFileSync(eventsFile, "utf8");
  const lines = history.split("\n").filter((l) => l.length > 0);
  const start = opts.fromLines !== void 0 ? Math.max(0, lines.length - opts.fromLines) : lines.length;
  const emit = (raw) => {
    try {
      const parsed = JSON.parse(raw);
      opts.onLine(formatTailLine({ kind: "line", line: parsed }, paint), { kind: "line", line: parsed });
    } catch {
      opts.onLine(formatTailLine({ kind: "invalid", raw }, paint), { kind: "invalid", raw });
    }
  };
  for (const raw of lines.slice(start)) {
    emit(raw);
  }
  offset = Buffer.byteLength(history, "utf8");
  for (; ; ) {
    if (opts.signal?.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const stat = fs2.statSync(eventsFile);
    if (stat.size < offset) {
      offset = 0;
      buffer = "";
    }
    if (stat.size > offset) {
      const slack = 1 << 16;
      const chunk = Buffer.alloc(slack);
      const fd = fs2.openSync(eventsFile, "r");
      try {
        const bytesRead = fs2.readSync(fd, chunk, 0, slack, offset);
        if (bytesRead > 0) {
          buffer += chunk.toString("utf8", 0, bytesRead);
          let nl;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const raw = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (raw.length > 0) emit(raw);
          }
          offset += bytesRead;
        }
      } finally {
        fs2.closeSync(fd);
      }
    }
  }
}
function eventsFileOf(teamDir) {
  return path2.join(teamDir, "events.jsonl");
}

// src/cli/inject.ts
import fs3 from "node:fs";
import path3 from "node:path";
function injectEvent(teamDir, rawLine, opts = {}) {
  const eventsFile = path3.join(teamDir, "events.jsonl");
  fs3.mkdirSync(teamDir, { recursive: true });
  const existing = fs3.existsSync(eventsFile) ? fs3.readFileSync(eventsFile, "utf8") : "";
  const lineCount = existing.length === 0 ? 0 : existing.split("\n").filter((l) => l.length > 0).length;
  let parsed;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    throw new Error(`inject-event: \u53C2\u6570\u5FC5\u987B\u662F\u5408\u6CD5 JSON \u884C\uFF0C\u6536\u5230\uFF1A${rawLine.slice(0, 120)}`);
  }
  const line = JSON.stringify({
    seq: lineCount + 1,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    writer: opts.writer ?? "team-ctl:inject",
    ...parsed
  });
  fs3.appendFileSync(eventsFile, line + "\n", { mode: 384 });
  return { seq: lineCount + 1, line, file: eventsFile };
}
function invalidMemberSample(teamId) {
  return JSON.stringify({
    event: {
      type: "team/member",
      version: 2,
      teamId,
      member: { id: "sess-injected-ghost", name: "ghost", description: "injected", provider: "spawn", context: "fresh", phase: "active" }
    }
  });
}

// src/coord/rpc.ts
import net from "node:net";
import fs5 from "node:fs";
import path5 from "node:path";

// src/coord/paths.ts
import { createHash } from "node:crypto";
import fs4 from "node:fs";
import path4 from "node:path";
import os from "node:os";
var MAX_SOCKET_PATH = 96;
function resolveSocketPath(teamDir) {
  const candidate = path4.join(teamDir, "coordinator.sock");
  if (candidate.length <= MAX_SOCKET_PATH) {
    return { socketPath: candidate, fallback: false, registryFile: path4.join(teamDir, "socket.path") };
  }
  const hash = createHash("sha256").update(candidate).digest("hex").slice(0, 16);
  const tmpRoot = fs4.realpathSync(os.tmpdir());
  const fallbackDir = path4.join(tmpRoot, "agent-team-sockets");
  fs4.mkdirSync(fallbackDir, { recursive: true, mode: 448 });
  try {
    fs4.chmodSync(fallbackDir, 448);
  } catch {
  }
  const fallbackPath = path4.join(fallbackDir, `at-${hash}.sock`);
  return { socketPath: fallbackPath, fallback: true, registryFile: path4.join(teamDir, "socket.path") };
}
function discoverSocketPath(teamDir) {
  const registryFile = path4.join(teamDir, "socket.path");
  try {
    const registered = fs4.readFileSync(registryFile, "utf8").trim();
    if (registered.length > 0) return registered;
  } catch {
  }
  return resolveSocketPath(teamDir).socketPath;
}

// src/coord/rpc.ts
var COORDINATOR_UNAVAILABLE_MESSAGE = "Agent Teams coordinator is unavailable (between coordinators); retry the request shortly";
var MAX_RPC_BUFFER_BYTES = 1 << 20;
var RpcClient = class _RpcClient {
  constructor(socket, token = void 0, nextId = 1, pending = /* @__PURE__ */ new Map(), maxFrameBytes = MAX_RPC_BUFFER_BYTES) {
    this.socket = socket;
    this.token = token;
    this.nextId = nextId;
    this.pending = pending;
    this.maxFrameBytes = maxFrameBytes;
  }
  maxFrameBytes;
  static async connect(socketPath, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 3e3;
    const socket = await new Promise((resolve, reject) => {
      const s = net.connect(socketPath, () => resolve(s));
      s.setEncoding("utf8");
      const timer = setTimeout(() => {
        s.destroy();
        reject(new Error(`rpc connect timeout after ${timeoutMs}ms: ${socketPath}`));
      }, timeoutMs);
      s.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      resolveSocketOnConnect(s, () => clearTimeout(timer));
    });
    const client = new _RpcClient(socket, opts.token, 1, /* @__PURE__ */ new Map(), opts.maxFrameBytes);
    socket.on("data", (chunk) => client.onData(chunk));
    socket.on("close", () => client.failAll(new Error("rpc connection closed")));
    socket.on("error", (err) => client.failAll(err));
    return client;
  }
  async call(method, params, opts = {}) {
    const id = this.nextId++;
    const timeoutMs = opts.timeoutMs ?? 15e3;
    if (opts.signal?.aborted) {
      return Promise.reject(
        new TeamError("TEAM_WAIT_ABORTED", `wait_agent aborted: ${abortReasonText(opts.signal.reason)}`)
      );
    }
    const payload = JSON.stringify({ id, method, params, ...this.token !== void 0 ? { token: this.token } : {} }) + "\n";
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (fn) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        this.pending.delete(id);
        fn();
      };
      const onAbort = () => {
        finish(
          () => reject(new TeamError("TEAM_WAIT_ABORTED", `wait_agent aborted: ${abortReasonText(opts.signal?.reason)}`))
        );
        this.socket.destroy();
      };
      timer = setTimeout(() => {
        finish(() => reject(new Error(`rpc call ${method} timed out after ${timeoutMs}ms`)));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => finish(() => resolve(v)),
        reject: (e) => finish(() => reject(e))
      });
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      this.socket.write(payload, (err) => {
        if (err) finish(() => reject(err));
      });
    });
  }
  close() {
    this.socket.destroy();
  }
  onData(chunk) {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, "utf8") > this.maxFrameBytes) {
      this.failAll(new Error(`rpc response frame exceeds ${this.maxFrameBytes} bytes`));
      this.socket.destroy();
      return;
    }
    let nl;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.trim().length === 0) continue;
      try {
        this.onResponse(JSON.parse(line));
      } catch {
        this.failAll(new Error("invalid rpc response frame"));
      }
    }
  }
  buffer = "";
  onResponse(res) {
    const entry = this.pending.get(res.id);
    if (entry === void 0) return;
    this.pending.delete(res.id);
    if (res.ok) {
      entry.resolve(res.result);
    } else if (res.error?.code !== void 0) {
      entry.reject(new TeamError(res.error.code, res.error.message));
    } else {
      const err = new Error(res.error?.message ?? "rpc error");
      if (res.error?.name) err.name = res.error.name;
      entry.reject(err);
    }
  }
  failAll(err) {
    for (const [, entry] of this.pending) entry.reject(err);
    this.pending.clear();
  }
};
function resolveSocketOnConnect(socket, onConnected) {
  socket.once("connect", onConnected);
}
function rpcTokenPath(teamDir) {
  return path5.join(teamDir, "rpc.token");
}
function readRpcToken(teamDir) {
  try {
    const token = fs5.readFileSync(rpcTokenPath(teamDir), "utf8").trim();
    return token.length > 0 ? token : void 0;
  } catch {
    return void 0;
  }
}
function coordinatorUnavailableError(detail) {
  return new TeamError("TEAM_DISPOSED", COORDINATOR_UNAVAILABLE_MESSAGE, { cause: detail });
}
function abortReasonText(reason) {
  if (reason instanceof Error) return reason.message;
  if (reason === void 0 || reason === null) return "aborted";
  return String(reason);
}
async function callCoordinator(teamDir, teamId, method, params, opts = {}) {
  const socketPath = discoverSocketPath(teamDir);
  const token = readRpcToken(teamDir);
  const client = await RpcClient.connect(socketPath, {
    timeoutMs: opts.connectTimeoutMs ?? 1e3,
    ...token !== void 0 ? { token } : {}
  }).catch((err) => {
    throw coordinatorUnavailableError(`socket ${socketPath}: ${err.code ?? err.message}`);
  });
  try {
    return await client.call(method, params, {
      timeoutMs: opts.timeoutMs,
      ...opts.signal !== void 0 ? { signal: opts.signal } : {}
    });
  } finally {
    client.close();
  }
}

// src/cli/call.ts
async function callTeam(teamDir, method, paramsJson) {
  let params = {};
  if (paramsJson !== void 0 && paramsJson.trim().length > 0) {
    try {
      params = JSON.parse(paramsJson);
    } catch (err) {
      return {
        ok: false,
        output: `call: params \u4E0D\u662F\u5408\u6CD5 JSON\uFF08${err instanceof Error ? err.message : String(err)}\uFF09`,
        audit: JSON.stringify({ tool: "team-ctl", action: "call", teamDir, method, ok: false, reason: "bad-params" })
      };
    }
  }
  try {
    const result = await callCoordinator(teamDir, "", method, params, { timeoutMs: 1e4 });
    return {
      ok: true,
      output: JSON.stringify(result, null, 2),
      audit: JSON.stringify({ tool: "team-ctl", action: "call", teamDir, method, ok: true })
    };
  } catch (err) {
    const summary = err instanceof TeamError ? `[${err.code}] ${err.message}` : err instanceof Error && err.message === COORDINATOR_UNAVAILABLE_MESSAGE ? COORDINATOR_UNAVAILABLE_MESSAGE : err instanceof Error ? err.message.split("\n")[0] : String(err);
    return {
      ok: false,
      output: `call ${method} \u5931\u8D25\uFF1A${summary}`,
      audit: JSON.stringify({
        tool: "team-ctl",
        action: "call",
        teamDir,
        method,
        ok: false,
        code: err instanceof TeamError ? err.code : void 0
      })
    };
  }
}

// src/cli/colors.ts
function paintFor(stream) {
  const enabled = process.env.FORCE_COLOR === "1" || stream.isTTY === true && process.env.NO_COLOR === void 0;
  const wrap = (code) => (text) => enabled ? `\x1B[${code}m${text}\x1B[0m` : text;
  return {
    enabled,
    cyan: wrap("36"),
    yellow: wrap("33"),
    magenta: wrap("35"),
    green: wrap("32"),
    red: wrap("31"),
    bold: wrap("1"),
    dim: wrap("2")
  };
}
function paintForStream(stream) {
  return paintFor({ isTTY: stream.isTTY });
}

// src/cli/ui.ts
import fs9 from "node:fs";
import path10 from "node:path";

// src/provider/transcript.ts
import fs6 from "node:fs";
import os2 from "node:os";
import path6 from "node:path";
import { DatabaseSync } from "node:sqlite";

// src/provider/model-selection.ts
function parseModelSelection(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  const record = value;
  const providerId = nonEmptyString(record.providerId);
  const modelId = nonEmptyString(record.modelId);
  if (providerId === void 0 || modelId === void 0) return void 0;
  const options = record.options;
  if (options !== void 0 && (typeof options !== "object" || options === null || Array.isArray(options))) {
    return void 0;
  }
  let reasoningLevel;
  const rawLevel = options !== void 0 ? options.reasoningLevel : record.reasoningLevel;
  if (rawLevel !== void 0) {
    reasoningLevel = nonEmptyString(rawLevel);
    if (reasoningLevel === void 0) return void 0;
  }
  return { providerId, modelId, ...reasoningLevel !== void 0 ? { reasoningLevel } : {} };
}
function nonEmptyString(value) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}

// src/provider/transcript.ts
function defaultDbPath() {
  return process.env.TEAM_DB_PATH ?? path6.join(os2.homedir(), ".zcode", "cli", "db", "db.sqlite");
}
var TranscriptReader = class {
  dbPath;
  db = null;
  dbMissing = false;
  constructor(deps = {}) {
    this.dbPath = deps.dbPath ?? defaultDbPath();
  }
  get path() {
    return this.dbPath;
  }
  /** 库不存在 = 空库语义（探针方法走缺省值，不建临时库）。 */
  missing() {
    if (!this.dbMissing) this.dbMissing = !fs6.existsSync(this.dbPath);
    else if (!fs6.existsSync(this.dbPath)) return true;
    else this.dbMissing = false;
    return this.dbMissing;
  }
  open() {
    if (this.db !== null) return this.db;
    if (!fs6.existsSync(this.dbPath)) {
      throw new Error("transcript db missing");
    }
    this.db = new DatabaseSync(this.dbPath, { readOnly: true });
    return this.db;
  }
  close() {
    this.db?.close();
    this.db = null;
  }
  /** 会话行实查；不存在 → undefined；读失败 → 抛错。 */
  session(sessionId) {
    if (this.missing()) return void 0;
    const row = this.open().prepare(
      "SELECT id, parent_id, directory, task_type, title, time_created FROM session WHERE id = ?"
    ).get(sessionId);
    return row ?? void 0;
  }
  /** 找「目录 = cwd 且创建于 sinceMs 之后、首条真实用户文本 = firstPrompt」的会话（fresh spawn 探针）。 */
  findSessionByFirstPrompt(args) {
    if (this.missing()) return void 0;
    const rows = this.open().prepare(
      "SELECT id, time_created FROM session WHERE directory = ? AND time_created >= ? ORDER BY time_created ASC"
    ).all(args.cwd, args.sinceMs - 2e3);
    for (const row of rows) {
      if (args.excludeSessionIds?.has(row.id)) continue;
      const first = this.firstRealUserText(row.id);
      if (first === args.firstPrompt) return row.id;
    }
    return void 0;
  }
  /** 首条「真实用户」消息的文本部分（跳过 hook/系统注入的 model-only 消息）。 */
  firstRealUserText(sessionId) {
    if (this.missing()) return null;
    const rows = this.open().prepare(
      `SELECT p.data pdata FROM message m JOIN part p ON p.message_id = m.id
         WHERE m.session_id = ? AND json_extract(m.data,'$.role') = 'user'
           AND json_extract(m.data,'$.semantics.origin') = 'real_user'
           AND json_extract(p.data,'$.type') = 'text'
         ORDER BY m.sequence, p.sequence LIMIT 1`
    ).all(sessionId);
    if (rows.length === 0) return null;
    return extractText(rows[0].pdata);
  }
  /** 会话中是否已存在该文本的「真实用户」消息（delivered/去重探针：prompt 逐字落库）。 */
  hasUserText(sessionId, text) {
    if (this.missing()) return false;
    const row = this.open().prepare(
      `SELECT COUNT(*) n FROM message m JOIN part p ON p.message_id = m.id
         WHERE m.session_id = ? AND json_extract(m.data,'$.role') = 'user'
           AND json_extract(m.data,'$.semantics.origin') = 'real_user'
           AND json_extract(p.data,'$.type') = 'text'
           AND json_extract(p.data,'$.text') = ? LIMIT 1`
    ).get(sessionId, text);
    return row.n > 0;
  }
  /** 会话全部「真实用户」文本消息（时间序；轮次 prompt 审计/恰一次检索用）。 */
  realUserTexts(sessionId) {
    if (this.missing()) return [];
    const rows = this.open().prepare(
      `SELECT m.id mid, m.time_created tc, p.data pdata,
                json_extract(m.data,'$.semantics.origin') origin,
                json_extract(m.data,'$.modelSelection.modelId') model
         FROM message m JOIN part p ON p.message_id = m.id
         WHERE m.session_id = ? AND json_extract(m.data,'$.role') = 'user'
           AND json_extract(m.data,'$.semantics.origin') = 'real_user'
           AND json_extract(p.data,'$.type') = 'text'
         ORDER BY m.sequence, p.sequence`
    ).all(sessionId);
    return rows.map((r) => ({
      messageId: r.mid,
      text: extractText(r.pdata) ?? "",
      timeCreated: r.tc,
      origin: r.origin,
      modelId: r.model
    }));
  }
  /** 会话最新使用的模型（成员行 model 字段实查；无消息 → undefined）。 */
  latestModel(sessionId) {
    if (this.missing()) return void 0;
    const row = this.open().prepare(
      `SELECT json_extract(m.data,'$.modelSelection.modelId') model FROM message m
         WHERE m.session_id = ? AND json_extract(m.data,'$.modelSelection.modelId') IS NOT NULL
         ORDER BY m.sequence DESC LIMIT 1`
    ).get(sessionId);
    return row?.model;
  }
  /**
   * 最近一条「真实用户提交」（semantics.origin=real_user）消息携带的模型快照 + 提交时间。
   * 0.4.0 三源判定的「提交证据」：宿主保存用户消息时写入该次提交的 modelSelection（本机源码核对），
   * 输入框切换在提交瞬间即体现在这里——不依赖会话选模条目（issue #7 场景它可能滞后）。
   * hook/系统注入的 user 消息（origin≠real_user）不算提交。
   */
  latestSubmissionSelection(sessionId) {
    if (this.missing()) return void 0;
    const row = this.open().prepare(
      `SELECT m.time_created tc,
                json_extract(m.data,'$.modelSelection.providerId') p,
                json_extract(m.data,'$.modelSelection.modelId') mo,
                json_extract(m.data,'$.modelSelection.options.reasoningLevel') lvl
         FROM message m
         WHERE m.session_id = ? AND json_extract(m.data,'$.role') = 'user'
           AND json_extract(m.data,'$.semantics.origin') = 'real_user'
           AND json_extract(m.data,'$.modelSelection.providerId') IS NOT NULL
           AND json_extract(m.data,'$.modelSelection.modelId') IS NOT NULL
         ORDER BY m.time_created DESC LIMIT 1`
    ).get(sessionId);
    if (row === void 0) return void 0;
    const providerId = row.p.trim();
    const modelId = row.mo.trim();
    if (providerId.length === 0 || modelId.length === 0) return void 0;
    const lvl = typeof row.lvl === "string" ? row.lvl.trim() : "";
    return {
      selection: { providerId, modelId, ...lvl.length > 0 ? { reasoningLevel: lvl } : {} },
      at: row.tc
    };
  }
  /** 会话选模条目 + 生效时间（UPSERT 单行；用于与提交快照比较「后来是否有 /model 修改」）。 */
  latestModelSelectionTimed(sessionId) {
    if (this.missing()) return void 0;
    const row = this.open().prepare(
      `SELECT data, MAX(COALESCE(time_updated, time_created), time_created) at FROM session_entry
         WHERE session_id = ? AND type = 'runtime/model_selection'
         ORDER BY time_created DESC LIMIT 1`
    ).get(sessionId);
    if (row === void 0) return void 0;
    const selection = this.latestModelSelection(sessionId);
    if (selection === void 0) return void 0;
    return { selection, at: row.at };
  }
  /**
   * 最近一次**主轮**实际模型调用（+ 开始时间）。query_source='main_turn' 过滤是 0.4.0 关键口径：
   * compact/标题生成/goal 摘要/subagent/workflow 子轮的行属于辅助模型，绝不能当作 Lead 当前模型
   * （实测本机取值域 = compact, goal_summary_title, main_turn, session_title, subagent,
   * target_completion_verification, workflow_child）。
   */
  latestMainTurnUsage(sessionId) {
    if (this.missing()) return void 0;
    const row = this.open().prepare(
      `SELECT provider_id, model_id, variant, started_at FROM model_usage
         WHERE session_id = ? AND query_source = 'main_turn'
         ORDER BY started_at DESC LIMIT 1`
    ).get(sessionId);
    if (row === void 0) return void 0;
    const providerId = row.provider_id.trim();
    const modelId = row.model_id.trim();
    if (providerId.length === 0 || modelId.length === 0) return void 0;
    const variant = typeof row.variant === "string" ? row.variant.trim() : "";
    return {
      selection: { providerId, modelId, ...variant.length > 0 ? { reasoningLevel: variant } : {} },
      at: row.started_at
    };
  }
  /**
   * 会话库中最近一次 setModel 的选择（Round A 实证：条目为 UPSERT 单行，canonical id
   * `<sessionId>:runtime-model-selection`，时间排序安全）。data 取嵌套 modelSelection 优先；
   * 兼容旧行把 providerId/modelId/thoughtLevel 平铺在顶层的形态。
   */
  latestModelSelection(sessionId) {
    if (this.missing()) return void 0;
    const row = this.open().prepare(
      `SELECT data FROM session_entry
         WHERE session_id = ? AND type = 'runtime/model_selection'
         ORDER BY time_created DESC LIMIT 1`
    ).get(sessionId);
    if (row === void 0) return void 0;
    const data = parseOrNull(row.data);
    if (data === null) return void 0;
    const nested = parseModelSelection(data.modelSelection);
    if (nested !== void 0) return nested;
    const providerId = typeof data.providerId === "string" ? data.providerId.trim() : "";
    const modelId = typeof data.modelId === "string" ? data.modelId.trim() : "";
    if (providerId.length === 0 || modelId.length === 0) return void 0;
    const thoughtLevel = typeof data.thoughtLevel === "string" ? data.thoughtLevel.trim() : "";
    return {
      providerId,
      modelId,
      ...thoughtLevel.length > 0 ? { reasoningLevel: thoughtLevel } : {}
    };
  }
  /** 最近一次真实模型调用（session_entry 缺失时的继承兜底；variant = 思考强度）。 */
  latestModelUsage(sessionId) {
    if (this.missing()) return void 0;
    const row = this.open().prepare(
      `SELECT provider_id, model_id, variant FROM model_usage
         WHERE session_id = ? ORDER BY started_at DESC LIMIT 1`
    ).get(sessionId);
    if (row === void 0) return void 0;
    const providerId = row.provider_id.trim();
    const modelId = row.model_id.trim();
    if (providerId.length === 0 || modelId.length === 0) return void 0;
    const variant = typeof row.variant === "string" ? row.variant.trim() : "";
    return {
      providerId,
      modelId,
      ...variant.length > 0 ? { reasoningLevel: variant } : {}
    };
  }
  /** 完成回合导出（D3 fork 转录）：真实用户消息 + 助手文本；tool 部分记工具名。 */
  exportTurns(sessionId) {
    if (this.missing()) return [];
    const rows = this.open().prepare(
      `SELECT m.data mdata, p.data pdata FROM message m JOIN part p ON p.message_id = m.id
         WHERE m.session_id = ?
         ORDER BY m.sequence, p.sequence`
    ).all(sessionId);
    const turns = [];
    for (const r of rows) {
      const message = parseOrNull(r.mdata);
      const part = parseOrNull(r.pdata);
      if (message === null || part === null) continue;
      const isUser = message.role === "user";
      const isAssistant = message.role === "assistant";
      const realUser = isUser && message.semantics?.origin === "real_user";
      if (part.type === "text" && typeof part.text === "string") {
        if (realUser) turns.push({ role: "user", text: part.text, toolNames: [] });
        else if (isAssistant) turns.push({ role: "assistant", text: part.text, toolNames: [] });
      } else if (isAssistant && part.type === "tool" && typeof part.tool === "string") {
        const last = turns[turns.length - 1];
        if (last !== void 0 && last.role === "assistant" && !last.toolNames.length) {
          last.toolNames.push(part.tool);
        } else {
          turns.push({ role: "assistant", text: "", toolNames: [part.tool] });
        }
      }
    }
    return turns;
  }
  /**
   * T5.7 成员会话查看视图导出（detail 合成数据源；只读、走 session_id 索引）：
   * 时间序全量 part 行（text/tool 两型；其余 part 型跳过），损坏行跳过。
   * 与 exportTurns 的区别：保留每条 part 的时间戳/role/工具状态（面板折叠行渲染），
   * 不做回合聚合；hook 注入文本不落 transcript part（H14），framed 徽标由
   * panel/detail.ts 以 events 回填（不改写原文）。
   */
  exportDetailParts(sessionId) {
    if (this.missing()) return [];
    const rows = this.open().prepare(
      `SELECT m.data mdata, m.time_created mtc, p.data pdata, p.time_created ptc
         FROM message m JOIN part p ON p.message_id = m.id
         WHERE m.session_id = ?
         ORDER BY m.sequence, p.sequence`
    ).all(sessionId);
    const out = [];
    for (const r of rows) {
      const message = parseOrNull(r.mdata);
      const part = parseOrNull(r.pdata);
      if (message === null || part === null) continue;
      const role = message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : void 0;
      if (role === void 0) continue;
      if (role === "user" && message.semantics?.origin !== "real_user") continue;
      const ts2 = typeof r.ptc === "number" ? r.ptc : r.mtc;
      if (part.type === "text" && typeof part.text === "string") {
        out.push({ ts: ts2, role, kind: "text", text: part.text });
      } else if (part.type === "tool" && typeof part.tool === "string") {
        const status = typeof part.state?.status === "string" ? part.state.status : "unknown";
        out.push({
          ts: ts2,
          role: "assistant",
          kind: "toolCall",
          toolName: part.tool,
          toolStatus: status,
          ...part.state?.input !== void 0 ? { toolInput: part.state.input } : {},
          ...part.state?.output !== void 0 ? { toolOutput: part.state.output } : {}
        });
      }
    }
    return out;
  }
};
function parseOrNull(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function extractText(partData) {
  try {
    const part = JSON.parse(partData);
    return typeof part.text === "string" ? part.text : null;
  } catch {
    return null;
  }
}

// src/panel/detail.ts
var DETAIL_DEFAULT_LIMIT = 100;
var DETAIL_MAX_LIMIT = 200;
var DETAIL_PAGE_BYTES = 256 * 1024;
var TOOL_PAYLOAD_CHARS = 2e3;
var SessionNotSettledError = class extends TeamError {
  sessionNotSettled = true;
};
function resolveMemberSessionId(deps, target, readOriginSession) {
  if (target === deps.teamId || target === "lead") {
    return { memberId: deps.teamId, sessionId: deps.teamId, name: "lead" };
  }
  const member = deps.state.members.find((m) => m.id === target || m.name === target);
  if (member === void 0) {
    throw new TeamError("TEAM_MEMBER_NOT_FOUND", `active teammate "${target}" not found`);
  }
  const sessionId = readOriginSession(member.id);
  if (sessionId === null || sessionId === void 0) {
    throw new SessionNotSettledError(
      "TEAM_MEMBER_NOT_FOUND",
      `active teammate "${member.name}" not found`
    );
  }
  return { memberId: member.id, sessionId, name: member.name };
}
function synthesizeDetailStream(deps, sessionId, memberId) {
  const rows = deps.reader.exportDetailParts(sessionId);
  const framedQueue = framedFor(deps.state, memberId);
  const items = [];
  const used = /* @__PURE__ */ new Set();
  for (const row of rows) {
    const item = toItem(row);
    if (item.role === "user" && item.kind === "text" && item.text !== void 0) {
      const idx = framedQueue.findIndex((f, i) => !used.has(i) && textCarriesFrame(item.text, f));
      if (idx >= 0) {
        used.add(idx);
        item.framed = { messageId: framedQueue[idx].messageId, from: framedQueue[idx].from };
      }
    }
    items.push(item);
  }
  return { items };
}
function framedFor(state, memberId) {
  const delivered = new Set(state.delivered);
  return state.messages.filter((m) => m.targetId === memberId && delivered.has(m.id)).map((m) => ({
    messageId: m.id,
    from: m.senderName,
    body: m.content.map((b) => b.type === "text" ? b.text : JSON.stringify(b)).join("\n")
  }));
}
function textCarriesFrame(text, framed) {
  if (text.includes(`Team message from ${framed.from}:`)) return true;
  const anchor = framed.body.slice(0, 64);
  return anchor.length >= 8 && text.includes(anchor);
}
function toItem(row) {
  const base = { ts: new Date(row.ts).toISOString(), role: row.role };
  if (row.kind === "text") {
    return { ...base, kind: "text", text: row.text ?? "" };
  }
  const tool = { name: row.toolName ?? "unknown", status: row.toolStatus ?? "unknown" };
  const parts = [];
  if (row.toolInput !== void 0) parts.push(`input: ${stringify(row.toolInput)}`);
  if (row.toolOutput !== void 0) parts.push(`output: ${stringify(row.toolOutput)}`);
  if (parts.length === 0) return { ...base, kind: "toolCall", tool };
  const payload = parts.join("\n");
  return {
    ...base,
    kind: "toolCall",
    tool,
    text: payload.length > TOOL_PAYLOAD_CHARS ? payload.slice(0, TOOL_PAYLOAD_CHARS) + "\n\u2026(truncated)" : payload
  };
}
function stringify(v) {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
function projectSummary(items) {
  const out = [];
  let round = { tools: [] };
  for (const item of items) {
    if (item.role === "user" && item.kind === "text") {
      flushRound(out, round);
      round = { user: item, tools: [] };
      continue;
    }
    if (item.kind === "toolCall") {
      round.tools.push(item);
      continue;
    }
    if (item.role === "assistant" && item.kind === "text" && (item.text ?? "").trim().length > 0) {
      round.conclusion = item;
    }
  }
  flushRound(out, round);
  return out;
}
function flushRound(out, round) {
  if (round.user !== void 0) out.push(round.user);
  if (round.tools.length > 0) out.push(toolGroupItem(round.tools));
  if (round.conclusion !== void 0) out.push(round.conclusion);
}
function toolGroupItem(tools) {
  const entries = tools.map((item) => ({
    ts: item.ts,
    name: item.tool?.name ?? "unknown",
    status: item.tool?.status ?? "unknown",
    ...item.text !== void 0 ? { text: item.text } : {}
  }));
  const last = entries[entries.length - 1];
  return { ts: last.ts, role: "assistant", kind: "toolGroup", count: entries.length, tools: entries };
}
function pageDetail(items, opts) {
  const limit = normalizeLimit(opts.limit);
  const total = items.length;
  const upper = opts.cursor !== void 0 ? Math.min(opts.cursor - 1, total) : total;
  const start = Math.max(0, upper - limit);
  let slice = items.slice(start, upper);
  let truncated = false;
  const bytesOf = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
  let bytes = bytesOf(slice);
  while (slice.length > 1 && bytes > DETAIL_PAGE_BYTES) {
    slice = slice.slice(1);
    truncated = true;
    bytes = bytesOf(slice);
  }
  const firstSeq = start + (items.slice(start, upper).length - slice.length) + 1;
  const numbered = slice.map((item, i) => ({ seq: firstSeq + i, ...item }));
  const page = { items: numbered };
  if (start > 0) page.nextCursor = firstSeq;
  return { page, total, truncated };
}
function normalizeLimit(limit) {
  if (limit === void 0) return DETAIL_DEFAULT_LIMIT;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1) {
    throw new TeamError("TEAM_INVALID_ARGUMENT", "limit must be a positive safe integer");
  }
  return Math.min(limit, DETAIL_MAX_LIMIT);
}
function buildDetail(deps, args, readOriginSession) {
  const { memberId, sessionId } = resolveMemberSessionId(deps, args.target, readOriginSession);
  const stream = synthesizeDetailStream(deps, sessionId, memberId);
  const sourceTotal = stream.items.length;
  const projected = projectSummary(stream.items);
  const { page, total, truncated } = pageDetail(projected, {
    ...args.cursor !== void 0 ? { cursor: args.cursor } : {},
    ...args.limit !== void 0 ? { limit: args.limit } : {}
  });
  return {
    sessionId,
    memberId,
    page,
    ...truncated ? { truncated: true } : {},
    total,
    sourceTotal
  };
}
function renderDetailText(result, memberName) {
  const lines = [];
  lines.push(
    `member ${memberName} (${result.memberId}) \xB7 session ${result.sessionId} \xB7 ${result.total} items (summary of ${result.sourceTotal})`
  );
  for (const item of result.page.items) {
    const time = item.ts.slice(11, 19);
    if (item.kind === "toolCall") {
      lines.push(`[${time}] ${item.role} tool ${item.tool?.name ?? "?"} (${item.tool?.status ?? "?"})`);
      if (item.text !== void 0) {
        for (const l of item.text.split("\n").slice(0, 6)) lines.push(`    ${l.slice(0, 160)}`);
      }
      continue;
    }
    if (item.kind === "toolGroup") {
      const counts = /* @__PURE__ */ new Map();
      for (const tool of item.tools ?? []) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
      const list = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([name, n]) => `${name}\xD7${n}`).join(" \xB7 ");
      lines.push(`[${time}] ${item.role} \xB7 ${item.count ?? item.tools?.length ?? 0} \u4E2A\u52A8\u4F5C\uFF08${list}\uFF09`);
      continue;
    }
    const badge = item.framed !== void 0 ? ` [team \u2190 ${item.framed.from}]` : "";
    lines.push(`[${time}] ${item.role}${badge}:`);
    for (const l of (item.text ?? "").split("\n")) lines.push(`    ${l}`);
  }
  if (result.truncated === true) lines.push(`(page truncated to ${DETAIL_PAGE_BYTES / 1024}KiB budget)`);
  if (result.page.nextCursor !== void 0) lines.push(`(earlier messages: cursor=${result.page.nextCursor})`);
  return lines.join("\n");
}

// src/provider/member-files.ts
import fs7 from "node:fs";
import path7 from "node:path";
function memberPaths(teamDir, memberId) {
  const memberDir = path7.join(teamDir, "members", memberId);
  const runDir = path7.join(memberDir, "run");
  return {
    memberDir,
    originFile: path7.join(memberDir, "origin.json"),
    receiptsFile: path7.join(memberDir, "receipts.jsonl"),
    stopBudgetFile: path7.join(memberDir, "stop-budget.json"),
    runDir,
    currentFile: path7.join(runDir, "current.json"),
    drainMarkerFile: path7.join(runDir, "drain-requested.json"),
    modelFailedFile: path7.join(memberDir, "model-failed.json")
  };
}
function readJson(file) {
  let raw;
  try {
    raw = fs7.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return void 0;
    throw err;
  }
  return JSON.parse(raw);
}
function readOrigin(paths) {
  return readJson(paths.originFile);
}

// src/mcp/identity.ts
import fs8 from "node:fs";
import path9 from "node:path";

// src/shared.ts
import path8 from "node:path";
import os3 from "node:os";
function dataDir() {
  const candidates = [
    process.env.TEAM_PLUGIN_DATA,
    process.env.ZCODE_PLUGIN_DATA,
    process.env.CLAUDE_PLUGIN_DATA
  ];
  for (const c of candidates) if (c && c.trim()) return c;
  return path8.join(os3.homedir(), ".zcode", "agent-team-dev-data");
}

// src/mcp/identity.ts
function sessionMapPath(dataRoot) {
  return path9.join(dataRoot, "session-map.json");
}
function readSessionRegistry(dataRoot) {
  try {
    const parsed = JSON.parse(fs8.readFileSync(sessionMapPath(dataRoot), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

// src/ui-core/view.ts
var VIEW_STATE_VERSION = 4;

// src/panel/view-service.ts
function resolveMemberSession(teamDir, dataRoot, memberId) {
  const origin = readOrigin(memberPaths(teamDir, memberId))?.sessionId;
  if (origin !== null && origin !== void 0) return origin;
  for (const entry of Object.values(readSessionRegistry(dataRoot))) {
    if (entry.memberId === memberId && typeof entry.session_id === "string") return entry.session_id;
  }
  return void 0;
}
function buildStaticFrame(loaded, teamId, generatedAt, sessionId, teamDir, dataRoot) {
  const state = loaded.state;
  const members = [
    { target: "lead", role: "lead", status: "inactive", diagnostics: [], id: teamId, sessionId: teamId }
  ];
  for (const m of state.members) {
    const memberSessionId = teamDir !== void 0 && dataRoot !== void 0 ? resolveMemberSession(teamDir, dataRoot, m.id) : void 0;
    members.push({
      target: m.name,
      role: "teammate",
      status: m.phase === "failed" ? "failed" : m.phase === "provisioning" ? "provisioning" : "inactive",
      description: m.description,
      provider: m.provider,
      context: m.context,
      diagnostics: m.error !== void 0 ? [m.error] : [],
      id: m.id,
      ...memberSessionId !== void 0 ? { sessionId: memberSessionId } : {}
    });
  }
  return {
    type: "view",
    stateVersion: VIEW_STATE_VERSION,
    team: {
      teamId,
      status: state.failure !== void 0 ? "failure" : "active",
      ...state.failure !== void 0 ? { failure: state.failure } : {},
      seq: loaded.seq
    },
    members,
    tasks: loaded.view.tasks,
    meta: {
      generatedAt,
      revision: loaded.seq,
      ...sessionId !== void 0 ? { sessionId } : {}
    }
  };
}

// src/ui-core/tokens.ts
var TOKEN_CSS = `
:root, [data-theme="light"] {
  color-scheme: light;
  /* \u6587\u5B57\u56DB\u6863\uFF08dsw label-primary/secondary/tertiary/caption\uFF1B
     caption \u65E0\u72EC\u7ACB\u5BBF\u4E3B\u53D8\u91CF \u2192 tertiary \u540C\u6863 + \u5B57\u9762\u515C\u5E95\u533A\u5206\uFF09 */
  --at-label-primary: var(--color-text-primary, var(--foreground, #1a2233));
  --at-label-secondary: var(--color-text-secondary, var(--muted-foreground, #3d4a5c));
  --at-label-tertiary: var(--color-text-tertiary, var(--muted-foreground, #8a94a6));
  --at-label-caption: var(--color-text-tertiary, #9aa3b2);
  /* \u80CC\u666F\u4E24\u6863\uFF08dsw specific-menu / bg-layer-2\uFF09 */
  --at-bg-menu: var(--color-background-secondary, var(--muted, #f7f8fa));
  --at-bg-layer-2: var(--color-background-primary, var(--card, #ffffff));
  /* \u63CF\u8FB9\u4E09\u6863\uFF08dsw border-l1/l2/l3\uFF1B\u5BBF\u4E3B\u5355\u6863 --border \u2192 \u4E09\u6863\u900F\u660E\u5EA6\u6D3E\u751F\uFF09 */
  --at-border-l1: var(--color-border-primary, var(--border, rgba(16, 24, 40, 0.08)));
  --at-border-l2: var(--color-border-tertiary, var(--border, #e3e6eb));
  --at-border-l3: var(--color-border-secondary, var(--border, #c9cfd8));
  /* \u72B6\u6001\u70B9\u4E94\u7C7B\u8272\uFF08ongoing/idle/done/warning \u2192 --green/\u7070/--blue/--yellow \u6216\u81EA\u7ED8\uFF09 */
  --at-state-ongoing: var(--color-text-success, var(--green, #12a675));
  --at-state-error: var(--color-text-danger, var(--red, #e5484d));
  --at-state-idle: var(--color-text-disabled, #98a2b3);
  --at-state-warning: var(--color-text-warning, var(--yellow, #f59e0b));
  --at-state-done: var(--color-text-info, var(--blue, #3e7bfa));
  /* \u4E1A\u52A1\u4E3B\u8272\uFF08dsw state-business-primary\uFF1A\u5F53\u524D\u4F1A\u8BDD\u9AD8\u4EAE/info Tag\uFF09 */
  --at-business: var(--color-text-info, var(--primary, #3e7bfa));
  /* \u9519\u8BEF\u6587\u672C\uFF08dsw state-error-primary\uFF09 */
  --at-error-text: var(--color-text-danger, var(--red, var(--destructive, #d93036)));
  /* advisory \u8B66\u544A\u6587\u672C\u8272\uFF08\u6DF1\u7425\u73C0\u4FDD\u8BC1 11px \u5C0F\u5B57\u5BF9\u6BD4\u5EA6\uFF09 */
  --at-warning-text: var(--color-text-warning, var(--yellow, #b45309));
  /* \u9634\u5F71\u4E24\u6863\uFF08dsw elevation-prominent / elevation-panel\uFF09 */
  --at-shadow-prominent: var(--shadow-lg, 0 8px 28px rgba(16, 24, 40, 0.16));
  --at-shadow-panel: var(--shadow-md, 0 4px 16px rgba(16, 24, 40, 0.12));
  /* \u6EDA\u52A8\u6761\uFF08dsh scrollbar \u4EE4\u724C\u81EA\u7ED8\uFF09 */
  --at-scrollbar-thumb: color-mix(in srgb, var(--at-label-tertiary) 40%, transparent);
  --at-scrollbar-thumb-hover: color-mix(in srgb, var(--at-label-tertiary) 60%, transparent);
  /* \u5B57\u4F53\uFF08\u4E0D\u5F15\u5916\u90E8\u5B57\u4F53\uFF0C\u8DDF\u968F\u5BBF\u4E3B UI \u5B57\u4F53\u6808\uFF09 */
  --at-font: var(--font-sans, -apple-system, "PingFang SC", "Segoe UI", sans-serif);
}
[data-theme="dark"] {
  color-scheme: dark;
  --at-label-primary: var(--color-text-primary, var(--foreground, #e8eaf0));
  --at-label-secondary: var(--color-text-secondary, var(--muted-foreground, #c0c6d2));
  --at-label-tertiary: var(--color-text-tertiary, var(--muted-foreground, #8d95a3));
  --at-label-caption: var(--color-text-tertiary, #7d8593);
  --at-bg-menu: var(--color-background-secondary, var(--muted, #1b1e24));
  --at-bg-layer-2: var(--color-background-primary, var(--card, #23262d));
  --at-border-l1: var(--color-border-primary, var(--border, rgba(255, 255, 255, 0.08)));
  --at-border-l2: var(--color-border-tertiary, var(--border, #333842));
  --at-border-l3: var(--color-border-secondary, var(--border, #434a56));
  --at-state-ongoing: var(--color-text-success, var(--green, #2fbf8f));
  --at-state-error: var(--color-text-danger, var(--red, #ff6b6e));
  --at-state-idle: var(--color-text-disabled, #7d8593);
  --at-state-warning: var(--color-text-warning, var(--yellow, #ffb454));
  --at-state-done: var(--color-text-info, var(--blue, #6c9cff));
  --at-business: var(--color-text-info, var(--primary, #6c9cff));
  --at-error-text: var(--color-text-danger, var(--red, var(--destructive, #ff8a8d)));
  /* advisory \u8B66\u544A\u6587\u672C\u8272 */
  --at-warning-text: var(--color-text-warning, var(--yellow, #ffb454));
  --at-shadow-prominent: var(--shadow-lg, 0 8px 28px rgba(0, 0, 0, 0.5));
  --at-shadow-panel: var(--shadow-md, 0 4px 16px rgba(0, 0, 0, 0.4));
}
`;

// src/ui-core/css.ts
var COMPONENT_CSS = `
${TOKEN_CSS}
* { box-sizing: border-box; }
.at-root {
  font-family: var(--at-font);
  font-size: 13px;
  line-height: 1.5;
  color: var(--at-label-primary);
  width: 100%;
}
/* \xA710.3 \u9762\u677F\uFF1A\u5BBD min(500px, \u5BB9\u5668\u221232px)\uFF1B\u7D27\u51D1 min(320px,\u2026)\uFF1B\u6700\u5927\u9AD8 min(680px, \u89C6\u53E3\u221232px)\uFF1B
   \u5706\u89D2 12\uFF1Bpadding 8px 2px 0\uFF1Bflex column\uFF1Boverflow hidden\uFF1Belevation-prominent \u9634\u5F71\uFF1B
   border-l1 \u63CF\u8FB9\uFF08stroke \u7B49\u4EF7\uFF0C\u65E0 border\uFF09 */
.team-panel {
  width: min(500px, 100% - 32px);
  max-height: min(680px, 100vh - 32px);
  border-radius: 12px;
  box-shadow: var(--at-shadow-prominent);
  outline: 0.5px solid var(--at-border-l1);
  background: var(--at-bg-menu);
  padding: 8px 2px 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}
.team-panel.compact { width: min(320px, 100% - 32px); }
/* \xA710.3 body\uFF1Aoverflow-y auto\uFF1Bscrollbar-gutter stable\uFF1Bpadding 0 9px 16px 14px */
.panel-body {
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 0 9px 16px 14px;
  flex: auto;
  min-height: 0;
  scrollbar-color: var(--at-scrollbar-thumb) transparent;
}
.panel-body::-webkit-scrollbar { width: 8px; }
.panel-body::-webkit-scrollbar-thumb {
  background: var(--at-scrollbar-thumb);
  border-radius: 4px;
}
.panel-body::-webkit-scrollbar-thumb:hover { background: var(--at-scrollbar-thumb-hover); }
/* \xA710.5 \u8282\u6807\u9898\uFF1A13px/500\uFF0Cmargin 16px 0 8px 4px\uFF08\u9996\u8282 top 8px\uFF09\uFF0Cgap 8\uFF1B
   count 12px/16px tabular-nums caption \u8272 */
.panel-body h3 {
  font-size: 13px;
  font-weight: 500;
  color: var(--at-label-primary);
  margin: 16px 0 8px 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.panel-body section:first-of-type h3 { margin-top: 8px; }
h3 .count {
  font-size: 12px;
  line-height: 16px;
  font-weight: 400;
  color: var(--at-label-caption);
  font-variant-numeric: tabular-nums;
}
/* \xA710.5 \u82B1\u540D\u518C\u7F51\u683C\uFF1A\u53CC\u5217 minmax(0,1fr) gap 8\uFF1B\u7D27\u51D1\u5355\u5217 */
.roster { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.compact .roster { grid-template-columns: minmax(0, 1fr); }
/* \xA710.5 \u6210\u5458\u5361\uFF1A\u5706\u89D2 8\uFF1Bpadding 10px 12px\uFF1Bgap 8\uFF1Bbg-layer-2\uFF1B\u63CF\u8FB9 border-l2\uFF08stroke \u7B49\u4EF7\uFF09\uFF1B
   \u6587\u5B57\u5DE6\u5BF9\u9F50\uFF1Bflex \u9876\u5BF9\u9F50\uFF1Bhover\uFF08\u975E\u7981\u7528\uFF09border-l3 + elevation-panel\uFF1Bdisabled cursor default */
.member {
  border-radius: 8px;
  padding: 10px 12px;
  gap: 8px;
  background: var(--at-bg-layer-2);
  box-shadow: 0 0 0 0.5px var(--at-border-l2);
  border: none;
  text-align: left;
  display: flex;
  align-items: flex-start;
  font: inherit;
  color: inherit;
  min-width: 0;
  cursor: pointer;
}
.member:disabled { cursor: default; }
.member:not(:disabled):hover,
.member:not(:disabled):focus-visible {
  box-shadow: 0 0 0 0.5px var(--at-border-l3), var(--at-shadow-panel);
}
/* \u5F53\u524D\u4F1A\u8BDD\u9AD8\u4EAE\uFF08\u4EC5 members>1\uFF09\uFF1Abusiness 40% \u6DF7\u8272\u63CF\u8FB9 + inset 1px \u5185\u73AF */
.member.current {
  box-shadow: 0 0 0 0.5px color-mix(in srgb, var(--at-business) 40%, transparent),
    inset 0 0 0 1px color-mix(in srgb, var(--at-business) 40%, transparent);
}
/* \u540D\u5B57/\u6B21\u884C\u6587\u672C\u5217\uFF08\xA710.5 memberText\uFF1Acolumn\uFF0Cmin-width 0 \u4F9B ellipsis\uFF09 */
.member .member-text { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.member .row1 { display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; }
/* \u72B6\u6001\u70B9\u5BB9\u5668\uFF1A1lh \u9AD8\u5782\u76F4\u5BF9\u9F50\uFF08\xA710.5 memberDot\uFF09 */
.member-dot { flex: none; align-items: center; height: 1lh; display: inline-flex; }
.member .name {
  font-weight: 500;
  color: var(--at-label-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.member .sub {
  font-size: 11px;
  color: var(--at-label-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
/* hover/focus \u624D\u663E\u793A\u300C \xB7 \u6A21\u578B: model\u300D\uFF08\xA710.5/V06\uFF09 */
.member .model { display: none; }
.member:hover .model,
.member:focus-visible .model { display: inline; }
.member .diagnostic {
  font-size: 11px;
  color: var(--at-error-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
/* \u5F53\u524D\u4F1A\u8BDD Tag\uFF0810px/15px\uFF0Cpadding 0 4px\uFF0Cinfo tone\uFF09 */
.current-tag {
  font-size: 10px;
  line-height: 15px;
  padding: 0 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--at-business) 16%, transparent);
  color: var(--at-business);
  flex: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 0.4.0 \u6CE8\u9500\u6210\u5458\u5361/\u9F7F\u8F6E\u4E0E\u8BBE\u7F6E\u5F39\u7A97\u6837\u5F0F\uFF08member-card\u3001member-gear\u3001settings \u7CFB\u5217\u3001
   source-badge\u3001modal-select\uFF09\uFF1A\u6210\u5458\u6A21\u578B\u552F\u4E00\u8DEF\u7EBF = \u6BCF\u8F6E\u8DDF\u968F Lead\uFF0C\u9762\u677F\u6062\u590D\u96F6\u53D8\u66F4\u901A\u9053\u3002 */
/* \u72B6\u6001\u70B9\uFF1A\u76F4\u5F84\u4E00\u81F4 8px\uFF08V06\uFF09 */
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; display: inline-block; }
.dot.ongoing { background: var(--at-state-ongoing); }
.dot.error { background: var(--at-state-error); }
.dot.idle { background: var(--at-state-idle); }
.dot.warning { background: var(--at-state-warning); }
.dot.done { background: var(--at-state-done); }
/* inactive \u4EBA\u5F62\u56FE\u6807\uFF1A14px tertiary\uFF08\xA710.5/V06\uFF09 */
.icon-user { width: 14px; height: 14px; flex: none; color: var(--at-label-tertiary); display: inline-flex; }
/* \xA710.4 \u901A\u77E5\u6761\uFF1Aflex gap 6 padding 9 \u5B57\u53F7 12\uFF1Berror = \u9519\u8BEF\u8272\uFF1B\u6309\u5E8F\u6E32\u67D3 */
.notice, .error-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px;
  font-size: 12px;
}
.error-bar { color: var(--at-error-text); }
.notice { color: var(--at-label-secondary); }
/* \xA710.6 \u4EFB\u52A1\u677F\uFF1A\u7A7A\u677F\u6BB5\u843D 12px tertiary margin 16px 0 0 4px\uFF1B\u5217\u8868 flex column gap 7 */
.empty-notice { font-size: 12px; color: var(--at-label-tertiary); margin: 16px 0 0 4px; }
.tasks { display: flex; flex-direction: column; gap: 7px; }
/* \u4EFB\u52A1\u5361\uFF1Aborder 0.5px border-l2\uFF1B\u5706\u89D2 9\uFF1Bpadding 11px 13px\uFF1Bbg-layer-2 */
article.task {
  border: 0.5px solid var(--at-border-l2);
  border-radius: 9px;
  padding: 11px 13px;
  background: var(--at-bg-layer-2);
}
.task .title-row { display: flex; align-items: center; gap: 8px; }
.task strong { font-size: 13px; font-weight: 500; line-height: 1.4; color: var(--at-label-primary); }
/* \u72B6\u6001\u5FBD\u6807\u53F3\u5BF9\u9F50 11px gap 6 */
.task .task-state {
  margin-left: auto;
  font-size: 11px;
  color: var(--at-label-tertiary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
/* \u63CF\u8FF0 12px/18px pre-wrap margin 5px 0\uFF1B\u4E24\u884C\u622A\u65AD */
.task p {
  font-size: 12px;
  line-height: 18px;
  color: var(--at-label-secondary);
  white-space: pre-wrap;
  margin: 5px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.task p.expanded { -webkit-line-clamp: unset; display: block; }
/* \u5C55\u5F00\u5F00\u5173\uFF1Afloat right\uFF1B11px/20px\uFF1Bchevron 12px \u65CB\u8F6C 180\xB0 transition .12s */
.expand-toggle {
  float: right;
  font-size: 11px;
  line-height: 20px;
  color: var(--at-label-tertiary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  margin-left: 10px;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.expand-toggle:hover, .expand-toggle:focus-visible { color: var(--at-label-primary); }
.expand-toggle svg { transition: transform 0.12s; }
.expand-toggle.open svg { transform: rotate(180deg); }
.expand-toggle[hidden] { display: none; }
/* meta \u884C\uFF1A11px/20px\uFF1B\u5B50\u9879\u95F4\u8DDD 10px\uFF1Bwarning \u63D0\u9192\u8272\uFF08advisory \u975E\u9519\u8BEF\uFF09 */
.task .meta { font-size: 11px; line-height: 20px; color: var(--at-label-tertiary); }
.task .meta > span { margin-right: 10px; }
.task .meta .warning { color: var(--at-warning-text); }
/* T5.7 \u6210\u5458\u4F1A\u8BDD\u67E5\u770B\u89C6\u56FE\uFF08V16\uFF1A\u65E0 DSH \u53C2\u7167\uFF0C\u5BBF\u4E3B\u98CE\u683C\uFF1B\u5224\u636E=\u4E0D\u7834\u7248+\u51E0\u4F55\u4E00\u81F4\uFF09 */
.detail-view { display: flex; flex-direction: column; min-height: 0; flex: auto; }
.detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 9px 8px 6px;
  border-bottom: 0.5px solid var(--at-border-l2);
  flex: none;
}
.detail-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--at-label-tertiary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}
.detail-back:hover, .detail-back:focus-visible { color: var(--at-label-primary); background: color-mix(in srgb, var(--at-label-tertiary) 10%, transparent); }
.detail-title { font-size: 13px; font-weight: 500; color: var(--at-label-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail-actions { margin-left: auto; display: inline-flex; gap: 6px; flex: none; }
.detail-action {
  background: none;
  border: 0.5px solid var(--at-border-l2);
  border-radius: 6px;
  color: var(--at-label-secondary);
  font: inherit;
  font-size: 11px;
  line-height: 18px;
  padding: 1px 8px;
  cursor: pointer;
}
.detail-action:hover, .detail-action:focus-visible { color: var(--at-label-primary); border-color: var(--at-border-l3); }
.detail-list { overflow-y: auto; scrollbar-gutter: stable; padding: 8px 9px 16px 14px; flex: auto; min-height: 0; scrollbar-color: var(--at-scrollbar-thumb) transparent; }
.detail-state { font-size: 12px; color: var(--at-label-tertiary); padding: 16px 4px; display: flex; align-items: center; gap: 6px; }
.detail-state.error { color: var(--at-error-text); }
.msg { margin: 0 0 10px; min-width: 0; }
.msg-head { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--at-label-tertiary); margin-bottom: 2px; }
.msg-role { font-weight: 500; color: var(--at-label-secondary); }
.msg-time { font-variant-numeric: tabular-nums; }
.msg-text {
  font-size: 12px;
  line-height: 18px;
  color: var(--at-label-primary);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.msg.user .msg-text { color: var(--at-label-secondary); }
.msg-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  line-height: 15px;
  padding: 0 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--at-business) 16%, transparent);
  color: var(--at-business);
}
.msg-badge.hook { background: color-mix(in srgb, var(--at-label-tertiary) 14%, transparent); color: var(--at-label-tertiary); }
.tool-row { display: block; width: 100%; text-align: left; background: none; border: none; border-top: 0.5px solid var(--at-border-l2); padding: 4px 0; margin-top: 4px; font: inherit; cursor: pointer; color: var(--at-label-tertiary); }
.tool-row:hover, .tool-row:focus-visible { color: var(--at-label-primary); }
.tool-static { display: block; border-top: 0.5px solid var(--at-border-l2); padding: 4px 0; margin-top: 4px; color: var(--at-label-tertiary); }
.tool-row .tool-summary, .tool-static .tool-summary { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; line-height: 20px; }
.tool-row .tool-name, .tool-static .tool-name { font-weight: 500; color: var(--at-label-secondary); }
.tool-row svg { transition: transform 0.12s; }
.tool-row.open svg { transform: rotate(180deg); }
.tool-detail {
  display: none;
  font-size: 11px;
  line-height: 16px;
  color: var(--at-label-tertiary);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  max-height: 200px;
  overflow-y: auto;
  margin: 2px 0 0 18px;
}
.tool-row.open + .tool-detail { display: block; }
/* toolGroup\uFF1A\u6309\u8F6E\u52A8\u4F5C\u7EC4\uFF08\u5934\u90E8\u4E00\u884C\u6C47\u603B\uFF1B\u5C55\u5F00\u9010\u6761\u5DE5\u5177\u884C\uFF0C\u7F29\u8FDB\u5BF9\u9F50 tool-detail\uFF09 */
.tool-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-top: 0.5px solid var(--at-border-l2);
  padding: 4px 0;
  margin-top: 4px;
  font: inherit;
  color: var(--at-label-tertiary);
  cursor: pointer;
}
.tool-group-head:hover, .tool-group-head:focus-visible { color: var(--at-label-primary); }
.tool-group-head .tool-group-label { font-size: 11px; line-height: 20px; color: var(--at-label-secondary); }
.tool-group-head:hover .tool-group-label,
.tool-group-head:focus-visible .tool-group-label { color: var(--at-label-primary); }
.tool-group-head svg { flex: none; transition: transform 0.12s; }
.tool-group.open .tool-group-head svg { transform: rotate(180deg); }
.tool-group-items { display: none; margin-left: 18px; }
.tool-group.open .tool-group-items { display: block; }
.tool-group-items > :first-child { border-top: none; }
.detail-pager { display: flex; align-items: center; gap: 8px; padding: 4px 0 8px; }
.detail-pager .detail-action[disabled] { opacity: 0.45; cursor: default; }
`;
var CARD_CSS = `
html, body { margin: 0; padding: 0; }
.at-root { display: flex; justify-content: center; padding: 16px 0; }
.team-panel { margin: 0 auto; }
`;

// src/ui-core/dict.ts
var DICT = {
  zh: {
    trigger: "\u667A\u80FD\u4F53\u56E2\u961F",
    loading: "\u6B63\u5728\u52A0\u8F7D\u56E2\u961F\u2026",
    unavailable: "Team \u6682\u4E0D\u53EF\u7528",
    failure: "\u56E2\u961F\u6301\u4E45\u8BB0\u5F55\u65E0\u6548\uFF1A{message}",
    empty: "\u6682\u65E0\u5171\u4EAB\u4EFB\u52A1\uFF0C\u53EF\u4EE5\u901A\u8FC7\u5BF9\u8BDD\u521B\u5EFA",
    roster: "\u6210\u5458",
    tasks: "\u5171\u4EAB\u4EFB\u52A1",
    model: "\u6A21\u578B",
    open: "\u6253\u5F00\u6210\u5458\u4F1A\u8BDD",
    current: "\u5F53\u524D\u4F1A\u8BDD",
    owner: "Owner",
    unowned: "\u672A\u5206\u914D",
    blockedBy: "\u4F9D\u8D56",
    writeScopes: "\u5199\u5165\u8303\u56F4",
    ready: "\u53EF\u5F00\u59CB",
    blocked: "\u88AB\u4F9D\u8D56\u963B\u585E",
    "task.expand": "\u5C55\u5F00",
    "task.collapse": "\u6536\u8D77",
    "memberStatus.running": "\u8FD0\u884C\u4E2D",
    "memberStatus.inactive": "\u672A\u8FD0\u884C",
    "memberStatus.provisioning": "\u51C6\u5907\u4E2D",
    "memberStatus.failed": "\u5931\u8D25",
    "status.pending": "\u5F85\u5904\u7406",
    "status.in_progress": "\u8FDB\u884C\u4E2D",
    "status.completed": "\u5DF2\u5B8C\u6210"
  },
  en: {
    trigger: "Agent Team",
    loading: "Loading Team\u2026",
    unavailable: "Team is unavailable",
    failure: "Invalid persisted Team record: {message}",
    empty: "No shared tasks yet. Create them through the conversation.",
    roster: "Members",
    tasks: "Shared tasks",
    model: "Model",
    open: "Open member conversation",
    current: "Current chat",
    owner: "Owner",
    unowned: "Unowned",
    blockedBy: "Blocked by",
    writeScopes: "Write scopes",
    ready: "Ready",
    blocked: "Blocked by dependencies",
    "task.expand": "Show more",
    "task.collapse": "Show less",
    "memberStatus.running": "Running",
    "memberStatus.inactive": "Inactive",
    "memberStatus.provisioning": "Provisioning",
    "memberStatus.failed": "Failed",
    "status.pending": "Pending",
    "status.in_progress": "In progress",
    "status.completed": "Completed"
  }
};
function t(lang, key, vars) {
  return interpolate(DICT[lang][key], vars);
}
function interpolate(template, vars) {
  if (vars === void 0) return template;
  return template.replace(
    /\{(\w+)\}/g,
    (m, k) => k in vars ? String(vars[k]) : m
  );
}
function statusKey(status) {
  return status === "deleted" ? "status.completed" : `status.${status}`;
}
function memberStatusKey(status) {
  return `memberStatus.${status}`;
}

// src/ui-core/icons.ts
var svg = (inner, size) => `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
function iconUser(size = 14) {
  return svg('<circle cx="8" cy="5.5" r="3"/><path d="M2.6 14c.7-2.9 2.9-4.2 5.4-4.2s4.7 1.3 5.4 4.2"/>', size);
}
function iconChevron(size = 12) {
  return svg('<path d="M4 6.2 8 10.2 12 6.2"/>', size);
}

// src/ui-core/escape.ts
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// src/ui-core/render.ts
function isCompact(frame) {
  return frame.members.length === 1 && frame.tasks.length === 0;
}
function currentMemberId(frame) {
  const sid = frame.meta.sessionId;
  if (sid === void 0) return void 0;
  return frame.members.find((m) => m.sessionId === sid)?.id;
}
function isMemberDisabled(m, currentId) {
  return m.id === currentId || m.status === "failed" || m.status === "provisioning";
}
function memberDot(status) {
  switch (status) {
    case "running":
    case "provisioning":
      return "ongoing";
    case "failed":
      return "error";
    case "inactive":
    default:
      return "icon";
  }
}
function taskDot(task) {
  switch (task.status) {
    case "in_progress":
      return "ongoing";
    case "completed":
      return "done";
    case "deleted":
      return "idle";
    // 上游 deleted→idle（视图通常不含墓碑，防御口径）
    case "pending":
    default:
      return task.ready ? "idle" : "warning";
  }
}
function dot(state) {
  return `<span class="dot ${state}"></span>`;
}
function memberIndicator(m) {
  const d = memberDot(m.status);
  const inner = d === "icon" ? `<span class="icon-user">${iconUser(14)}</span>` : dot(d);
  return `<span class="member-dot">${inner}</span>`;
}
function renderMember(m, opts) {
  const { lang, isCurrent, disabled } = opts;
  const highlight = opts.highlightCurrent ?? isCurrent;
  const cls = ["member", highlight ? "current" : ""].filter(Boolean).join(" ");
  const nameRow = `<span class="row1"><span class="name">${esc(m.target)}</span>` + (isCurrent ? `<span class="current-tag">${esc(t(lang, "current"))}</span>` : "") + `</span>`;
  const modelSuffix = m.model !== void 0 ? `<span class="model"> \xB7 ${esc(t(lang, "model"))}: ${esc(m.model)}</span>` : "";
  const sub = `<span class="sub">${esc(t(lang, memberStatusKey(m.status)))}${modelSuffix}</span>`;
  const diag = m.diagnostics.length > 0 ? `<span class="diagnostic">${esc(m.diagnostics[0])}</span>` : "";
  const openAttr = disabled ? "" : ` title="${esc(t(lang, "open"))}"`;
  return `<button class="${cls}" data-member-id="${esc(m.id)}"${disabled ? " disabled" : ""}${openAttr}>` + memberIndicator(m) + `<span class="member-text">${nameRow}${sub}${diag}</span></button>`;
}
function renderRoster(frame, lang) {
  const members = frame.members;
  const currentId = currentMemberId(frame);
  const countHtml = members.length > 1 ? `<span class="count">${members.length}</span>` : "";
  const cards = members.map(
    (m) => renderMember(m, {
      lang,
      // Tag 恒随当前会话；高亮/描边才受 members>1 限制（上游 TeamAction 同口径）。
      isCurrent: m.id === currentId,
      highlightCurrent: m.id === currentId && members.length > 1,
      disabled: isMemberDisabled(m, currentId)
    })
  ).join("");
  return `<section class="roster-section"><h3>${esc(t(lang, "roster"))}${countHtml}</h3><div class="roster">${cards}</div></section>`;
}
function renderTaskMeta(task, lang, leadingHtml = "") {
  const spans = [];
  spans.push(`<span>${esc(task.id)}</span>`);
  const owner = task.ownerName !== void 0 ? esc(task.ownerName) : esc(t(lang, "unowned"));
  spans.push(`<span>${esc(t(lang, "owner"))}: ${owner}</span>`);
  if (task.status === "pending") {
    spans.push(`<span>${esc(t(lang, task.ready ? "ready" : "blocked"))}</span>`);
  }
  if (task.blockedBy.length > 0) {
    spans.push(`<span>${esc(t(lang, "blockedBy"))}: ${task.blockedBy.map(esc).join(", ")}</span>`);
  }
  if (task.writeScopes.length > 0) {
    spans.push(`<span>${esc(t(lang, "writeScopes"))}: ${task.writeScopes.map(esc).join(", ")}</span>`);
  }
  for (const w of task.writeScopeWarnings) {
    spans.push(`<span class="warning">${esc(w)}</span>`);
  }
  return `<div class="meta">${leadingHtml}${spans.join("")}</div>`;
}
function renderTask(task, lang) {
  const state = `<span class="task-state">${dot(taskDot(task))}<span>${esc(t(lang, statusKey(task.status)))}</span></span>`;
  const titleRow = `<div class="title-row"><strong>${esc(task.subject)}</strong>${state}</div>`;
  const toggle = `<button class="expand-toggle" hidden aria-expanded="false" data-task-toggle><span class="expand-label">${esc(t(lang, "task.expand"))}</span>${iconChevron(12)}</button>`;
  const desc = `<p data-task-desc>${esc(task.description)}</p>`;
  return `<article class="task" data-task-id="${esc(task.id)}">` + titleRow + desc + renderTaskMeta(task, lang, toggle) + `</article>`;
}
function renderTasks(frame, lang) {
  if (frame.tasks.length === 0) {
    return `<section class="tasks-section"><p class="empty-notice">${esc(t(lang, "empty"))}</p></section>`;
  }
  const cards = frame.tasks.map((task) => renderTask(task, lang)).join("");
  return `<section class="tasks-section"><h3>${esc(t(lang, "tasks"))}<span class="count">${frame.tasks.length}</span></h3><div class="tasks">${cards}</div></section>`;
}
function renderNotices(opts) {
  const { lang } = opts;
  const out = [];
  if (opts.navError !== void 0) {
    out.push(`<div class="error-bar" role="alert">${dot("error")}<span>${esc(opts.navError)}</span></div>`);
  }
  if (opts.loading === true) {
    out.push(`<div class="notice" role="status">${dot("ongoing")}<span>${esc(t(lang, "loading"))}</span></div>`);
  } else if (opts.noTeam === true) {
    out.push(`<div class="notice" role="status">${dot("warning")}<span>${esc(t(lang, "unavailable"))}</span></div>`);
  }
  if (opts.failure !== void 0) {
    out.push(`<div class="error-bar" role="alert">${dot("error")}<span>${esc(t(lang, "failure", { message: opts.failure }))}</span></div>`);
  }
  return out.join("");
}
function renderPanelBody(frame, lang, runtime) {
  const noTeam = frame.team === null;
  const notices = renderNotices({
    lang,
    ...runtime?.navError !== void 0 ? { navError: runtime.navError } : {},
    ...runtime?.loading !== void 0 ? { loading: runtime.loading } : {},
    noTeam,
    ...frame.team?.failure !== void 0 ? { failure: frame.team.failure } : {}
  });
  if (noTeam && runtime?.loading !== true) {
    return notices;
  }
  return notices + renderRoster(frame, lang) + renderTasks(frame, lang);
}

// src/ui-core/widget.ts
function renderWidgetFragment(opts) {
  const lang = opts.lang ?? "zh";
  const theme = opts.theme ?? "light";
  const rootId = opts.rootId ?? "agent-team-widget";
  const compact = isCompact(opts.frame);
  const body = renderPanelBody(opts.frame, lang, { loading: false });
  const frameJson = esc(JSON.stringify(opts.frame));
  return `<div id="${esc(rootId)}" class="at-root" data-theme="${theme}" data-lang="${lang}" data-labels='${esc(JSON.stringify(widgetLabels(lang)))}'><style>${COMPONENT_CSS}${CARD_CSS}</style><div class="team-panel${compact ? " compact" : ""}" role="dialog" aria-label="${esc(t(lang, "trigger"))}" data-team-panel><div class="panel-body" data-list-view>${body}</div></div><script type="application/json" data-frame>${frameJson}</script><script>(function(){var __AT_ROOT_ID__=${JSON.stringify(rootId)};${WIDGET_SCRIPT}})();</script></div>`;
}
function renderStandalonePage(opts) {
  const lang = opts.lang ?? "zh";
  const theme = opts.theme ?? "light";
  return `<!doctype html>
<html lang="${lang === "zh" ? "zh-CN" : "en"}" data-theme="${theme}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(opts.title ?? t(lang, "trigger"))}</title>
<style>${COMPONENT_CSS}${CARD_CSS}</style>
</head>
<body>
${renderWidgetFragment(opts)}
</body>
</html>
`;
}
var WIDGET_SCRIPT = `
var root = document.getElementById(__AT_ROOT_ID__);
if (!root) return;
var labels = { expand: '\u5C55\u5F00', collapse: '\u6536\u8D77' };
try { labels = JSON.parse(root.getAttribute('data-labels') || '{}') || labels; } catch (e) {}
var store = { set: {} };
try {
  var ws = window.zcode && window.zcode.widgetState;
  if (ws && Array.isArray(ws.expanded)) { for (var i=0;i<ws.expanded.length;i++) store.set[ws.expanded[i]] = true; }
} catch (e) {}
function persist() {
  try {
    if (window.zcode && window.zcode.setWidgetState) {
      window.zcode.setWidgetState({ expanded: Object.keys(store.set).filter(function(k){return store.set[k];}) });
    }
  } catch (e) {}
}
function measure(task) {
  var desc = task.querySelector('[data-task-desc]');
  var toggle = task.querySelector('[data-task-toggle]');
  if (!desc || !toggle) return;
  var id = task.getAttribute('data-task-id') || '';
  var expanded = !!store.set[id];
  var overflow = desc.scrollHeight > desc.clientHeight + 1;
  toggle.hidden = !(overflow || expanded);
  var lbl = toggle.querySelector('.expand-label');
  if (lbl) lbl.textContent = expanded ? (labels.collapse||'\u6536\u8D77') : (labels.expand||'\u5C55\u5F00');
  toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  toggle.classList.toggle('open', expanded);
  desc.classList.toggle('expanded', expanded);
}
var tasks = root.querySelectorAll('article.task');
for (var j=0;j<tasks.length;j++) {
  (function(task){
    var desc = task.querySelector('[data-task-desc]');
    if (desc && typeof ResizeObserver !== 'undefined') { new ResizeObserver(function(){ measure(task); }).observe(desc); }
    measure(task);
  })(tasks[j]);
}
root.addEventListener('click', function(ev){
  var t = ev.target;
  var toggle = t && t.closest ? t.closest('[data-task-toggle]') : null;
  if (toggle) {
    var task = toggle.closest('article.task');
    var id = task ? (task.getAttribute('data-task-id')||'') : '';
    store.set[id] = !store.set[id];
    measure(task); persist();
    return;
  }
  var member = t && t.closest ? t.closest('button.member') : null;
  if (member && !member.disabled) {
    try {
      if (window.zcode && window.zcode.sendFollowUpMessage) {
        window.zcode.sendFollowUpMessage({ prompt: '/team' });
      }
    } catch (e) {}
  }
});
`;
function widgetLabels(lang) {
  return { expand: DICT[lang]["task.expand"], collapse: DICT[lang]["task.collapse"] };
}

// src/cli/ui.ts
function dataRootOf(teamDir) {
  return path10.dirname(path10.dirname(path10.resolve(teamDir)));
}
function renderTranscript(input) {
  const reader = new TranscriptReader(input.dbPath !== void 0 ? { dbPath: input.dbPath } : {});
  let result;
  let name = input.member;
  try {
    result = buildDetail(
      { teamDir: input.teamDir, teamId: input.teamId, state: input.loaded.state, reader },
      {
        target: input.member,
        ...input.cursor !== void 0 ? { cursor: input.cursor } : {},
        ...input.limit !== void 0 ? { limit: input.limit } : {}
      },
      (memberId) => resolveMemberSession(input.teamDir, dataRootOf(input.teamDir), memberId)
    );
    const member = input.loaded.state.members.find((m) => m.id === result.memberId || m.name === input.member);
    if (member !== void 0) name = member.name;
    if (input.member === "lead" || input.member === input.teamId) name = "lead";
  } finally {
    reader.close();
  }
  if (input.json) return JSON.stringify({ ...result, memberName: name }, null, 2);
  return renderDetailText(result, name);
}
function renderWidget(input) {
  const frame = buildStaticFrame(
    input.loaded,
    input.teamId,
    (/* @__PURE__ */ new Date()).toISOString(),
    input.sessionId,
    input.teamDir,
    dataRootOf(input.teamDir)
  );
  const html = input.standalone ? renderStandalonePage({ frame, lang: input.lang, theme: input.theme }) : renderWidgetFragment({ frame, lang: input.lang, theme: input.theme });
  if (input.out !== void 0) {
    const abs = safeOutPath(input.out);
    fs9.mkdirSync(path10.dirname(abs), { recursive: true });
    fs9.writeFileSync(abs, html);
    return { html, out: abs };
  }
  return { html };
}
function safeOutPath(out) {
  if (out.split(/[\\/]/).includes("..")) {
    throw new Error(`--out \u62D2\u7EDD\u8DEF\u5F84\u7A7F\u8D8A\u6BB5 ".."\uFF1A${out}`);
  }
  const abs = path10.resolve(out);
  const base = path10.basename(abs);
  if (!/^[A-Za-z0-9._-]+\.html$/.test(base)) {
    throw new Error(`--out \u6587\u4EF6\u540D\u987B\u4E3A\u767D\u540D\u5355\u5B57\u7B26\u4E14 .html \u540E\u7F00\uFF08[A-Za-z0-9._-]\uFF09\uFF1A${base}`);
  }
  return abs;
}

// src/cli/open-panel.ts
import fs10 from "node:fs";
import net2 from "node:net";
import { execFile } from "node:child_process";

// src/panel/companion-server.ts
import path11 from "node:path";
var COMPANION_REGISTRY_RELPATH = "logs/panel-http.json";
function companionRegistryFile(dataRoot) {
  const root = path11.resolve(dataRoot);
  const file = path11.join(root, COMPANION_REGISTRY_RELPATH);
  if (file !== path11.join(root, "logs", "panel-http.json")) {
    throw new Error("companion registry path escapes dataRoot");
  }
  return file;
}

// src/cli/open-panel.ts
var NOT_RUNNING = "\u4F34\u751F\u9762\u677F\u672A\u8FD0\u884C\uFF08\u65E0 logs/panel-http.json\uFF09\u3002\u4EE5 TEAM_COMPANION=1 \u542F\u52A8 team-daemon \u540E\u91CD\u8BD5\uFF08MCP Apps \u9762\u677F/::visualize \u5361\u7247\u4E3A\u4E3B\u8F7D\u4F53\uFF0C\u4F34\u751F\u9762\u677F\u4E3A\u53EF\u9009\u9AD8\u4FDD\u771F\u8DEF\u5F84\uFF09\u3002";
async function openPanel(input = {}) {
  const registryFile = companionRegistryFile(input.dataRoot ?? dataDir());
  let reg;
  try {
    reg = JSON.parse(fs10.readFileSync(registryFile, "utf8"));
  } catch {
    return { ok: false, message: NOT_RUNNING };
  }
  if (typeof reg.port !== "number" || !Number.isInteger(reg.port) || reg.port < 1 || reg.port > 65535 || typeof reg.token !== "string" || !/^[0-9a-f]{32}$/.test(reg.token)) {
    return { ok: false, message: "logs/panel-http.json \u5185\u5BB9\u975E\u6CD5\uFF08port/token \u6821\u9A8C\u5931\u8D25\uFF09\u3002" };
  }
  const url = `http://127.0.0.1:${reg.port}/panel?token=${reg.token}`;
  const alive = await probePort(reg.port);
  if (!alive) {
    return {
      ok: false,
      port: reg.port,
      message: `\u4F34\u751F\u9762\u677F\u7AEF\u53E3 ${reg.port} \u672A\u76D1\u542C\uFF08daemon \u53EF\u80FD\u5DF2\u56DE\u6536\uFF09\u3002\u4EE5 TEAM_COMPANION=1 \u91CD\u542F daemon \u540E\u91CD\u8BD5\u3002`
    };
  }
  if (input.noOpen !== true) void launchBrowser(url);
  return { ok: true, url, port: reg.port, message: url };
}
function probePort(port) {
  return new Promise((resolve) => {
    const socket = net2.connect({ host: "127.0.0.1", port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(1500);
    socket.once("timeout", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
function launchBrowser(url) {
  const platform = process.platform;
  const [cmd, args] = platform === "darwin" ? ["open", [url]] : platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  return new Promise((resolve) => {
    execFile(cmd, [...args], { windowsHide: true }, () => resolve());
  });
}

// src/cli/sidebar-audit.ts
import fs12 from "node:fs";
import path13 from "node:path";

// src/sidebar/tasks-index.ts
import fs11 from "node:fs";
import os4 from "node:os";
import path12 from "node:path";
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";
var ANCHOR_TITLE = "Agent Team anchor";
function defaultTasksIndexPath() {
  return process.env.TEAM_TASKS_INDEX ?? path12.join(os4.homedir(), ".zcode", "v2", "tasks-index.sqlite");
}
function withRetry(fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return fn();
    } catch (err) {
      last = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!/SQLITE_BUSY|database is locked/i.test(message)) throw err;
      const until = Date.now() + 100 * (i + 1);
      while (Date.now() < until) {
      }
    }
  }
  throw last;
}
function readTask(dbPath, taskId) {
  if (!fs11.existsSync(dbPath)) return void 0;
  const db = new DatabaseSync2(dbPath, { readOnly: true });
  try {
    return db.prepare("select task_id, title, archived, deleted, workspace_path from tasks where task_id = ?").get(taskId);
  } finally {
    db.close();
  }
}
function tombstoneAnchor(input) {
  const dbPath = input.dbPath ?? defaultTasksIndexPath();
  if (!fs11.existsSync(dbPath)) return { applied: false, reason: "tasks-index-missing" };
  const now = input.now ?? Date.now();
  return withRetry(() => {
    const db = new DatabaseSync2(dbPath);
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare("select task_id, title, workspace_path from tasks where task_id = ?").get(input.taskId);
      if (existing !== void 0 && existing.workspace_path === input.workspacePath && existing.title !== "" && existing.title !== "Untitled session" && existing.title !== ANCHOR_TITLE) {
        db.exec("ROLLBACK");
        return { applied: false, reason: "row-not-owned" };
      }
      if (existing !== void 0 && existing.workspace_path !== input.workspacePath) {
        db.exec("ROLLBACK");
        return { applied: false, reason: "row-not-owned" };
      }
      const meta = JSON.stringify({
        taskId: input.taskId,
        title: ANCHOR_TITLE,
        workspacePath: input.workspacePath,
        createdAt: now,
        updatedAt: now,
        mode: "default",
        provider: "glm",
        status: "completed",
        titleOverridden: false
      });
      db.prepare(
        `INSERT INTO tasks (
           workspace_key, workspace_path, workspace_identity, task_id, title, task_status,
           provider, mode, model, migration_source, forked_from_task_id, cron_automation_id,
           off_peak_task_id, created_at, updated_at, unread_at, last_unread_at, pinned,
           archived, deleted, title_overridden, searchable_text, meta_json
         ) VALUES (
           @workspace_key, @workspace_path, NULL, @task_id, @title, 'completed',
           'glm', 'default', NULL, NULL, NULL, NULL,
           NULL, @now, @now, NULL, 0, 0,
           0, 1, 0, @searchable, @meta
         )
         ON CONFLICT(workspace_key, task_id) DO UPDATE SET
           deleted = 1,
           updated_at = excluded.updated_at
         WHERE tasks.task_id = excluded.task_id
           AND (tasks.title = '' OR tasks.title = 'Untitled session' OR tasks.title = @title)`
      ).run({
        workspace_key: input.workspacePath,
        workspace_path: input.workspacePath,
        task_id: input.taskId,
        title: ANCHOR_TITLE,
        now,
        searchable: ANCHOR_TITLE,
        meta
      });
      db.exec("COMMIT");
      return { applied: true };
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
      }
      throw err;
    } finally {
      db.close();
    }
  });
}
function archiveTask(input) {
  const dbPath = input.dbPath ?? defaultTasksIndexPath();
  if (!fs11.existsSync(dbPath)) return { applied: false, reason: "tasks-index-missing" };
  const now = input.now ?? Date.now();
  return withRetry(() => {
    const db = new DatabaseSync2(dbPath);
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      db.exec("BEGIN IMMEDIATE");
      const existing = db.prepare("select task_id, workspace_path, archived from tasks where task_id = ?").get(input.taskId);
      if (existing === void 0 || existing.workspace_path !== input.workspacePath) {
        db.exec("ROLLBACK");
        return { applied: false, reason: "row-not-owned" };
      }
      if (existing.archived === 1) {
        db.exec("COMMIT");
        return { applied: false };
      }
      db.prepare("update tasks set archived = 1, updated_at = ? where task_id = ?").run(now, input.taskId);
      db.exec("COMMIT");
      return { applied: true };
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
      }
      throw err;
    } finally {
      db.close();
    }
  });
}

// src/cli/sidebar-audit.ts
function listMemberIds(teamDir) {
  try {
    return fs12.readdirSync(path13.join(teamDir, "members")).filter((n) => !n.startsWith(".")).sort();
  } catch {
    return [];
  }
}
function auditSidebar(input) {
  const teamDir = path13.resolve(input.teamDir);
  const tasksIndexPath = input.tasksIndexPath ?? defaultTasksIndexPath();
  const dryRun = input.dryRun ?? true;
  const entries = [];
  const seenAnchors = /* @__PURE__ */ new Set();
  for (const memberId of listMemberIds(teamDir)) {
    const origin = readOrigin(memberPaths(teamDir, memberId));
    if (origin === void 0 || origin.sessionId === null) continue;
    const sessionId = origin.sessionId;
    const isolation = origin.sessionIsolation ?? "unknown";
    const row = readTask(tasksIndexPath, sessionId);
    const expectedWorkspace = path13.resolve(origin.cwd);
    const owned = row !== void 0 && path13.resolve(row.workspace_path) === expectedWorkspace;
    const needsArchive = owned && row.archived !== 1;
    let action;
    if (row === void 0) {
      action = "absent";
    } else if (!owned) {
      action = "mismatch";
    } else if (!needsArchive) {
      action = "already-archived";
    } else {
      action = dryRun ? "would-archive" : "archived";
    }
    entries.push({
      memberId,
      name: origin.name ?? null,
      sessionId,
      sessionIsolation: isolation,
      action,
      kind: "member",
      ...row !== void 0 ? { title: row.title } : {}
    });
    if (!dryRun && needsArchive) {
      const result = archiveTask({ taskId: sessionId, workspacePath: row.workspace_path, dbPath: tasksIndexPath });
      entries[entries.length - 1].action = result.applied ? "archived" : result.reason === "row-not-owned" ? "mismatch" : "absent";
    }
    const anchorId = origin.anchorSessionId;
    if (typeof anchorId === "string" && anchorId.length > 0 && !seenAnchors.has(anchorId)) {
      seenAnchors.add(anchorId);
      const anchorRow = readTask(tasksIndexPath, anchorId);
      const anchorOwned = anchorRow !== void 0 && path13.resolve(anchorRow.workspace_path) === expectedWorkspace;
      let anchorAction;
      if (anchorRow === void 0) {
        anchorAction = "absent";
      } else if (!anchorOwned) {
        anchorAction = "mismatch";
      } else if (anchorRow.deleted === 1) {
        anchorAction = "already-tombstoned";
      } else {
        anchorAction = dryRun ? "would-tombstone" : "tombstoned";
      }
      entries.push({
        memberId,
        name: origin.name ?? null,
        sessionId: anchorId,
        sessionIsolation: isolation,
        action: anchorAction,
        kind: "anchor",
        ...anchorRow !== void 0 ? { title: anchorRow.title } : {}
      });
      if (!dryRun && anchorOwned && anchorRow.deleted !== 1) {
        const result = tombstoneAnchor({
          taskId: anchorId,
          workspacePath: anchorRow.workspace_path,
          dbPath: tasksIndexPath
        });
        entries[entries.length - 1].action = result.applied ? "tombstoned" : result.reason === "row-not-owned" ? "mismatch" : "absent";
      }
    }
  }
  const applied = entries.filter((e) => e.action === "archived" || e.action === "tombstoned").length;
  const tombstoned = entries.filter((e) => e.action === "tombstoned").length;
  let ledgerPath = null;
  if (!dryRun) {
    ledgerPath = path13.join(teamDir, "sidebar-migration.json");
    const now = input.now ?? Date.now;
    const ledger = {
      kind: "sidebar-audit",
      version: 1,
      at: new Date(now()).toISOString(),
      tasksIndexPath,
      entries
    };
    writeAtomic(ledgerPath, ledger);
  }
  return { teamDir, tasksIndexPath, dryRun, entries, applied, tombstoned, ledgerPath };
}
function writeAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs12.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}
`, { mode: 384 });
  fs12.renameSync(tmp, file);
}
function renderSidebarAudit(result) {
  const lines = [];
  lines.push(`sidebar-audit ${result.teamDir}`);
  lines.push(`tasks-index: ${result.tasksIndexPath}`);
  lines.push(`mode: ${result.dryRun ? "dry-run\uFF08\u52A0 --apply \u624D\u5199\u5E93\uFF09" : "apply"}`);
  if (result.entries.length === 0) {
    lines.push("\uFF08\u6CA1\u6709\u5DF2\u843D\u5B9A\u7684\u6210\u5458\u4F1A\u8BDD\uFF09");
    return lines.join("\n");
  }
  for (const e of result.entries) {
    const label = e.name !== null ? `${e.name} (${e.memberId})` : e.memberId;
    const kind = e.kind === "anchor" ? "anchor" : "member";
    const title = e.title !== void 0 ? ` \xB7 ${e.title}` : "";
    lines.push(`- ${label} [${kind}/${e.sessionIsolation}] ${e.sessionId} \u2192 ${e.action}${title}`);
  }
  lines.push(
    result.dryRun ? `\u8BA1\u5212\u5F52\u6863 ${result.entries.filter((e) => e.action === "would-archive").length} \u6761\u3001tombstone ${result.entries.filter((e) => e.action === "would-tombstone").length} \u4E2A anchor\uFF1B\u672A\u5199\u5E93\u3002` : `\u5DF2\u5F52\u6863 ${result.applied - result.tombstoned} \u6761\u3001tombstone ${result.tombstoned} \u4E2A anchor\uFF1B\u53F0\u8D26 ${result.ledgerPath}`
  );
  return lines.join("\n");
}

// src/cli/main.ts
var USAGE = `team-ctl \u2014 Agent Teams \u8FD0\u7EF4/\u6392\u969C\u5DE5\u5177

\u7528\u6CD5\uFF1A
  team-ctl state <teamDir> [--json] [--team <id>]     \u8BFB\u76D8\u91CD\u653E\uFF1ARoster/Tasks/Mailbox \u5206\u533A\u89C6\u56FE
  team-ctl tail <teamDir> [--n <lines>]               \u8DDF\u968F events.jsonl\uFF08\u56DB\u7C7B\u4E8B\u4EF6\u7740\u8272\uFF0C\u672C\u5730\u65F6\u533A\uFF09
  team-ctl inject-event <teamDir> <json-line>         \u76F4\u5199\u539F\u59CB\u4E8B\u4EF6\u884C\uFF08test-only\uFF0C\u7ED5\u8FC7 journal\uFF09
  team-ctl inject-event <teamDir> --sample invalid-member --team <id>
                                                      \u6CE8\u5165\u975E\u6CD5 member \u4E8B\u4EF6\u6837\u4F8B\uFF08\u91CD\u653E \u2192 failure \u7EC8\u6001\uFF09
  team-ctl call <teamDir> <method> [params-json]      \u7ECF socket \u8C03\u534F\u8C03\u8005\uFF08\u65E0\u534F\u8C03\u8005 \u2192 \u53EF\u8BFB\u9519\u8BEF\uFF09
  team-ctl transcript <teamDir> <member> [--json] [--cursor <seq>] [--limit <n>] [--team <id>]
                                                      \u6210\u5458\u4F1A\u8BDD\u67E5\u770B\u6D41\uFF08T5.7 CLI \u5BF9\u7B49\uFF1B\u4E0E\u9762\u677F detail \u540C\u4E00\u5408\u6210\uFF09
  team-ctl widget <teamDir> [--out <file.html>] [--theme light|dark] [--lang zh|en] [--standalone]
                                                      ::visualize \u5FEB\u7167\u5361\u7247\u7247\u6BB5 / standalone \u9759\u6001\u9875\uFF08T5.3 CLI \u964D\u7EA7\u94FE\uFF09
  team-ctl open-panel [--no-open]                     \u6253\u5F00\u4F34\u751F\u9762\u677F\uFF08T5.5\uFF1Bdaemon \u9700\u4EE5 TEAM_COMPANION=1 \u8FD0\u884C\uFF09
  team-ctl sidebar-audit <teamDir> [--apply] [--json]  \u628A\u5DF2\u6CC4\u6F0F\u5230\u5DE6\u4FA7\u4EFB\u52A1\u680F\u7684\u6210\u5458\u4F1A\u8BDD\u5F52\u6863\uFF08\u9ED8\u8BA4 dry-run\uFF09`;
async function main(argv) {
  const [command, ...rest] = argv;
  if (command === void 0 || command === "help" || command === "--help") {
    process.stdout.write(USAGE + "\n");
    return command === void 0 ? 2 : 0;
  }
  try {
    switch (command) {
      case "state":
        return await cmdState(rest);
      case "tail":
        return await cmdTail(rest);
      case "inject-event":
        return cmdInject(rest);
      case "call":
        return await cmdCall(rest);
      case "transcript":
        return await cmdTranscript(rest);
      case "widget":
        return await cmdWidget(rest);
      case "open-panel":
        return await cmdOpenPanel(rest);
      case "sidebar-audit":
        return cmdSidebarAudit(rest);
      default:
        process.stderr.write(`team-ctl: \u672A\u77E5\u5B50\u547D\u4EE4 ${JSON.stringify(command)}

${USAGE}
`);
        return 2;
    }
  } catch (err) {
    const first = err instanceof Error ? err.message.split("\n")[0] : String(err);
    process.stderr.write(`team-ctl ${command}: ${first}
`);
    return 1;
  }
}
var invokedPath = process.argv[1];
if (invokedPath !== void 0 && import.meta.url === pathToFileURL(path14.resolve(invokedPath)).href) {
  process.exitCode = await main(process.argv.slice(2));
}
function takeFlag(rest, name) {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : void 0;
}
function resolveTeamId(teamDir, explicit) {
  if (explicit !== void 0) return explicit;
  const eventsFile = path14.join(teamDir, "events.jsonl");
  if (fs13.existsSync(eventsFile)) {
    const first = fs13.readFileSync(eventsFile, "utf8").split("\n", 1)[0];
    if (first !== void 0 && first.length > 0) {
      try {
        const parsed = JSON.parse(first);
        if (typeof parsed.event?.teamId === "string") return parsed.event.teamId;
      } catch {
      }
    }
  }
  const base = path14.basename(teamDir);
  if (base.length === 0) throw new Error("\u65E0\u6CD5\u63A8\u65AD teamId\uFF1A\u7A7A\u76EE\u5F55\u540D\uFF1B\u8BF7\u4F20 --team <id>");
  return base;
}
async function cmdState(rest) {
  const teamDir = rest[0];
  if (teamDir === void 0 || teamDir.startsWith("--")) {
    process.stderr.write("team-ctl state: \u9700\u8981 <teamDir>\n");
    return 2;
  }
  const json = rest.includes("--json");
  const teamId = resolveTeamId(teamDir, takeFlag(rest, "--team"));
  const loaded = await load(teamDir, teamId);
  process.stdout.write(renderState({ teamId, loaded, json }, paintForStream(process.stdout)) + "\n");
  return 0;
}
async function cmdTail(rest) {
  const teamDir = rest[0];
  if (teamDir === void 0 || teamDir.startsWith("--")) {
    process.stderr.write("team-ctl tail: \u9700\u8981 <teamDir>\n");
    return 2;
  }
  const nFlag = takeFlag(rest, "--n");
  const fromLines = nFlag !== void 0 ? Number(nFlag) : void 0;
  if (fromLines !== void 0 && (!Number.isInteger(fromLines) || fromLines < 0)) {
    process.stderr.write("team-ctl tail: --n \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570\n");
    return 2;
  }
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  await followEvents(eventsFileOf(teamDir), {
    fromLines,
    paint: paintForStream(process.stdout),
    signal: controller.signal,
    onLine: (formatted) => process.stdout.write(formatted + "\n")
  });
  return 0;
}
function cmdInject(rest) {
  const teamDir = rest[0];
  if (teamDir === void 0 || teamDir.startsWith("--")) {
    process.stderr.write("team-ctl inject-event: \u9700\u8981 <teamDir>\n");
    return 2;
  }
  const sample = takeFlag(rest, "--sample");
  let line = rest[1];
  if (sample === "invalid-member") {
    const teamId = resolveTeamId(teamDir, takeFlag(rest, "--team"));
    line = invalidMemberSample(teamId);
  } else if (sample !== void 0) {
    process.stderr.write(`team-ctl inject-event: \u672A\u77E5\u6837\u4F8B ${JSON.stringify(sample)}\uFF08\u53EF\u7528\uFF1Ainvalid-member\uFF09
`);
    return 2;
  }
  if (line === void 0 || line.startsWith("--")) {
    process.stderr.write("team-ctl inject-event: \u9700\u8981 <json-line>\uFF08\u6216 --sample invalid-member\uFF09\n");
    return 2;
  }
  const result = injectEvent(teamDir, line);
  process.stdout.write(
    [
      `test-only\uFF1A\u5DF2\u7ED5\u8FC7 journal \u76F4\u5199\uFF08\u65E0\u4E0D\u53D8\u91CF/\u65E0\u9501/\u65E0 fsync\uFF09`,
      `seq=${result.seq} file=${result.file}`,
      result.line,
      JSON.stringify({ tool: "team-ctl", action: "inject-event", teamDir, seq: result.seq, ok: true }),
      ""
    ].join("\n")
  );
  return 0;
}
async function cmdCall(rest) {
  const [teamDir, method, paramsJson] = rest;
  if (teamDir === void 0 || method === void 0 || teamDir.startsWith("--")) {
    process.stderr.write("team-ctl call: \u9700\u8981 <teamDir> <method> [params-json]\n");
    return 2;
  }
  const outcome = await callTeam(teamDir, method, paramsJson);
  process.stdout.write(outcome.output + "\n");
  process.stderr.write(outcome.audit + "\n");
  return outcome.ok ? 0 : 1;
}
async function cmdTranscript(rest) {
  const teamDir = rest[0];
  const member = rest[1];
  if (teamDir === void 0 || member === void 0 || teamDir.startsWith("--") || member.startsWith("--")) {
    process.stderr.write("team-ctl transcript: \u9700\u8981 <teamDir> <member>\n");
    return 2;
  }
  const teamId = resolveTeamId(teamDir, takeFlag(rest, "--team"));
  const loaded = await load(teamDir, teamId);
  const cursorFlag = takeFlag(rest, "--cursor");
  const limitFlag = takeFlag(rest, "--limit");
  const cursor = cursorFlag !== void 0 ? Number(cursorFlag) : void 0;
  const limit = limitFlag !== void 0 ? Number(limitFlag) : void 0;
  if (cursor !== void 0 && !Number.isSafeInteger(cursor)) {
    process.stderr.write("team-ctl transcript: --cursor \u5FC5\u987B\u662F\u5B89\u5168\u6574\u6570\n");
    return 2;
  }
  if (limit !== void 0 && !Number.isSafeInteger(limit)) {
    process.stderr.write("team-ctl transcript: --limit \u5FC5\u987B\u662F\u5B89\u5168\u6574\u6570\n");
    return 2;
  }
  const out = renderTranscript({
    teamDir,
    teamId,
    loaded,
    member,
    json: rest.includes("--json"),
    ...cursor !== void 0 ? { cursor } : {},
    ...limit !== void 0 ? { limit } : {}
  });
  process.stdout.write(out + "\n");
  return 0;
}
async function cmdWidget(rest) {
  const teamDir = rest[0];
  if (teamDir === void 0 || teamDir.startsWith("--")) {
    process.stderr.write("team-ctl widget: \u9700\u8981 <teamDir>\n");
    return 2;
  }
  const teamId = resolveTeamId(teamDir, takeFlag(rest, "--team"));
  const loaded = await load(teamDir, teamId);
  const theme = takeFlag(rest, "--theme");
  if (theme !== void 0 && theme !== "light" && theme !== "dark") {
    process.stderr.write("team-ctl widget: --theme \u4EC5\u652F\u6301 light|dark\n");
    return 2;
  }
  const langFlag = takeFlag(rest, "--lang");
  if (langFlag !== void 0 && langFlag !== "zh" && langFlag !== "en") {
    process.stderr.write("team-ctl widget: --lang \u4EC5\u652F\u6301 zh|en\n");
    return 2;
  }
  const result = renderWidget({
    teamDir,
    teamId,
    loaded,
    theme: theme ?? "light",
    lang: langFlag ?? "zh",
    standalone: rest.includes("--standalone"),
    ...takeFlag(rest, "--out") !== void 0 ? { out: takeFlag(rest, "--out") } : {}
  });
  if (result.out !== void 0) {
    process.stdout.write(`${result.out}
`);
  } else {
    process.stdout.write(result.html + "\n");
  }
  return 0;
}
function cmdSidebarAudit(rest) {
  const teamDir = rest[0];
  if (teamDir === void 0 || teamDir.startsWith("--")) {
    process.stderr.write("team-ctl sidebar-audit: \u9700\u8981 <teamDir>\n");
    return 2;
  }
  const result = auditSidebar({
    teamDir,
    dryRun: !rest.includes("--apply"),
    ...takeFlag(rest, "--tasks-index") !== void 0 ? { tasksIndexPath: takeFlag(rest, "--tasks-index") } : {}
  });
  process.stdout.write(
    rest.includes("--json") ? `${JSON.stringify(result, null, 2)}
` : `${renderSidebarAudit(result)}
`
  );
  return 0;
}
async function cmdOpenPanel(rest) {
  const result = await openPanel({ noOpen: rest.includes("--no-open") });
  process.stdout.write(result.message + "\n");
  return result.ok ? 0 : 1;
}
export {
  main
};
