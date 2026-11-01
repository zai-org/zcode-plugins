var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/ajv/dist/compile/codegen/code.js
var require_code = __commonJS({
  "node_modules/ajv/dist/compile/codegen/code.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.regexpCode = exports.getEsmExportName = exports.getProperty = exports.safeStringify = exports.stringify = exports.strConcat = exports.addCodeArg = exports.str = exports._ = exports.nil = exports._Code = exports.Name = exports.IDENTIFIER = exports._CodeOrName = void 0;
    var _CodeOrName = class {
    };
    exports._CodeOrName = _CodeOrName;
    exports.IDENTIFIER = /^[a-z$_][a-z$_0-9]*$/i;
    var Name = class extends _CodeOrName {
      constructor(s) {
        super();
        if (!exports.IDENTIFIER.test(s))
          throw new Error("CodeGen: name must be a valid identifier");
        this.str = s;
      }
      toString() {
        return this.str;
      }
      emptyStr() {
        return false;
      }
      get names() {
        return { [this.str]: 1 };
      }
    };
    exports.Name = Name;
    var _Code = class extends _CodeOrName {
      constructor(code) {
        super();
        this._items = typeof code === "string" ? [code] : code;
      }
      toString() {
        return this.str;
      }
      emptyStr() {
        if (this._items.length > 1)
          return false;
        const item = this._items[0];
        return item === "" || item === '""';
      }
      get str() {
        var _a;
        return (_a = this._str) !== null && _a !== void 0 ? _a : this._str = this._items.reduce((s, c) => `${s}${c}`, "");
      }
      get names() {
        var _a;
        return (_a = this._names) !== null && _a !== void 0 ? _a : this._names = this._items.reduce((names, c) => {
          if (c instanceof Name)
            names[c.str] = (names[c.str] || 0) + 1;
          return names;
        }, {});
      }
    };
    exports._Code = _Code;
    exports.nil = new _Code("");
    function _(strs, ...args) {
      const code = [strs[0]];
      let i = 0;
      while (i < args.length) {
        addCodeArg(code, args[i]);
        code.push(strs[++i]);
      }
      return new _Code(code);
    }
    exports._ = _;
    var plus = new _Code("+");
    function str(strs, ...args) {
      const expr = [safeStringify(strs[0])];
      let i = 0;
      while (i < args.length) {
        expr.push(plus);
        addCodeArg(expr, args[i]);
        expr.push(plus, safeStringify(strs[++i]));
      }
      optimize(expr);
      return new _Code(expr);
    }
    exports.str = str;
    function addCodeArg(code, arg) {
      if (arg instanceof _Code)
        code.push(...arg._items);
      else if (arg instanceof Name)
        code.push(arg);
      else
        code.push(interpolate(arg));
    }
    exports.addCodeArg = addCodeArg;
    function optimize(expr) {
      let i = 1;
      while (i < expr.length - 1) {
        if (expr[i] === plus) {
          const res = mergeExprItems(expr[i - 1], expr[i + 1]);
          if (res !== void 0) {
            expr.splice(i - 1, 3, res);
            continue;
          }
          expr[i++] = "+";
        }
        i++;
      }
    }
    function mergeExprItems(a, b) {
      if (b === '""')
        return a;
      if (a === '""')
        return b;
      if (typeof a == "string") {
        if (b instanceof Name || a[a.length - 1] !== '"')
          return;
        if (typeof b != "string")
          return `${a.slice(0, -1)}${b}"`;
        if (b[0] === '"')
          return a.slice(0, -1) + b.slice(1);
        return;
      }
      if (typeof b == "string" && b[0] === '"' && !(a instanceof Name))
        return `"${a}${b.slice(1)}`;
      return;
    }
    function strConcat(c1, c2) {
      return c2.emptyStr() ? c1 : c1.emptyStr() ? c2 : str`${c1}${c2}`;
    }
    exports.strConcat = strConcat;
    function interpolate(x) {
      return typeof x == "number" || typeof x == "boolean" || x === null ? x : safeStringify(Array.isArray(x) ? x.join(",") : x);
    }
    function stringify2(x) {
      return new _Code(safeStringify(x));
    }
    exports.stringify = stringify2;
    function safeStringify(x) {
      return JSON.stringify(x).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    }
    exports.safeStringify = safeStringify;
    function getProperty(key) {
      return typeof key == "string" && exports.IDENTIFIER.test(key) ? new _Code(`.${key}`) : _`[${key}]`;
    }
    exports.getProperty = getProperty;
    function getEsmExportName(key) {
      if (typeof key == "string" && exports.IDENTIFIER.test(key)) {
        return new _Code(`${key}`);
      }
      throw new Error(`CodeGen: invalid export name: ${key}, use explicit $id name mapping`);
    }
    exports.getEsmExportName = getEsmExportName;
    function regexpCode(rx) {
      return new _Code(rx.toString());
    }
    exports.regexpCode = regexpCode;
  }
});

// node_modules/ajv/dist/compile/codegen/scope.js
var require_scope = __commonJS({
  "node_modules/ajv/dist/compile/codegen/scope.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ValueScope = exports.ValueScopeName = exports.Scope = exports.varKinds = exports.UsedValueState = void 0;
    var code_1 = require_code();
    var ValueError = class extends Error {
      constructor(name) {
        super(`CodeGen: "code" for ${name} not defined`);
        this.value = name.value;
      }
    };
    var UsedValueState;
    (function(UsedValueState2) {
      UsedValueState2[UsedValueState2["Started"] = 0] = "Started";
      UsedValueState2[UsedValueState2["Completed"] = 1] = "Completed";
    })(UsedValueState || (exports.UsedValueState = UsedValueState = {}));
    exports.varKinds = {
      const: new code_1.Name("const"),
      let: new code_1.Name("let"),
      var: new code_1.Name("var")
    };
    var Scope = class {
      constructor({ prefixes, parent } = {}) {
        this._names = {};
        this._prefixes = prefixes;
        this._parent = parent;
      }
      toName(nameOrPrefix) {
        return nameOrPrefix instanceof code_1.Name ? nameOrPrefix : this.name(nameOrPrefix);
      }
      name(prefix) {
        return new code_1.Name(this._newName(prefix));
      }
      _newName(prefix) {
        const ng = this._names[prefix] || this._nameGroup(prefix);
        return `${prefix}${ng.index++}`;
      }
      _nameGroup(prefix) {
        var _a, _b;
        if (((_b = (_a = this._parent) === null || _a === void 0 ? void 0 : _a._prefixes) === null || _b === void 0 ? void 0 : _b.has(prefix)) || this._prefixes && !this._prefixes.has(prefix)) {
          throw new Error(`CodeGen: prefix "${prefix}" is not allowed in this scope`);
        }
        return this._names[prefix] = { prefix, index: 0 };
      }
    };
    exports.Scope = Scope;
    var ValueScopeName = class extends code_1.Name {
      constructor(prefix, nameStr) {
        super(nameStr);
        this.prefix = prefix;
      }
      setValue(value, { property, itemIndex }) {
        this.value = value;
        this.scopePath = (0, code_1._)`.${new code_1.Name(property)}[${itemIndex}]`;
      }
    };
    exports.ValueScopeName = ValueScopeName;
    var line = (0, code_1._)`\n`;
    var ValueScope = class extends Scope {
      constructor(opts) {
        super(opts);
        this._values = {};
        this._scope = opts.scope;
        this.opts = { ...opts, _n: opts.lines ? line : code_1.nil };
      }
      get() {
        return this._scope;
      }
      name(prefix) {
        return new ValueScopeName(prefix, this._newName(prefix));
      }
      value(nameOrPrefix, value) {
        var _a;
        if (value.ref === void 0)
          throw new Error("CodeGen: ref must be passed in value");
        const name = this.toName(nameOrPrefix);
        const { prefix } = name;
        const valueKey = (_a = value.key) !== null && _a !== void 0 ? _a : value.ref;
        let vs = this._values[prefix];
        if (vs) {
          const _name = vs.get(valueKey);
          if (_name)
            return _name;
        } else {
          vs = this._values[prefix] = /* @__PURE__ */ new Map();
        }
        vs.set(valueKey, name);
        const s = this._scope[prefix] || (this._scope[prefix] = []);
        const itemIndex = s.length;
        s[itemIndex] = value.ref;
        name.setValue(value, { property: prefix, itemIndex });
        return name;
      }
      getValue(prefix, keyOrRef) {
        const vs = this._values[prefix];
        if (!vs)
          return;
        return vs.get(keyOrRef);
      }
      scopeRefs(scopeName, values = this._values) {
        return this._reduceValues(values, (name) => {
          if (name.scopePath === void 0)
            throw new Error(`CodeGen: name "${name}" has no value`);
          return (0, code_1._)`${scopeName}${name.scopePath}`;
        });
      }
      scopeCode(values = this._values, usedValues, getCode) {
        return this._reduceValues(values, (name) => {
          if (name.value === void 0)
            throw new Error(`CodeGen: name "${name}" has no value`);
          return name.value.code;
        }, usedValues, getCode);
      }
      _reduceValues(values, valueCode, usedValues = {}, getCode) {
        let code = code_1.nil;
        for (const prefix in values) {
          const vs = values[prefix];
          if (!vs)
            continue;
          const nameSet = usedValues[prefix] = usedValues[prefix] || /* @__PURE__ */ new Map();
          vs.forEach((name) => {
            if (nameSet.has(name))
              return;
            nameSet.set(name, UsedValueState.Started);
            let c = valueCode(name);
            if (c) {
              const def = this.opts.es5 ? exports.varKinds.var : exports.varKinds.const;
              code = (0, code_1._)`${code}${def} ${name} = ${c};${this.opts._n}`;
            } else if (c = getCode === null || getCode === void 0 ? void 0 : getCode(name)) {
              code = (0, code_1._)`${code}${c}${this.opts._n}`;
            } else {
              throw new ValueError(name);
            }
            nameSet.set(name, UsedValueState.Completed);
          });
        }
        return code;
      }
    };
    exports.ValueScope = ValueScope;
  }
});

// node_modules/ajv/dist/compile/codegen/index.js
var require_codegen = __commonJS({
  "node_modules/ajv/dist/compile/codegen/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.or = exports.and = exports.not = exports.CodeGen = exports.operators = exports.varKinds = exports.ValueScopeName = exports.ValueScope = exports.Scope = exports.Name = exports.regexpCode = exports.stringify = exports.getProperty = exports.nil = exports.strConcat = exports.str = exports._ = void 0;
    var code_1 = require_code();
    var scope_1 = require_scope();
    var code_2 = require_code();
    Object.defineProperty(exports, "_", { enumerable: true, get: function() {
      return code_2._;
    } });
    Object.defineProperty(exports, "str", { enumerable: true, get: function() {
      return code_2.str;
    } });
    Object.defineProperty(exports, "strConcat", { enumerable: true, get: function() {
      return code_2.strConcat;
    } });
    Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
      return code_2.nil;
    } });
    Object.defineProperty(exports, "getProperty", { enumerable: true, get: function() {
      return code_2.getProperty;
    } });
    Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
      return code_2.stringify;
    } });
    Object.defineProperty(exports, "regexpCode", { enumerable: true, get: function() {
      return code_2.regexpCode;
    } });
    Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
      return code_2.Name;
    } });
    var scope_2 = require_scope();
    Object.defineProperty(exports, "Scope", { enumerable: true, get: function() {
      return scope_2.Scope;
    } });
    Object.defineProperty(exports, "ValueScope", { enumerable: true, get: function() {
      return scope_2.ValueScope;
    } });
    Object.defineProperty(exports, "ValueScopeName", { enumerable: true, get: function() {
      return scope_2.ValueScopeName;
    } });
    Object.defineProperty(exports, "varKinds", { enumerable: true, get: function() {
      return scope_2.varKinds;
    } });
    exports.operators = {
      GT: new code_1._Code(">"),
      GTE: new code_1._Code(">="),
      LT: new code_1._Code("<"),
      LTE: new code_1._Code("<="),
      EQ: new code_1._Code("==="),
      NEQ: new code_1._Code("!=="),
      NOT: new code_1._Code("!"),
      OR: new code_1._Code("||"),
      AND: new code_1._Code("&&"),
      ADD: new code_1._Code("+")
    };
    var Node = class {
      optimizeNodes() {
        return this;
      }
      optimizeNames(_names, _constants) {
        return this;
      }
    };
    var Def = class extends Node {
      constructor(varKind, name, rhs) {
        super();
        this.varKind = varKind;
        this.name = name;
        this.rhs = rhs;
      }
      render({ es5, _n }) {
        const varKind = es5 ? scope_1.varKinds.var : this.varKind;
        const rhs = this.rhs === void 0 ? "" : ` = ${this.rhs}`;
        return `${varKind} ${this.name}${rhs};` + _n;
      }
      optimizeNames(names, constants) {
        if (!names[this.name.str])
          return;
        if (this.rhs)
          this.rhs = optimizeExpr(this.rhs, names, constants);
        return this;
      }
      get names() {
        return this.rhs instanceof code_1._CodeOrName ? this.rhs.names : {};
      }
    };
    var Assign = class extends Node {
      constructor(lhs, rhs, sideEffects) {
        super();
        this.lhs = lhs;
        this.rhs = rhs;
        this.sideEffects = sideEffects;
      }
      render({ _n }) {
        return `${this.lhs} = ${this.rhs};` + _n;
      }
      optimizeNames(names, constants) {
        if (this.lhs instanceof code_1.Name && !names[this.lhs.str] && !this.sideEffects)
          return;
        this.rhs = optimizeExpr(this.rhs, names, constants);
        return this;
      }
      get names() {
        const names = this.lhs instanceof code_1.Name ? {} : { ...this.lhs.names };
        return addExprNames(names, this.rhs);
      }
    };
    var AssignOp = class extends Assign {
      constructor(lhs, op, rhs, sideEffects) {
        super(lhs, rhs, sideEffects);
        this.op = op;
      }
      render({ _n }) {
        return `${this.lhs} ${this.op}= ${this.rhs};` + _n;
      }
    };
    var Label = class extends Node {
      constructor(label) {
        super();
        this.label = label;
        this.names = {};
      }
      render({ _n }) {
        return `${this.label}:` + _n;
      }
    };
    var Break = class extends Node {
      constructor(label) {
        super();
        this.label = label;
        this.names = {};
      }
      render({ _n }) {
        const label = this.label ? ` ${this.label}` : "";
        return `break${label};` + _n;
      }
    };
    var Throw = class extends Node {
      constructor(error2) {
        super();
        this.error = error2;
      }
      render({ _n }) {
        return `throw ${this.error};` + _n;
      }
      get names() {
        return this.error.names;
      }
    };
    var AnyCode = class extends Node {
      constructor(code) {
        super();
        this.code = code;
      }
      render({ _n }) {
        return `${this.code};` + _n;
      }
      optimizeNodes() {
        return `${this.code}` ? this : void 0;
      }
      optimizeNames(names, constants) {
        this.code = optimizeExpr(this.code, names, constants);
        return this;
      }
      get names() {
        return this.code instanceof code_1._CodeOrName ? this.code.names : {};
      }
    };
    var ParentNode = class extends Node {
      constructor(nodes = []) {
        super();
        this.nodes = nodes;
      }
      render(opts) {
        return this.nodes.reduce((code, n) => code + n.render(opts), "");
      }
      optimizeNodes() {
        const { nodes } = this;
        let i = nodes.length;
        while (i--) {
          const n = nodes[i].optimizeNodes();
          if (Array.isArray(n))
            nodes.splice(i, 1, ...n);
          else if (n)
            nodes[i] = n;
          else
            nodes.splice(i, 1);
        }
        return nodes.length > 0 ? this : void 0;
      }
      optimizeNames(names, constants) {
        const { nodes } = this;
        let i = nodes.length;
        while (i--) {
          const n = nodes[i];
          if (n.optimizeNames(names, constants))
            continue;
          subtractNames(names, n.names);
          nodes.splice(i, 1);
        }
        return nodes.length > 0 ? this : void 0;
      }
      get names() {
        return this.nodes.reduce((names, n) => addNames(names, n.names), {});
      }
    };
    var BlockNode = class extends ParentNode {
      render(opts) {
        return "{" + opts._n + super.render(opts) + "}" + opts._n;
      }
    };
    var Root = class extends ParentNode {
    };
    var Else = class extends BlockNode {
    };
    Else.kind = "else";
    var If = class _If extends BlockNode {
      constructor(condition, nodes) {
        super(nodes);
        this.condition = condition;
      }
      render(opts) {
        let code = `if(${this.condition})` + super.render(opts);
        if (this.else)
          code += "else " + this.else.render(opts);
        return code;
      }
      optimizeNodes() {
        super.optimizeNodes();
        const cond = this.condition;
        if (cond === true)
          return this.nodes;
        let e = this.else;
        if (e) {
          const ns = e.optimizeNodes();
          e = this.else = Array.isArray(ns) ? new Else(ns) : ns;
        }
        if (e) {
          if (cond === false)
            return e instanceof _If ? e : e.nodes;
          if (this.nodes.length)
            return this;
          return new _If(not(cond), e instanceof _If ? [e] : e.nodes);
        }
        if (cond === false || !this.nodes.length)
          return void 0;
        return this;
      }
      optimizeNames(names, constants) {
        var _a;
        this.else = (_a = this.else) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants);
        if (!(super.optimizeNames(names, constants) || this.else))
          return;
        this.condition = optimizeExpr(this.condition, names, constants);
        return this;
      }
      get names() {
        const names = super.names;
        addExprNames(names, this.condition);
        if (this.else)
          addNames(names, this.else.names);
        return names;
      }
    };
    If.kind = "if";
    var For = class extends BlockNode {
    };
    For.kind = "for";
    var ForLoop = class extends For {
      constructor(iteration) {
        super();
        this.iteration = iteration;
      }
      render(opts) {
        return `for(${this.iteration})` + super.render(opts);
      }
      optimizeNames(names, constants) {
        if (!super.optimizeNames(names, constants))
          return;
        this.iteration = optimizeExpr(this.iteration, names, constants);
        return this;
      }
      get names() {
        return addNames(super.names, this.iteration.names);
      }
    };
    var ForRange = class extends For {
      constructor(varKind, name, from, to) {
        super();
        this.varKind = varKind;
        this.name = name;
        this.from = from;
        this.to = to;
      }
      render(opts) {
        const varKind = opts.es5 ? scope_1.varKinds.var : this.varKind;
        const { name, from, to } = this;
        return `for(${varKind} ${name}=${from}; ${name}<${to}; ${name}++)` + super.render(opts);
      }
      get names() {
        const names = addExprNames(super.names, this.from);
        return addExprNames(names, this.to);
      }
    };
    var ForIter = class extends For {
      constructor(loop, varKind, name, iterable) {
        super();
        this.loop = loop;
        this.varKind = varKind;
        this.name = name;
        this.iterable = iterable;
      }
      render(opts) {
        return `for(${this.varKind} ${this.name} ${this.loop} ${this.iterable})` + super.render(opts);
      }
      optimizeNames(names, constants) {
        if (!super.optimizeNames(names, constants))
          return;
        this.iterable = optimizeExpr(this.iterable, names, constants);
        return this;
      }
      get names() {
        return addNames(super.names, this.iterable.names);
      }
    };
    var Func = class extends BlockNode {
      constructor(name, args, async) {
        super();
        this.name = name;
        this.args = args;
        this.async = async;
      }
      render(opts) {
        const _async = this.async ? "async " : "";
        return `${_async}function ${this.name}(${this.args})` + super.render(opts);
      }
    };
    Func.kind = "func";
    var Return = class extends ParentNode {
      render(opts) {
        return "return " + super.render(opts);
      }
    };
    Return.kind = "return";
    var Try = class extends BlockNode {
      render(opts) {
        let code = "try" + super.render(opts);
        if (this.catch)
          code += this.catch.render(opts);
        if (this.finally)
          code += this.finally.render(opts);
        return code;
      }
      optimizeNodes() {
        var _a, _b;
        super.optimizeNodes();
        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNodes();
        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNodes();
        return this;
      }
      optimizeNames(names, constants) {
        var _a, _b;
        super.optimizeNames(names, constants);
        (_a = this.catch) === null || _a === void 0 ? void 0 : _a.optimizeNames(names, constants);
        (_b = this.finally) === null || _b === void 0 ? void 0 : _b.optimizeNames(names, constants);
        return this;
      }
      get names() {
        const names = super.names;
        if (this.catch)
          addNames(names, this.catch.names);
        if (this.finally)
          addNames(names, this.finally.names);
        return names;
      }
    };
    var Catch = class extends BlockNode {
      constructor(error2) {
        super();
        this.error = error2;
      }
      render(opts) {
        return `catch(${this.error})` + super.render(opts);
      }
    };
    Catch.kind = "catch";
    var Finally = class extends BlockNode {
      render(opts) {
        return "finally" + super.render(opts);
      }
    };
    Finally.kind = "finally";
    var CodeGen = class {
      constructor(extScope, opts = {}) {
        this._values = {};
        this._blockStarts = [];
        this._constants = {};
        this.opts = { ...opts, _n: opts.lines ? "\n" : "" };
        this._extScope = extScope;
        this._scope = new scope_1.Scope({ parent: extScope });
        this._nodes = [new Root()];
      }
      toString() {
        return this._root.render(this.opts);
      }
      // returns unique name in the internal scope
      name(prefix) {
        return this._scope.name(prefix);
      }
      // reserves unique name in the external scope
      scopeName(prefix) {
        return this._extScope.name(prefix);
      }
      // reserves unique name in the external scope and assigns value to it
      scopeValue(prefixOrName, value) {
        const name = this._extScope.value(prefixOrName, value);
        const vs = this._values[name.prefix] || (this._values[name.prefix] = /* @__PURE__ */ new Set());
        vs.add(name);
        return name;
      }
      getScopeValue(prefix, keyOrRef) {
        return this._extScope.getValue(prefix, keyOrRef);
      }
      // return code that assigns values in the external scope to the names that are used internally
      // (same names that were returned by gen.scopeName or gen.scopeValue)
      scopeRefs(scopeName) {
        return this._extScope.scopeRefs(scopeName, this._values);
      }
      scopeCode() {
        return this._extScope.scopeCode(this._values);
      }
      _def(varKind, nameOrPrefix, rhs, constant) {
        const name = this._scope.toName(nameOrPrefix);
        if (rhs !== void 0 && constant)
          this._constants[name.str] = rhs;
        this._leafNode(new Def(varKind, name, rhs));
        return name;
      }
      // `const` declaration (`var` in es5 mode)
      const(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.const, nameOrPrefix, rhs, _constant);
      }
      // `let` declaration with optional assignment (`var` in es5 mode)
      let(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.let, nameOrPrefix, rhs, _constant);
      }
      // `var` declaration with optional assignment
      var(nameOrPrefix, rhs, _constant) {
        return this._def(scope_1.varKinds.var, nameOrPrefix, rhs, _constant);
      }
      // assignment code
      assign(lhs, rhs, sideEffects) {
        return this._leafNode(new Assign(lhs, rhs, sideEffects));
      }
      // `+=` code
      add(lhs, rhs) {
        return this._leafNode(new AssignOp(lhs, exports.operators.ADD, rhs));
      }
      // appends passed SafeExpr to code or executes Block
      code(c) {
        if (typeof c == "function")
          c();
        else if (c !== code_1.nil)
          this._leafNode(new AnyCode(c));
        return this;
      }
      // returns code for object literal for the passed argument list of key-value pairs
      object(...keyValues) {
        const code = ["{"];
        for (const [key, value] of keyValues) {
          if (code.length > 1)
            code.push(",");
          code.push(key);
          if (key !== value || this.opts.es5) {
            code.push(":");
            (0, code_1.addCodeArg)(code, value);
          }
        }
        code.push("}");
        return new code_1._Code(code);
      }
      // `if` clause (or statement if `thenBody` and, optionally, `elseBody` are passed)
      if(condition, thenBody, elseBody) {
        this._blockNode(new If(condition));
        if (thenBody && elseBody) {
          this.code(thenBody).else().code(elseBody).endIf();
        } else if (thenBody) {
          this.code(thenBody).endIf();
        } else if (elseBody) {
          throw new Error('CodeGen: "else" body without "then" body');
        }
        return this;
      }
      // `else if` clause - invalid without `if` or after `else` clauses
      elseIf(condition) {
        return this._elseNode(new If(condition));
      }
      // `else` clause - only valid after `if` or `else if` clauses
      else() {
        return this._elseNode(new Else());
      }
      // end `if` statement (needed if gen.if was used only with condition)
      endIf() {
        return this._endBlockNode(If, Else);
      }
      _for(node, forBody) {
        this._blockNode(node);
        if (forBody)
          this.code(forBody).endFor();
        return this;
      }
      // a generic `for` clause (or statement if `forBody` is passed)
      for(iteration, forBody) {
        return this._for(new ForLoop(iteration), forBody);
      }
      // `for` statement for a range of values
      forRange(nameOrPrefix, from, to, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.let) {
        const name = this._scope.toName(nameOrPrefix);
        return this._for(new ForRange(varKind, name, from, to), () => forBody(name));
      }
      // `for-of` statement (in es5 mode replace with a normal for loop)
      forOf(nameOrPrefix, iterable, forBody, varKind = scope_1.varKinds.const) {
        const name = this._scope.toName(nameOrPrefix);
        if (this.opts.es5) {
          const arr = iterable instanceof code_1.Name ? iterable : this.var("_arr", iterable);
          return this.forRange("_i", 0, (0, code_1._)`${arr}.length`, (i) => {
            this.var(name, (0, code_1._)`${arr}[${i}]`);
            forBody(name);
          });
        }
        return this._for(new ForIter("of", varKind, name, iterable), () => forBody(name));
      }
      // `for-in` statement.
      // With option `ownProperties` replaced with a `for-of` loop for object keys
      forIn(nameOrPrefix, obj, forBody, varKind = this.opts.es5 ? scope_1.varKinds.var : scope_1.varKinds.const) {
        if (this.opts.ownProperties) {
          return this.forOf(nameOrPrefix, (0, code_1._)`Object.keys(${obj})`, forBody);
        }
        const name = this._scope.toName(nameOrPrefix);
        return this._for(new ForIter("in", varKind, name, obj), () => forBody(name));
      }
      // end `for` loop
      endFor() {
        return this._endBlockNode(For);
      }
      // `label` statement
      label(label) {
        return this._leafNode(new Label(label));
      }
      // `break` statement
      break(label) {
        return this._leafNode(new Break(label));
      }
      // `return` statement
      return(value) {
        const node = new Return();
        this._blockNode(node);
        this.code(value);
        if (node.nodes.length !== 1)
          throw new Error('CodeGen: "return" should have one node');
        return this._endBlockNode(Return);
      }
      // `try` statement
      try(tryBody, catchCode, finallyCode) {
        if (!catchCode && !finallyCode)
          throw new Error('CodeGen: "try" without "catch" and "finally"');
        const node = new Try();
        this._blockNode(node);
        this.code(tryBody);
        if (catchCode) {
          const error2 = this.name("e");
          this._currNode = node.catch = new Catch(error2);
          catchCode(error2);
        }
        if (finallyCode) {
          this._currNode = node.finally = new Finally();
          this.code(finallyCode);
        }
        return this._endBlockNode(Catch, Finally);
      }
      // `throw` statement
      throw(error2) {
        return this._leafNode(new Throw(error2));
      }
      // start self-balancing block
      block(body, nodeCount) {
        this._blockStarts.push(this._nodes.length);
        if (body)
          this.code(body).endBlock(nodeCount);
        return this;
      }
      // end the current self-balancing block
      endBlock(nodeCount) {
        const len = this._blockStarts.pop();
        if (len === void 0)
          throw new Error("CodeGen: not in self-balancing block");
        const toClose = this._nodes.length - len;
        if (toClose < 0 || nodeCount !== void 0 && toClose !== nodeCount) {
          throw new Error(`CodeGen: wrong number of nodes: ${toClose} vs ${nodeCount} expected`);
        }
        this._nodes.length = len;
        return this;
      }
      // `function` heading (or definition if funcBody is passed)
      func(name, args = code_1.nil, async, funcBody) {
        this._blockNode(new Func(name, args, async));
        if (funcBody)
          this.code(funcBody).endFunc();
        return this;
      }
      // end function definition
      endFunc() {
        return this._endBlockNode(Func);
      }
      optimize(n = 1) {
        while (n-- > 0) {
          this._root.optimizeNodes();
          this._root.optimizeNames(this._root.names, this._constants);
        }
      }
      _leafNode(node) {
        this._currNode.nodes.push(node);
        return this;
      }
      _blockNode(node) {
        this._currNode.nodes.push(node);
        this._nodes.push(node);
      }
      _endBlockNode(N1, N2) {
        const n = this._currNode;
        if (n instanceof N1 || N2 && n instanceof N2) {
          this._nodes.pop();
          return this;
        }
        throw new Error(`CodeGen: not in block "${N2 ? `${N1.kind}/${N2.kind}` : N1.kind}"`);
      }
      _elseNode(node) {
        const n = this._currNode;
        if (!(n instanceof If)) {
          throw new Error('CodeGen: "else" without "if"');
        }
        this._currNode = n.else = node;
        return this;
      }
      get _root() {
        return this._nodes[0];
      }
      get _currNode() {
        const ns = this._nodes;
        return ns[ns.length - 1];
      }
      set _currNode(node) {
        const ns = this._nodes;
        ns[ns.length - 1] = node;
      }
    };
    exports.CodeGen = CodeGen;
    function addNames(names, from) {
      for (const n in from)
        names[n] = (names[n] || 0) + (from[n] || 0);
      return names;
    }
    function addExprNames(names, from) {
      return from instanceof code_1._CodeOrName ? addNames(names, from.names) : names;
    }
    function optimizeExpr(expr, names, constants) {
      if (expr instanceof code_1.Name)
        return replaceName(expr);
      if (!canOptimize(expr))
        return expr;
      return new code_1._Code(expr._items.reduce((items, c) => {
        if (c instanceof code_1.Name)
          c = replaceName(c);
        if (c instanceof code_1._Code)
          items.push(...c._items);
        else
          items.push(c);
        return items;
      }, []));
      function replaceName(n) {
        const c = constants[n.str];
        if (c === void 0 || names[n.str] !== 1)
          return n;
        delete names[n.str];
        return c;
      }
      function canOptimize(e) {
        return e instanceof code_1._Code && e._items.some((c) => c instanceof code_1.Name && names[c.str] === 1 && constants[c.str] !== void 0);
      }
    }
    function subtractNames(names, from) {
      for (const n in from)
        names[n] = (names[n] || 0) - (from[n] || 0);
    }
    function not(x) {
      return typeof x == "boolean" || typeof x == "number" || x === null ? !x : (0, code_1._)`!${par(x)}`;
    }
    exports.not = not;
    var andCode = mappend(exports.operators.AND);
    function and(...args) {
      return args.reduce(andCode);
    }
    exports.and = and;
    var orCode = mappend(exports.operators.OR);
    function or(...args) {
      return args.reduce(orCode);
    }
    exports.or = or;
    function mappend(op) {
      return (x, y) => x === code_1.nil ? y : y === code_1.nil ? x : (0, code_1._)`${par(x)} ${op} ${par(y)}`;
    }
    function par(x) {
      return x instanceof code_1.Name ? x : (0, code_1._)`(${x})`;
    }
  }
});

// node_modules/ajv/dist/compile/util.js
var require_util = __commonJS({
  "node_modules/ajv/dist/compile/util.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.checkStrictMode = exports.getErrorPath = exports.Type = exports.useFunc = exports.setEvaluated = exports.evaluatedPropsToName = exports.mergeEvaluated = exports.eachItem = exports.unescapeJsonPointer = exports.escapeJsonPointer = exports.escapeFragment = exports.unescapeFragment = exports.schemaRefOrVal = exports.schemaHasRulesButRef = exports.schemaHasRules = exports.checkUnknownRules = exports.alwaysValidSchema = exports.toHash = void 0;
    var codegen_1 = require_codegen();
    var code_1 = require_code();
    function toHash(arr) {
      const hash = {};
      for (const item of arr)
        hash[item] = true;
      return hash;
    }
    exports.toHash = toHash;
    function alwaysValidSchema(it, schema) {
      if (typeof schema == "boolean")
        return schema;
      if (Object.keys(schema).length === 0)
        return true;
      checkUnknownRules(it, schema);
      return !schemaHasRules(schema, it.self.RULES.all);
    }
    exports.alwaysValidSchema = alwaysValidSchema;
    function checkUnknownRules(it, schema = it.schema) {
      const { opts, self } = it;
      if (!opts.strictSchema)
        return;
      if (typeof schema === "boolean")
        return;
      const rules = self.RULES.keywords;
      for (const key in schema) {
        if (!rules[key])
          checkStrictMode(it, `unknown keyword: "${key}"`);
      }
    }
    exports.checkUnknownRules = checkUnknownRules;
    function schemaHasRules(schema, rules) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (rules[key])
          return true;
      return false;
    }
    exports.schemaHasRules = schemaHasRules;
    function schemaHasRulesButRef(schema, RULES) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (key !== "$ref" && RULES.all[key])
          return true;
      return false;
    }
    exports.schemaHasRulesButRef = schemaHasRulesButRef;
    function schemaRefOrVal({ topSchemaRef, schemaPath }, schema, keyword, $data) {
      if (!$data) {
        if (typeof schema == "number" || typeof schema == "boolean")
          return schema;
        if (typeof schema == "string")
          return (0, codegen_1._)`${schema}`;
      }
      return (0, codegen_1._)`${topSchemaRef}${schemaPath}${(0, codegen_1.getProperty)(keyword)}`;
    }
    exports.schemaRefOrVal = schemaRefOrVal;
    function unescapeFragment(str) {
      return unescapeJsonPointer(decodeURIComponent(str));
    }
    exports.unescapeFragment = unescapeFragment;
    function escapeFragment(str) {
      return encodeURIComponent(escapeJsonPointer(str));
    }
    exports.escapeFragment = escapeFragment;
    function escapeJsonPointer(str) {
      if (typeof str == "number")
        return `${str}`;
      return str.replace(/~/g, "~0").replace(/\//g, "~1");
    }
    exports.escapeJsonPointer = escapeJsonPointer;
    function unescapeJsonPointer(str) {
      return str.replace(/~1/g, "/").replace(/~0/g, "~");
    }
    exports.unescapeJsonPointer = unescapeJsonPointer;
    function eachItem(xs, f) {
      if (Array.isArray(xs)) {
        for (const x of xs)
          f(x);
      } else {
        f(xs);
      }
    }
    exports.eachItem = eachItem;
    function makeMergeEvaluated({ mergeNames, mergeToName, mergeValues: mergeValues3, resultToName }) {
      return (gen, from, to, toName) => {
        const res = to === void 0 ? from : to instanceof codegen_1.Name ? (from instanceof codegen_1.Name ? mergeNames(gen, from, to) : mergeToName(gen, from, to), to) : from instanceof codegen_1.Name ? (mergeToName(gen, to, from), from) : mergeValues3(from, to);
        return toName === codegen_1.Name && !(res instanceof codegen_1.Name) ? resultToName(gen, res) : res;
      };
    }
    exports.mergeEvaluated = {
      props: makeMergeEvaluated({
        mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => {
          gen.if((0, codegen_1._)`${from} === true`, () => gen.assign(to, true), () => gen.assign(to, (0, codegen_1._)`${to} || {}`).code((0, codegen_1._)`Object.assign(${to}, ${from})`));
        }),
        mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => {
          if (from === true) {
            gen.assign(to, true);
          } else {
            gen.assign(to, (0, codegen_1._)`${to} || {}`);
            setEvaluated(gen, to, from);
          }
        }),
        mergeValues: (from, to) => from === true ? true : { ...from, ...to },
        resultToName: evaluatedPropsToName
      }),
      items: makeMergeEvaluated({
        mergeNames: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true && ${from} !== undefined`, () => gen.assign(to, (0, codegen_1._)`${from} === true ? true : ${to} > ${from} ? ${to} : ${from}`)),
        mergeToName: (gen, from, to) => gen.if((0, codegen_1._)`${to} !== true`, () => gen.assign(to, from === true ? true : (0, codegen_1._)`${to} > ${from} ? ${to} : ${from}`)),
        mergeValues: (from, to) => from === true ? true : Math.max(from, to),
        resultToName: (gen, items) => gen.var("items", items)
      })
    };
    function evaluatedPropsToName(gen, ps) {
      if (ps === true)
        return gen.var("props", true);
      const props = gen.var("props", (0, codegen_1._)`{}`);
      if (ps !== void 0)
        setEvaluated(gen, props, ps);
      return props;
    }
    exports.evaluatedPropsToName = evaluatedPropsToName;
    function setEvaluated(gen, props, ps) {
      Object.keys(ps).forEach((p) => gen.assign((0, codegen_1._)`${props}${(0, codegen_1.getProperty)(p)}`, true));
    }
    exports.setEvaluated = setEvaluated;
    var snippets = {};
    function useFunc(gen, f) {
      return gen.scopeValue("func", {
        ref: f,
        code: snippets[f.code] || (snippets[f.code] = new code_1._Code(f.code))
      });
    }
    exports.useFunc = useFunc;
    var Type;
    (function(Type2) {
      Type2[Type2["Num"] = 0] = "Num";
      Type2[Type2["Str"] = 1] = "Str";
    })(Type || (exports.Type = Type = {}));
    function getErrorPath(dataProp, dataPropType, jsPropertySyntax) {
      if (dataProp instanceof codegen_1.Name) {
        const isNumber = dataPropType === Type.Num;
        return jsPropertySyntax ? isNumber ? (0, codegen_1._)`"[" + ${dataProp} + "]"` : (0, codegen_1._)`"['" + ${dataProp} + "']"` : isNumber ? (0, codegen_1._)`"/" + ${dataProp}` : (0, codegen_1._)`"/" + ${dataProp}.replace(/~/g, "~0").replace(/\\//g, "~1")`;
      }
      return jsPropertySyntax ? (0, codegen_1.getProperty)(dataProp).toString() : "/" + escapeJsonPointer(dataProp);
    }
    exports.getErrorPath = getErrorPath;
    function checkStrictMode(it, msg, mode = it.opts.strictSchema) {
      if (!mode)
        return;
      msg = `strict mode: ${msg}`;
      if (mode === true)
        throw new Error(msg);
      it.self.logger.warn(msg);
    }
    exports.checkStrictMode = checkStrictMode;
  }
});

// node_modules/ajv/dist/compile/names.js
var require_names = __commonJS({
  "node_modules/ajv/dist/compile/names.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var names = {
      // validation function arguments
      data: new codegen_1.Name("data"),
      // data passed to validation function
      // args passed from referencing schema
      valCxt: new codegen_1.Name("valCxt"),
      // validation/data context - should not be used directly, it is destructured to the names below
      instancePath: new codegen_1.Name("instancePath"),
      parentData: new codegen_1.Name("parentData"),
      parentDataProperty: new codegen_1.Name("parentDataProperty"),
      rootData: new codegen_1.Name("rootData"),
      // root data - same as the data passed to the first/top validation function
      dynamicAnchors: new codegen_1.Name("dynamicAnchors"),
      // used to support recursiveRef and dynamicRef
      // function scoped variables
      vErrors: new codegen_1.Name("vErrors"),
      // null or array of validation errors
      errors: new codegen_1.Name("errors"),
      // counter of validation errors
      this: new codegen_1.Name("this"),
      // "globals"
      self: new codegen_1.Name("self"),
      scope: new codegen_1.Name("scope"),
      // JTD serialize/parse name for JSON string and position
      json: new codegen_1.Name("json"),
      jsonPos: new codegen_1.Name("jsonPos"),
      jsonLen: new codegen_1.Name("jsonLen"),
      jsonPart: new codegen_1.Name("jsonPart")
    };
    exports.default = names;
  }
});

// node_modules/ajv/dist/compile/errors.js
var require_errors = __commonJS({
  "node_modules/ajv/dist/compile/errors.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.extendErrors = exports.resetErrorsCount = exports.reportExtraError = exports.reportError = exports.keyword$DataError = exports.keywordError = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var names_1 = require_names();
    exports.keywordError = {
      message: ({ keyword }) => (0, codegen_1.str)`must pass "${keyword}" keyword validation`
    };
    exports.keyword$DataError = {
      message: ({ keyword, schemaType }) => schemaType ? (0, codegen_1.str)`"${keyword}" keyword must be ${schemaType} ($data)` : (0, codegen_1.str)`"${keyword}" keyword is invalid ($data)`
    };
    function reportError(cxt, error2 = exports.keywordError, errorPaths, overrideAllErrors) {
      const { it } = cxt;
      const { gen, compositeRule, allErrors } = it;
      const errObj = errorObjectCode(cxt, error2, errorPaths);
      if (overrideAllErrors !== null && overrideAllErrors !== void 0 ? overrideAllErrors : compositeRule || allErrors) {
        addError(gen, errObj);
      } else {
        returnErrors(it, (0, codegen_1._)`[${errObj}]`);
      }
    }
    exports.reportError = reportError;
    function reportExtraError(cxt, error2 = exports.keywordError, errorPaths) {
      const { it } = cxt;
      const { gen, compositeRule, allErrors } = it;
      const errObj = errorObjectCode(cxt, error2, errorPaths);
      addError(gen, errObj);
      if (!(compositeRule || allErrors)) {
        returnErrors(it, names_1.default.vErrors);
      }
    }
    exports.reportExtraError = reportExtraError;
    function resetErrorsCount(gen, errsCount) {
      gen.assign(names_1.default.errors, errsCount);
      gen.if((0, codegen_1._)`${names_1.default.vErrors} !== null`, () => gen.if(errsCount, () => gen.assign((0, codegen_1._)`${names_1.default.vErrors}.length`, errsCount), () => gen.assign(names_1.default.vErrors, null)));
    }
    exports.resetErrorsCount = resetErrorsCount;
    function extendErrors({ gen, keyword, schemaValue, data, errsCount, it }) {
      if (errsCount === void 0)
        throw new Error("ajv implementation error");
      const err = gen.name("err");
      gen.forRange("i", errsCount, names_1.default.errors, (i) => {
        gen.const(err, (0, codegen_1._)`${names_1.default.vErrors}[${i}]`);
        gen.if((0, codegen_1._)`${err}.instancePath === undefined`, () => gen.assign((0, codegen_1._)`${err}.instancePath`, (0, codegen_1.strConcat)(names_1.default.instancePath, it.errorPath)));
        gen.assign((0, codegen_1._)`${err}.schemaPath`, (0, codegen_1.str)`${it.errSchemaPath}/${keyword}`);
        if (it.opts.verbose) {
          gen.assign((0, codegen_1._)`${err}.schema`, schemaValue);
          gen.assign((0, codegen_1._)`${err}.data`, data);
        }
      });
    }
    exports.extendErrors = extendErrors;
    function addError(gen, errObj) {
      const err = gen.const("err", errObj);
      gen.if((0, codegen_1._)`${names_1.default.vErrors} === null`, () => gen.assign(names_1.default.vErrors, (0, codegen_1._)`[${err}]`), (0, codegen_1._)`${names_1.default.vErrors}.push(${err})`);
      gen.code((0, codegen_1._)`${names_1.default.errors}++`);
    }
    function returnErrors(it, errs) {
      const { gen, validateName, schemaEnv } = it;
      if (schemaEnv.$async) {
        gen.throw((0, codegen_1._)`new ${it.ValidationError}(${errs})`);
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, errs);
        gen.return(false);
      }
    }
    var E = {
      keyword: new codegen_1.Name("keyword"),
      schemaPath: new codegen_1.Name("schemaPath"),
      // also used in JTD errors
      params: new codegen_1.Name("params"),
      propertyName: new codegen_1.Name("propertyName"),
      message: new codegen_1.Name("message"),
      schema: new codegen_1.Name("schema"),
      parentSchema: new codegen_1.Name("parentSchema")
    };
    function errorObjectCode(cxt, error2, errorPaths) {
      const { createErrors } = cxt.it;
      if (createErrors === false)
        return (0, codegen_1._)`{}`;
      return errorObject(cxt, error2, errorPaths);
    }
    function errorObject(cxt, error2, errorPaths = {}) {
      const { gen, it } = cxt;
      const keyValues = [
        errorInstancePath(it, errorPaths),
        errorSchemaPath(cxt, errorPaths)
      ];
      extraErrorProps(cxt, error2, keyValues);
      return gen.object(...keyValues);
    }
    function errorInstancePath({ errorPath }, { instancePath }) {
      const instPath = instancePath ? (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(instancePath, util_1.Type.Str)}` : errorPath;
      return [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, instPath)];
    }
    function errorSchemaPath({ keyword, it: { errSchemaPath } }, { schemaPath, parentSchema }) {
      let schPath = parentSchema ? errSchemaPath : (0, codegen_1.str)`${errSchemaPath}/${keyword}`;
      if (schemaPath) {
        schPath = (0, codegen_1.str)`${schPath}${(0, util_1.getErrorPath)(schemaPath, util_1.Type.Str)}`;
      }
      return [E.schemaPath, schPath];
    }
    function extraErrorProps(cxt, { params, message }, keyValues) {
      const { keyword, data, schemaValue, it } = cxt;
      const { opts, propertyName, topSchemaRef, schemaPath } = it;
      keyValues.push([E.keyword, keyword], [E.params, typeof params == "function" ? params(cxt) : params || (0, codegen_1._)`{}`]);
      if (opts.messages) {
        keyValues.push([E.message, typeof message == "function" ? message(cxt) : message]);
      }
      if (opts.verbose) {
        keyValues.push([E.schema, schemaValue], [E.parentSchema, (0, codegen_1._)`${topSchemaRef}${schemaPath}`], [names_1.default.data, data]);
      }
      if (propertyName)
        keyValues.push([E.propertyName, propertyName]);
    }
  }
});

// node_modules/ajv/dist/compile/validate/boolSchema.js
var require_boolSchema = __commonJS({
  "node_modules/ajv/dist/compile/validate/boolSchema.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.boolOrEmptySchema = exports.topBoolOrEmptySchema = void 0;
    var errors_1 = require_errors();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var boolError = {
      message: "boolean schema is false"
    };
    function topBoolOrEmptySchema(it) {
      const { gen, schema, validateName } = it;
      if (schema === false) {
        falseSchemaError(it, false);
      } else if (typeof schema == "object" && schema.$async === true) {
        gen.return(names_1.default.data);
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, null);
        gen.return(true);
      }
    }
    exports.topBoolOrEmptySchema = topBoolOrEmptySchema;
    function boolOrEmptySchema(it, valid) {
      const { gen, schema } = it;
      if (schema === false) {
        gen.var(valid, false);
        falseSchemaError(it);
      } else {
        gen.var(valid, true);
      }
    }
    exports.boolOrEmptySchema = boolOrEmptySchema;
    function falseSchemaError(it, overrideAllErrors) {
      const { gen, data } = it;
      const cxt = {
        gen,
        keyword: "false schema",
        data,
        schema: false,
        schemaCode: false,
        schemaValue: false,
        params: {},
        it
      };
      (0, errors_1.reportError)(cxt, boolError, void 0, overrideAllErrors);
    }
  }
});

// node_modules/ajv/dist/compile/rules.js
var require_rules = __commonJS({
  "node_modules/ajv/dist/compile/rules.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getRules = exports.isJSONType = void 0;
    var _jsonTypes = ["string", "number", "integer", "boolean", "null", "object", "array"];
    var jsonTypes = new Set(_jsonTypes);
    function isJSONType(x) {
      return typeof x == "string" && jsonTypes.has(x);
    }
    exports.isJSONType = isJSONType;
    function getRules() {
      const groups = {
        number: { type: "number", rules: [] },
        string: { type: "string", rules: [] },
        array: { type: "array", rules: [] },
        object: { type: "object", rules: [] }
      };
      return {
        types: { ...groups, integer: true, boolean: true, null: true },
        rules: [{ rules: [] }, groups.number, groups.string, groups.array, groups.object],
        post: { rules: [] },
        all: {},
        keywords: {}
      };
    }
    exports.getRules = getRules;
  }
});

// node_modules/ajv/dist/compile/validate/applicability.js
var require_applicability = __commonJS({
  "node_modules/ajv/dist/compile/validate/applicability.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.shouldUseRule = exports.shouldUseGroup = exports.schemaHasRulesForType = void 0;
    function schemaHasRulesForType({ schema, self }, type) {
      const group = self.RULES.types[type];
      return group && group !== true && shouldUseGroup(schema, group);
    }
    exports.schemaHasRulesForType = schemaHasRulesForType;
    function shouldUseGroup(schema, group) {
      return group.rules.some((rule) => shouldUseRule(schema, rule));
    }
    exports.shouldUseGroup = shouldUseGroup;
    function shouldUseRule(schema, rule) {
      var _a;
      return schema[rule.keyword] !== void 0 || ((_a = rule.definition.implements) === null || _a === void 0 ? void 0 : _a.some((kwd) => schema[kwd] !== void 0));
    }
    exports.shouldUseRule = shouldUseRule;
  }
});

// node_modules/ajv/dist/compile/validate/dataType.js
var require_dataType = __commonJS({
  "node_modules/ajv/dist/compile/validate/dataType.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.reportTypeError = exports.checkDataTypes = exports.checkDataType = exports.coerceAndCheckDataType = exports.getJSONTypes = exports.getSchemaTypes = exports.DataType = void 0;
    var rules_1 = require_rules();
    var applicability_1 = require_applicability();
    var errors_1 = require_errors();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var DataType;
    (function(DataType2) {
      DataType2[DataType2["Correct"] = 0] = "Correct";
      DataType2[DataType2["Wrong"] = 1] = "Wrong";
    })(DataType || (exports.DataType = DataType = {}));
    function getSchemaTypes(schema) {
      const types = getJSONTypes(schema.type);
      const hasNull = types.includes("null");
      if (hasNull) {
        if (schema.nullable === false)
          throw new Error("type: null contradicts nullable: false");
      } else {
        if (!types.length && schema.nullable !== void 0) {
          throw new Error('"nullable" cannot be used without "type"');
        }
        if (schema.nullable === true)
          types.push("null");
      }
      return types;
    }
    exports.getSchemaTypes = getSchemaTypes;
    function getJSONTypes(ts2) {
      const types = Array.isArray(ts2) ? ts2 : ts2 ? [ts2] : [];
      if (types.every(rules_1.isJSONType))
        return types;
      throw new Error("type must be JSONType or JSONType[]: " + types.join(","));
    }
    exports.getJSONTypes = getJSONTypes;
    function coerceAndCheckDataType(it, types) {
      const { gen, data, opts } = it;
      const coerceTo = coerceToTypes(types, opts.coerceTypes);
      const checkTypes = types.length > 0 && !(coerceTo.length === 0 && types.length === 1 && (0, applicability_1.schemaHasRulesForType)(it, types[0]));
      if (checkTypes) {
        const wrongType = checkDataTypes(types, data, opts.strictNumbers, DataType.Wrong);
        gen.if(wrongType, () => {
          if (coerceTo.length)
            coerceData(it, types, coerceTo);
          else
            reportTypeError(it);
        });
      }
      return checkTypes;
    }
    exports.coerceAndCheckDataType = coerceAndCheckDataType;
    var COERCIBLE = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean", "null"]);
    function coerceToTypes(types, coerceTypes) {
      return coerceTypes ? types.filter((t) => COERCIBLE.has(t) || coerceTypes === "array" && t === "array") : [];
    }
    function coerceData(it, types, coerceTo) {
      const { gen, data, opts } = it;
      const dataType = gen.let("dataType", (0, codegen_1._)`typeof ${data}`);
      const coerced = gen.let("coerced", (0, codegen_1._)`undefined`);
      if (opts.coerceTypes === "array") {
        gen.if((0, codegen_1._)`${dataType} == 'object' && Array.isArray(${data}) && ${data}.length == 1`, () => gen.assign(data, (0, codegen_1._)`${data}[0]`).assign(dataType, (0, codegen_1._)`typeof ${data}`).if(checkDataTypes(types, data, opts.strictNumbers), () => gen.assign(coerced, data)));
      }
      gen.if((0, codegen_1._)`${coerced} !== undefined`);
      for (const t of coerceTo) {
        if (COERCIBLE.has(t) || t === "array" && opts.coerceTypes === "array") {
          coerceSpecificType(t);
        }
      }
      gen.else();
      reportTypeError(it);
      gen.endIf();
      gen.if((0, codegen_1._)`${coerced} !== undefined`, () => {
        gen.assign(data, coerced);
        assignParentData(it, coerced);
      });
      function coerceSpecificType(t) {
        switch (t) {
          case "string":
            gen.elseIf((0, codegen_1._)`${dataType} == "number" || ${dataType} == "boolean"`).assign(coerced, (0, codegen_1._)`"" + ${data}`).elseIf((0, codegen_1._)`${data} === null`).assign(coerced, (0, codegen_1._)`""`);
            return;
          case "number":
            gen.elseIf((0, codegen_1._)`${dataType} == "boolean" || ${data} === null
              || (${dataType} == "string" && ${data} && ${data} == +${data})`).assign(coerced, (0, codegen_1._)`+${data}`);
            return;
          case "integer":
            gen.elseIf((0, codegen_1._)`${dataType} === "boolean" || ${data} === null
              || (${dataType} === "string" && ${data} && ${data} == +${data} && !(${data} % 1))`).assign(coerced, (0, codegen_1._)`+${data}`);
            return;
          case "boolean":
            gen.elseIf((0, codegen_1._)`${data} === "false" || ${data} === 0 || ${data} === null`).assign(coerced, false).elseIf((0, codegen_1._)`${data} === "true" || ${data} === 1`).assign(coerced, true);
            return;
          case "null":
            gen.elseIf((0, codegen_1._)`${data} === "" || ${data} === 0 || ${data} === false`);
            gen.assign(coerced, null);
            return;
          case "array":
            gen.elseIf((0, codegen_1._)`${dataType} === "string" || ${dataType} === "number"
              || ${dataType} === "boolean" || ${data} === null`).assign(coerced, (0, codegen_1._)`[${data}]`);
        }
      }
    }
    function assignParentData({ gen, parentData, parentDataProperty }, expr) {
      gen.if((0, codegen_1._)`${parentData} !== undefined`, () => gen.assign((0, codegen_1._)`${parentData}[${parentDataProperty}]`, expr));
    }
    function checkDataType(dataType, data, strictNums, correct = DataType.Correct) {
      const EQ = correct === DataType.Correct ? codegen_1.operators.EQ : codegen_1.operators.NEQ;
      let cond;
      switch (dataType) {
        case "null":
          return (0, codegen_1._)`${data} ${EQ} null`;
        case "array":
          cond = (0, codegen_1._)`Array.isArray(${data})`;
          break;
        case "object":
          cond = (0, codegen_1._)`${data} && typeof ${data} == "object" && !Array.isArray(${data})`;
          break;
        case "integer":
          cond = numCond((0, codegen_1._)`!(${data} % 1) && !isNaN(${data})`);
          break;
        case "number":
          cond = numCond();
          break;
        default:
          return (0, codegen_1._)`typeof ${data} ${EQ} ${dataType}`;
      }
      return correct === DataType.Correct ? cond : (0, codegen_1.not)(cond);
      function numCond(_cond = codegen_1.nil) {
        return (0, codegen_1.and)((0, codegen_1._)`typeof ${data} == "number"`, _cond, strictNums ? (0, codegen_1._)`isFinite(${data})` : codegen_1.nil);
      }
    }
    exports.checkDataType = checkDataType;
    function checkDataTypes(dataTypes, data, strictNums, correct) {
      if (dataTypes.length === 1) {
        return checkDataType(dataTypes[0], data, strictNums, correct);
      }
      let cond;
      const types = (0, util_1.toHash)(dataTypes);
      if (types.array && types.object) {
        const notObj = (0, codegen_1._)`typeof ${data} != "object"`;
        cond = types.null ? notObj : (0, codegen_1._)`!${data} || ${notObj}`;
        delete types.null;
        delete types.array;
        delete types.object;
      } else {
        cond = codegen_1.nil;
      }
      if (types.number)
        delete types.integer;
      for (const t in types)
        cond = (0, codegen_1.and)(cond, checkDataType(t, data, strictNums, correct));
      return cond;
    }
    exports.checkDataTypes = checkDataTypes;
    var typeError = {
      message: ({ schema }) => `must be ${schema}`,
      params: ({ schema, schemaValue }) => typeof schema == "string" ? (0, codegen_1._)`{type: ${schema}}` : (0, codegen_1._)`{type: ${schemaValue}}`
    };
    function reportTypeError(it) {
      const cxt = getTypeErrorContext(it);
      (0, errors_1.reportError)(cxt, typeError);
    }
    exports.reportTypeError = reportTypeError;
    function getTypeErrorContext(it) {
      const { gen, data, schema } = it;
      const schemaCode = (0, util_1.schemaRefOrVal)(it, schema, "type");
      return {
        gen,
        keyword: "type",
        data,
        schema: schema.type,
        schemaCode,
        schemaValue: schemaCode,
        parentSchema: schema,
        params: {},
        it
      };
    }
  }
});

// node_modules/ajv/dist/compile/validate/defaults.js
var require_defaults = __commonJS({
  "node_modules/ajv/dist/compile/validate/defaults.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.assignDefaults = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    function assignDefaults(it, ty) {
      const { properties, items } = it.schema;
      if (ty === "object" && properties) {
        for (const key in properties) {
          assignDefault(it, key, properties[key].default);
        }
      } else if (ty === "array" && Array.isArray(items)) {
        items.forEach((sch, i) => assignDefault(it, i, sch.default));
      }
    }
    exports.assignDefaults = assignDefaults;
    function assignDefault(it, prop, defaultValue) {
      const { gen, compositeRule, data, opts } = it;
      if (defaultValue === void 0)
        return;
      const childData = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(prop)}`;
      if (compositeRule) {
        (0, util_1.checkStrictMode)(it, `default is ignored for: ${childData}`);
        return;
      }
      let condition = (0, codegen_1._)`${childData} === undefined`;
      if (opts.useDefaults === "empty") {
        condition = (0, codegen_1._)`${condition} || ${childData} === null || ${childData} === ""`;
      }
      gen.if(condition, (0, codegen_1._)`${childData} = ${(0, codegen_1.stringify)(defaultValue)}`);
    }
  }
});

// node_modules/ajv/dist/vocabularies/code.js
var require_code2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/code.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateUnion = exports.validateArray = exports.usePattern = exports.callValidateCode = exports.schemaProperties = exports.allSchemaProperties = exports.noPropertyInData = exports.propertyInData = exports.isOwnProperty = exports.hasPropFunc = exports.reportMissingProp = exports.checkMissingProp = exports.checkReportMissingProp = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var names_1 = require_names();
    var util_2 = require_util();
    function checkReportMissingProp(cxt, prop) {
      const { gen, data, it } = cxt;
      gen.if(noPropertyInData(gen, data, prop, it.opts.ownProperties), () => {
        cxt.setParams({ missingProperty: (0, codegen_1._)`${prop}` }, true);
        cxt.error();
      });
    }
    exports.checkReportMissingProp = checkReportMissingProp;
    function checkMissingProp({ gen, data, it: { opts } }, properties, missing) {
      return (0, codegen_1.or)(...properties.map((prop) => (0, codegen_1.and)(noPropertyInData(gen, data, prop, opts.ownProperties), (0, codegen_1._)`${missing} = ${prop}`)));
    }
    exports.checkMissingProp = checkMissingProp;
    function reportMissingProp(cxt, missing) {
      cxt.setParams({ missingProperty: missing }, true);
      cxt.error();
    }
    exports.reportMissingProp = reportMissingProp;
    function hasPropFunc(gen) {
      return gen.scopeValue("func", {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        ref: Object.prototype.hasOwnProperty,
        code: (0, codegen_1._)`Object.prototype.hasOwnProperty`
      });
    }
    exports.hasPropFunc = hasPropFunc;
    function isOwnProperty(gen, data, property) {
      return (0, codegen_1._)`${hasPropFunc(gen)}.call(${data}, ${property})`;
    }
    exports.isOwnProperty = isOwnProperty;
    function propertyInData(gen, data, property, ownProperties) {
      const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} !== undefined`;
      return ownProperties ? (0, codegen_1._)`${cond} && ${isOwnProperty(gen, data, property)}` : cond;
    }
    exports.propertyInData = propertyInData;
    function noPropertyInData(gen, data, property, ownProperties) {
      const cond = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(property)} === undefined`;
      return ownProperties ? (0, codegen_1.or)(cond, (0, codegen_1.not)(isOwnProperty(gen, data, property))) : cond;
    }
    exports.noPropertyInData = noPropertyInData;
    function allSchemaProperties(schemaMap) {
      return schemaMap ? Object.keys(schemaMap).filter((p) => p !== "__proto__") : [];
    }
    exports.allSchemaProperties = allSchemaProperties;
    function schemaProperties(it, schemaMap) {
      return allSchemaProperties(schemaMap).filter((p) => !(0, util_1.alwaysValidSchema)(it, schemaMap[p]));
    }
    exports.schemaProperties = schemaProperties;
    function callValidateCode({ schemaCode, data, it: { gen, topSchemaRef, schemaPath, errorPath }, it }, func, context, passSchema) {
      const dataAndSchema = passSchema ? (0, codegen_1._)`${schemaCode}, ${data}, ${topSchemaRef}${schemaPath}` : data;
      const valCxt = [
        [names_1.default.instancePath, (0, codegen_1.strConcat)(names_1.default.instancePath, errorPath)],
        [names_1.default.parentData, it.parentData],
        [names_1.default.parentDataProperty, it.parentDataProperty],
        [names_1.default.rootData, names_1.default.rootData]
      ];
      if (it.opts.dynamicRef)
        valCxt.push([names_1.default.dynamicAnchors, names_1.default.dynamicAnchors]);
      const args = (0, codegen_1._)`${dataAndSchema}, ${gen.object(...valCxt)}`;
      return context !== codegen_1.nil ? (0, codegen_1._)`${func}.call(${context}, ${args})` : (0, codegen_1._)`${func}(${args})`;
    }
    exports.callValidateCode = callValidateCode;
    var newRegExp = (0, codegen_1._)`new RegExp`;
    function usePattern({ gen, it: { opts } }, pattern) {
      const u = opts.unicodeRegExp ? "u" : "";
      const { regExp } = opts.code;
      const rx = regExp(pattern, u);
      return gen.scopeValue("pattern", {
        key: rx.toString(),
        ref: rx,
        code: (0, codegen_1._)`${regExp.code === "new RegExp" ? newRegExp : (0, util_2.useFunc)(gen, regExp)}(${pattern}, ${u})`
      });
    }
    exports.usePattern = usePattern;
    function validateArray(cxt) {
      const { gen, data, keyword, it } = cxt;
      const valid = gen.name("valid");
      if (it.allErrors) {
        const validArr = gen.let("valid", true);
        validateItems(() => gen.assign(validArr, false));
        return validArr;
      }
      gen.var(valid, true);
      validateItems(() => gen.break());
      return valid;
      function validateItems(notValid) {
        const len = gen.const("len", (0, codegen_1._)`${data}.length`);
        gen.forRange("i", 0, len, (i) => {
          cxt.subschema({
            keyword,
            dataProp: i,
            dataPropType: util_1.Type.Num
          }, valid);
          gen.if((0, codegen_1.not)(valid), notValid);
        });
      }
    }
    exports.validateArray = validateArray;
    function validateUnion(cxt) {
      const { gen, schema, keyword, it } = cxt;
      if (!Array.isArray(schema))
        throw new Error("ajv implementation error");
      const alwaysValid = schema.some((sch) => (0, util_1.alwaysValidSchema)(it, sch));
      if (alwaysValid && !it.opts.unevaluated)
        return;
      const valid = gen.let("valid", false);
      const schValid = gen.name("_valid");
      gen.block(() => schema.forEach((_sch, i) => {
        const schCxt = cxt.subschema({
          keyword,
          schemaProp: i,
          compositeRule: true
        }, schValid);
        gen.assign(valid, (0, codegen_1._)`${valid} || ${schValid}`);
        const merged = cxt.mergeValidEvaluated(schCxt, schValid);
        if (!merged)
          gen.if((0, codegen_1.not)(valid));
      }));
      cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
    }
    exports.validateUnion = validateUnion;
  }
});

// node_modules/ajv/dist/compile/validate/keyword.js
var require_keyword = __commonJS({
  "node_modules/ajv/dist/compile/validate/keyword.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateKeywordUsage = exports.validSchemaType = exports.funcKeywordCode = exports.macroKeywordCode = void 0;
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var code_1 = require_code2();
    var errors_1 = require_errors();
    function macroKeywordCode(cxt, def) {
      const { gen, keyword, schema, parentSchema, it } = cxt;
      const macroSchema = def.macro.call(it.self, schema, parentSchema, it);
      const schemaRef = useKeyword(gen, keyword, macroSchema);
      if (it.opts.validateSchema !== false)
        it.self.validateSchema(macroSchema, true);
      const valid = gen.name("valid");
      cxt.subschema({
        schema: macroSchema,
        schemaPath: codegen_1.nil,
        errSchemaPath: `${it.errSchemaPath}/${keyword}`,
        topSchemaRef: schemaRef,
        compositeRule: true
      }, valid);
      cxt.pass(valid, () => cxt.error(true));
    }
    exports.macroKeywordCode = macroKeywordCode;
    function funcKeywordCode(cxt, def) {
      var _a;
      const { gen, keyword, schema, parentSchema, $data, it } = cxt;
      checkAsyncKeyword(it, def);
      const validate = !$data && def.compile ? def.compile.call(it.self, schema, parentSchema, it) : def.validate;
      const validateRef = useKeyword(gen, keyword, validate);
      const valid = gen.let("valid");
      cxt.block$data(valid, validateKeyword);
      cxt.ok((_a = def.valid) !== null && _a !== void 0 ? _a : valid);
      function validateKeyword() {
        if (def.errors === false) {
          assignValid();
          if (def.modifying)
            modifyData(cxt);
          reportErrs(() => cxt.error());
        } else {
          const ruleErrs = def.async ? validateAsync() : validateSync();
          if (def.modifying)
            modifyData(cxt);
          reportErrs(() => addErrs(cxt, ruleErrs));
        }
      }
      function validateAsync() {
        const ruleErrs = gen.let("ruleErrs", null);
        gen.try(() => assignValid((0, codegen_1._)`await `), (e) => gen.assign(valid, false).if((0, codegen_1._)`${e} instanceof ${it.ValidationError}`, () => gen.assign(ruleErrs, (0, codegen_1._)`${e}.errors`), () => gen.throw(e)));
        return ruleErrs;
      }
      function validateSync() {
        const validateErrs = (0, codegen_1._)`${validateRef}.errors`;
        gen.assign(validateErrs, null);
        assignValid(codegen_1.nil);
        return validateErrs;
      }
      function assignValid(_await = def.async ? (0, codegen_1._)`await ` : codegen_1.nil) {
        const passCxt = it.opts.passContext ? names_1.default.this : names_1.default.self;
        const passSchema = !("compile" in def && !$data || def.schema === false);
        gen.assign(valid, (0, codegen_1._)`${_await}${(0, code_1.callValidateCode)(cxt, validateRef, passCxt, passSchema)}`, def.modifying);
      }
      function reportErrs(errors) {
        var _a2;
        gen.if((0, codegen_1.not)((_a2 = def.valid) !== null && _a2 !== void 0 ? _a2 : valid), errors);
      }
    }
    exports.funcKeywordCode = funcKeywordCode;
    function modifyData(cxt) {
      const { gen, data, it } = cxt;
      gen.if(it.parentData, () => gen.assign(data, (0, codegen_1._)`${it.parentData}[${it.parentDataProperty}]`));
    }
    function addErrs(cxt, errs) {
      const { gen } = cxt;
      gen.if((0, codegen_1._)`Array.isArray(${errs})`, () => {
        gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`).assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
        (0, errors_1.extendErrors)(cxt);
      }, () => cxt.error());
    }
    function checkAsyncKeyword({ schemaEnv }, def) {
      if (def.async && !schemaEnv.$async)
        throw new Error("async keyword in sync schema");
    }
    function useKeyword(gen, keyword, result) {
      if (result === void 0)
        throw new Error(`keyword "${keyword}" failed to compile`);
      return gen.scopeValue("keyword", typeof result == "function" ? { ref: result } : { ref: result, code: (0, codegen_1.stringify)(result) });
    }
    function validSchemaType(schema, schemaType, allowUndefined = false) {
      return !schemaType.length || schemaType.some((st) => st === "array" ? Array.isArray(schema) : st === "object" ? schema && typeof schema == "object" && !Array.isArray(schema) : typeof schema == st || allowUndefined && typeof schema == "undefined");
    }
    exports.validSchemaType = validSchemaType;
    function validateKeywordUsage({ schema, opts, self, errSchemaPath }, def, keyword) {
      if (Array.isArray(def.keyword) ? !def.keyword.includes(keyword) : def.keyword !== keyword) {
        throw new Error("ajv implementation error");
      }
      const deps = def.dependencies;
      if (deps === null || deps === void 0 ? void 0 : deps.some((kwd) => !Object.prototype.hasOwnProperty.call(schema, kwd))) {
        throw new Error(`parent schema must have dependencies of ${keyword}: ${deps.join(",")}`);
      }
      if (def.validateSchema) {
        const valid = def.validateSchema(schema[keyword]);
        if (!valid) {
          const msg = `keyword "${keyword}" value is invalid at path "${errSchemaPath}": ` + self.errorsText(def.validateSchema.errors);
          if (opts.validateSchema === "log")
            self.logger.error(msg);
          else
            throw new Error(msg);
        }
      }
    }
    exports.validateKeywordUsage = validateKeywordUsage;
  }
});

// node_modules/ajv/dist/compile/validate/subschema.js
var require_subschema = __commonJS({
  "node_modules/ajv/dist/compile/validate/subschema.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.extendSubschemaMode = exports.extendSubschemaData = exports.getSubschema = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    function getSubschema(it, { keyword, schemaProp, schema, schemaPath, errSchemaPath, topSchemaRef }) {
      if (keyword !== void 0 && schema !== void 0) {
        throw new Error('both "keyword" and "schema" passed, only one allowed');
      }
      if (keyword !== void 0) {
        const sch = it.schema[keyword];
        return schemaProp === void 0 ? {
          schema: sch,
          schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}`,
          errSchemaPath: `${it.errSchemaPath}/${keyword}`
        } : {
          schema: sch[schemaProp],
          schemaPath: (0, codegen_1._)`${it.schemaPath}${(0, codegen_1.getProperty)(keyword)}${(0, codegen_1.getProperty)(schemaProp)}`,
          errSchemaPath: `${it.errSchemaPath}/${keyword}/${(0, util_1.escapeFragment)(schemaProp)}`
        };
      }
      if (schema !== void 0) {
        if (schemaPath === void 0 || errSchemaPath === void 0 || topSchemaRef === void 0) {
          throw new Error('"schemaPath", "errSchemaPath" and "topSchemaRef" are required with "schema"');
        }
        return {
          schema,
          schemaPath,
          topSchemaRef,
          errSchemaPath
        };
      }
      throw new Error('either "keyword" or "schema" must be passed');
    }
    exports.getSubschema = getSubschema;
    function extendSubschemaData(subschema, it, { dataProp, dataPropType: dpType, data, dataTypes, propertyName }) {
      if (data !== void 0 && dataProp !== void 0) {
        throw new Error('both "data" and "dataProp" passed, only one allowed');
      }
      const { gen } = it;
      if (dataProp !== void 0) {
        const { errorPath, dataPathArr, opts } = it;
        const nextData = gen.let("data", (0, codegen_1._)`${it.data}${(0, codegen_1.getProperty)(dataProp)}`, true);
        dataContextProps(nextData);
        subschema.errorPath = (0, codegen_1.str)`${errorPath}${(0, util_1.getErrorPath)(dataProp, dpType, opts.jsPropertySyntax)}`;
        subschema.parentDataProperty = (0, codegen_1._)`${dataProp}`;
        subschema.dataPathArr = [...dataPathArr, subschema.parentDataProperty];
      }
      if (data !== void 0) {
        const nextData = data instanceof codegen_1.Name ? data : gen.let("data", data, true);
        dataContextProps(nextData);
        if (propertyName !== void 0)
          subschema.propertyName = propertyName;
      }
      if (dataTypes)
        subschema.dataTypes = dataTypes;
      function dataContextProps(_nextData) {
        subschema.data = _nextData;
        subschema.dataLevel = it.dataLevel + 1;
        subschema.dataTypes = [];
        it.definedProperties = /* @__PURE__ */ new Set();
        subschema.parentData = it.data;
        subschema.dataNames = [...it.dataNames, _nextData];
      }
    }
    exports.extendSubschemaData = extendSubschemaData;
    function extendSubschemaMode(subschema, { jtdDiscriminator, jtdMetadata, compositeRule, createErrors, allErrors }) {
      if (compositeRule !== void 0)
        subschema.compositeRule = compositeRule;
      if (createErrors !== void 0)
        subschema.createErrors = createErrors;
      if (allErrors !== void 0)
        subschema.allErrors = allErrors;
      subschema.jtdDiscriminator = jtdDiscriminator;
      subschema.jtdMetadata = jtdMetadata;
    }
    exports.extendSubschemaMode = extendSubschemaMode;
  }
});

// node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS({
  "node_modules/fast-deep-equal/index.js"(exports, module) {
    "use strict";
    module.exports = function equal(a, b) {
      if (a === b) return true;
      if (a && b && typeof a == "object" && typeof b == "object") {
        if (a.constructor !== b.constructor) return false;
        var length, i, keys;
        if (Array.isArray(a)) {
          length = a.length;
          if (length != b.length) return false;
          for (i = length; i-- !== 0; )
            if (!equal(a[i], b[i])) return false;
          return true;
        }
        if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
        if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
        if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
        keys = Object.keys(a);
        length = keys.length;
        if (length !== Object.keys(b).length) return false;
        for (i = length; i-- !== 0; )
          if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
        for (i = length; i-- !== 0; ) {
          var key = keys[i];
          if (!equal(a[key], b[key])) return false;
        }
        return true;
      }
      return a !== a && b !== b;
    };
  }
});

// node_modules/json-schema-traverse/index.js
var require_json_schema_traverse = __commonJS({
  "node_modules/json-schema-traverse/index.js"(exports, module) {
    "use strict";
    var traverse = module.exports = function(schema, opts, cb) {
      if (typeof opts == "function") {
        cb = opts;
        opts = {};
      }
      cb = opts.cb || cb;
      var pre = typeof cb == "function" ? cb : cb.pre || function() {
      };
      var post = cb.post || function() {
      };
      _traverse(opts, pre, post, schema, "", schema);
    };
    traverse.keywords = {
      additionalItems: true,
      items: true,
      contains: true,
      additionalProperties: true,
      propertyNames: true,
      not: true,
      if: true,
      then: true,
      else: true
    };
    traverse.arrayKeywords = {
      items: true,
      allOf: true,
      anyOf: true,
      oneOf: true
    };
    traverse.propsKeywords = {
      $defs: true,
      definitions: true,
      properties: true,
      patternProperties: true,
      dependencies: true
    };
    traverse.skipKeywords = {
      default: true,
      enum: true,
      const: true,
      required: true,
      maximum: true,
      minimum: true,
      exclusiveMaximum: true,
      exclusiveMinimum: true,
      multipleOf: true,
      maxLength: true,
      minLength: true,
      pattern: true,
      format: true,
      maxItems: true,
      minItems: true,
      uniqueItems: true,
      maxProperties: true,
      minProperties: true
    };
    function _traverse(opts, pre, post, schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex) {
      if (schema && typeof schema == "object" && !Array.isArray(schema)) {
        pre(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
        for (var key in schema) {
          var sch = schema[key];
          if (Array.isArray(sch)) {
            if (key in traverse.arrayKeywords) {
              for (var i = 0; i < sch.length; i++)
                _traverse(opts, pre, post, sch[i], jsonPtr + "/" + key + "/" + i, rootSchema, jsonPtr, key, schema, i);
            }
          } else if (key in traverse.propsKeywords) {
            if (sch && typeof sch == "object") {
              for (var prop in sch)
                _traverse(opts, pre, post, sch[prop], jsonPtr + "/" + key + "/" + escapeJsonPtr(prop), rootSchema, jsonPtr, key, schema, prop);
            }
          } else if (key in traverse.keywords || opts.allKeys && !(key in traverse.skipKeywords)) {
            _traverse(opts, pre, post, sch, jsonPtr + "/" + key, rootSchema, jsonPtr, key, schema);
          }
        }
        post(schema, jsonPtr, rootSchema, parentJsonPtr, parentKeyword, parentSchema, keyIndex);
      }
    }
    function escapeJsonPtr(str) {
      return str.replace(/~/g, "~0").replace(/\//g, "~1");
    }
  }
});

// node_modules/ajv/dist/compile/resolve.js
var require_resolve = __commonJS({
  "node_modules/ajv/dist/compile/resolve.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getSchemaRefs = exports.resolveUrl = exports.normalizeId = exports._getFullPath = exports.getFullPath = exports.inlineRef = void 0;
    var util_1 = require_util();
    var equal = require_fast_deep_equal();
    var traverse = require_json_schema_traverse();
    var SIMPLE_INLINED = /* @__PURE__ */ new Set([
      "type",
      "format",
      "pattern",
      "maxLength",
      "minLength",
      "maxProperties",
      "minProperties",
      "maxItems",
      "minItems",
      "maximum",
      "minimum",
      "uniqueItems",
      "multipleOf",
      "required",
      "enum",
      "const"
    ]);
    function inlineRef(schema, limit = true) {
      if (typeof schema == "boolean")
        return true;
      if (limit === true)
        return !hasRef(schema);
      if (!limit)
        return false;
      return countKeys(schema) <= limit;
    }
    exports.inlineRef = inlineRef;
    var REF_KEYWORDS = /* @__PURE__ */ new Set([
      "$ref",
      "$recursiveRef",
      "$recursiveAnchor",
      "$dynamicRef",
      "$dynamicAnchor"
    ]);
    function hasRef(schema) {
      for (const key in schema) {
        if (REF_KEYWORDS.has(key))
          return true;
        const sch = schema[key];
        if (Array.isArray(sch) && sch.some(hasRef))
          return true;
        if (typeof sch == "object" && hasRef(sch))
          return true;
      }
      return false;
    }
    function countKeys(schema) {
      let count = 0;
      for (const key in schema) {
        if (key === "$ref")
          return Infinity;
        count++;
        if (SIMPLE_INLINED.has(key))
          continue;
        if (typeof schema[key] == "object") {
          (0, util_1.eachItem)(schema[key], (sch) => count += countKeys(sch));
        }
        if (count === Infinity)
          return Infinity;
      }
      return count;
    }
    function getFullPath(resolver, id = "", normalize) {
      if (normalize !== false)
        id = normalizeId(id);
      const p = resolver.parse(id);
      return _getFullPath(resolver, p);
    }
    exports.getFullPath = getFullPath;
    function _getFullPath(resolver, p) {
      const serialized = resolver.serialize(p);
      return serialized.split("#")[0] + "#";
    }
    exports._getFullPath = _getFullPath;
    var TRAILING_SLASH_HASH = /#\/?$/;
    function normalizeId(id) {
      return id ? id.replace(TRAILING_SLASH_HASH, "") : "";
    }
    exports.normalizeId = normalizeId;
    function resolveUrl(resolver, baseId, id) {
      id = normalizeId(id);
      return resolver.resolve(baseId, id);
    }
    exports.resolveUrl = resolveUrl;
    var ANCHOR = /^[a-z_][-a-z0-9._]*$/i;
    function getSchemaRefs(schema, baseId) {
      if (typeof schema == "boolean")
        return {};
      const { schemaId, uriResolver } = this.opts;
      const schId = normalizeId(schema[schemaId] || baseId);
      const baseIds = { "": schId };
      const pathPrefix = getFullPath(uriResolver, schId, false);
      const localRefs = {};
      const schemaRefs = /* @__PURE__ */ new Set();
      traverse(schema, { allKeys: true }, (sch, jsonPtr, _, parentJsonPtr) => {
        if (parentJsonPtr === void 0)
          return;
        const fullPath = pathPrefix + jsonPtr;
        let innerBaseId = baseIds[parentJsonPtr];
        if (typeof sch[schemaId] == "string")
          innerBaseId = addRef.call(this, sch[schemaId]);
        addAnchor.call(this, sch.$anchor);
        addAnchor.call(this, sch.$dynamicAnchor);
        baseIds[jsonPtr] = innerBaseId;
        function addRef(ref) {
          const _resolve = this.opts.uriResolver.resolve;
          ref = normalizeId(innerBaseId ? _resolve(innerBaseId, ref) : ref);
          if (schemaRefs.has(ref))
            throw ambiguos(ref);
          schemaRefs.add(ref);
          let schOrRef = this.refs[ref];
          if (typeof schOrRef == "string")
            schOrRef = this.refs[schOrRef];
          if (typeof schOrRef == "object") {
            checkAmbiguosRef(sch, schOrRef.schema, ref);
          } else if (ref !== normalizeId(fullPath)) {
            if (ref[0] === "#") {
              checkAmbiguosRef(sch, localRefs[ref], ref);
              localRefs[ref] = sch;
            } else {
              this.refs[ref] = fullPath;
            }
          }
          return ref;
        }
        function addAnchor(anchor) {
          if (typeof anchor == "string") {
            if (!ANCHOR.test(anchor))
              throw new Error(`invalid anchor "${anchor}"`);
            addRef.call(this, `#${anchor}`);
          }
        }
      });
      return localRefs;
      function checkAmbiguosRef(sch1, sch2, ref) {
        if (sch2 !== void 0 && !equal(sch1, sch2))
          throw ambiguos(ref);
      }
      function ambiguos(ref) {
        return new Error(`reference "${ref}" resolves to more than one schema`);
      }
    }
    exports.getSchemaRefs = getSchemaRefs;
  }
});

// node_modules/ajv/dist/compile/validate/index.js
var require_validate = __commonJS({
  "node_modules/ajv/dist/compile/validate/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.getData = exports.KeywordCxt = exports.validateFunctionCode = void 0;
    var boolSchema_1 = require_boolSchema();
    var dataType_1 = require_dataType();
    var applicability_1 = require_applicability();
    var dataType_2 = require_dataType();
    var defaults_1 = require_defaults();
    var keyword_1 = require_keyword();
    var subschema_1 = require_subschema();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var resolve_1 = require_resolve();
    var util_1 = require_util();
    var errors_1 = require_errors();
    function validateFunctionCode(it) {
      if (isSchemaObj(it)) {
        checkKeywords(it);
        if (schemaCxtHasRules(it)) {
          topSchemaObjCode(it);
          return;
        }
      }
      validateFunction(it, () => (0, boolSchema_1.topBoolOrEmptySchema)(it));
    }
    exports.validateFunctionCode = validateFunctionCode;
    function validateFunction({ gen, validateName, schema, schemaEnv, opts }, body) {
      if (opts.code.es5) {
        gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${names_1.default.valCxt}`, schemaEnv.$async, () => {
          gen.code((0, codegen_1._)`"use strict"; ${funcSourceUrl(schema, opts)}`);
          destructureValCxtES5(gen, opts);
          gen.code(body);
        });
      } else {
        gen.func(validateName, (0, codegen_1._)`${names_1.default.data}, ${destructureValCxt(opts)}`, schemaEnv.$async, () => gen.code(funcSourceUrl(schema, opts)).code(body));
      }
    }
    function destructureValCxt(opts) {
      return (0, codegen_1._)`{${names_1.default.instancePath}="", ${names_1.default.parentData}, ${names_1.default.parentDataProperty}, ${names_1.default.rootData}=${names_1.default.data}${opts.dynamicRef ? (0, codegen_1._)`, ${names_1.default.dynamicAnchors}={}` : codegen_1.nil}}={}`;
    }
    function destructureValCxtES5(gen, opts) {
      gen.if(names_1.default.valCxt, () => {
        gen.var(names_1.default.instancePath, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.instancePath}`);
        gen.var(names_1.default.parentData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentData}`);
        gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.parentDataProperty}`);
        gen.var(names_1.default.rootData, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.rootData}`);
        if (opts.dynamicRef)
          gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`${names_1.default.valCxt}.${names_1.default.dynamicAnchors}`);
      }, () => {
        gen.var(names_1.default.instancePath, (0, codegen_1._)`""`);
        gen.var(names_1.default.parentData, (0, codegen_1._)`undefined`);
        gen.var(names_1.default.parentDataProperty, (0, codegen_1._)`undefined`);
        gen.var(names_1.default.rootData, names_1.default.data);
        if (opts.dynamicRef)
          gen.var(names_1.default.dynamicAnchors, (0, codegen_1._)`{}`);
      });
    }
    function topSchemaObjCode(it) {
      const { schema, opts, gen } = it;
      validateFunction(it, () => {
        if (opts.$comment && schema.$comment)
          commentKeyword(it);
        checkNoDefault(it);
        gen.let(names_1.default.vErrors, null);
        gen.let(names_1.default.errors, 0);
        if (opts.unevaluated)
          resetEvaluated(it);
        typeAndKeywords(it);
        returnResults(it);
      });
      return;
    }
    function resetEvaluated(it) {
      const { gen, validateName } = it;
      it.evaluated = gen.const("evaluated", (0, codegen_1._)`${validateName}.evaluated`);
      gen.if((0, codegen_1._)`${it.evaluated}.dynamicProps`, () => gen.assign((0, codegen_1._)`${it.evaluated}.props`, (0, codegen_1._)`undefined`));
      gen.if((0, codegen_1._)`${it.evaluated}.dynamicItems`, () => gen.assign((0, codegen_1._)`${it.evaluated}.items`, (0, codegen_1._)`undefined`));
    }
    function funcSourceUrl(schema, opts) {
      const schId = typeof schema == "object" && schema[opts.schemaId];
      return schId && (opts.code.source || opts.code.process) ? (0, codegen_1._)`/*# sourceURL=${schId} */` : codegen_1.nil;
    }
    function subschemaCode(it, valid) {
      if (isSchemaObj(it)) {
        checkKeywords(it);
        if (schemaCxtHasRules(it)) {
          subSchemaObjCode(it, valid);
          return;
        }
      }
      (0, boolSchema_1.boolOrEmptySchema)(it, valid);
    }
    function schemaCxtHasRules({ schema, self }) {
      if (typeof schema == "boolean")
        return !schema;
      for (const key in schema)
        if (self.RULES.all[key])
          return true;
      return false;
    }
    function isSchemaObj(it) {
      return typeof it.schema != "boolean";
    }
    function subSchemaObjCode(it, valid) {
      const { schema, gen, opts } = it;
      if (opts.$comment && schema.$comment)
        commentKeyword(it);
      updateContext(it);
      checkAsyncSchema(it);
      const errsCount = gen.const("_errs", names_1.default.errors);
      typeAndKeywords(it, errsCount);
      gen.var(valid, (0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
    }
    function checkKeywords(it) {
      (0, util_1.checkUnknownRules)(it);
      checkRefsAndKeywords(it);
    }
    function typeAndKeywords(it, errsCount) {
      if (it.opts.jtd)
        return schemaKeywords(it, [], false, errsCount);
      const types = (0, dataType_1.getSchemaTypes)(it.schema);
      const checkedTypes = (0, dataType_1.coerceAndCheckDataType)(it, types);
      schemaKeywords(it, types, !checkedTypes, errsCount);
    }
    function checkRefsAndKeywords(it) {
      const { schema, errSchemaPath, opts, self } = it;
      if (schema.$ref && opts.ignoreKeywordsWithRef && (0, util_1.schemaHasRulesButRef)(schema, self.RULES)) {
        self.logger.warn(`$ref: keywords ignored in schema at path "${errSchemaPath}"`);
      }
    }
    function checkNoDefault(it) {
      const { schema, opts } = it;
      if (schema.default !== void 0 && opts.useDefaults && opts.strictSchema) {
        (0, util_1.checkStrictMode)(it, "default is ignored in the schema root");
      }
    }
    function updateContext(it) {
      const schId = it.schema[it.opts.schemaId];
      if (schId)
        it.baseId = (0, resolve_1.resolveUrl)(it.opts.uriResolver, it.baseId, schId);
    }
    function checkAsyncSchema(it) {
      if (it.schema.$async && !it.schemaEnv.$async)
        throw new Error("async schema in sync schema");
    }
    function commentKeyword({ gen, schemaEnv, schema, errSchemaPath, opts }) {
      const msg = schema.$comment;
      if (opts.$comment === true) {
        gen.code((0, codegen_1._)`${names_1.default.self}.logger.log(${msg})`);
      } else if (typeof opts.$comment == "function") {
        const schemaPath = (0, codegen_1.str)`${errSchemaPath}/$comment`;
        const rootName = gen.scopeValue("root", { ref: schemaEnv.root });
        gen.code((0, codegen_1._)`${names_1.default.self}.opts.$comment(${msg}, ${schemaPath}, ${rootName}.schema)`);
      }
    }
    function returnResults(it) {
      const { gen, schemaEnv, validateName, ValidationError, opts } = it;
      if (schemaEnv.$async) {
        gen.if((0, codegen_1._)`${names_1.default.errors} === 0`, () => gen.return(names_1.default.data), () => gen.throw((0, codegen_1._)`new ${ValidationError}(${names_1.default.vErrors})`));
      } else {
        gen.assign((0, codegen_1._)`${validateName}.errors`, names_1.default.vErrors);
        if (opts.unevaluated)
          assignEvaluated(it);
        gen.return((0, codegen_1._)`${names_1.default.errors} === 0`);
      }
    }
    function assignEvaluated({ gen, evaluated, props, items }) {
      if (props instanceof codegen_1.Name)
        gen.assign((0, codegen_1._)`${evaluated}.props`, props);
      if (items instanceof codegen_1.Name)
        gen.assign((0, codegen_1._)`${evaluated}.items`, items);
    }
    function schemaKeywords(it, types, typeErrors, errsCount) {
      const { gen, schema, data, allErrors, opts, self } = it;
      const { RULES } = self;
      if (schema.$ref && (opts.ignoreKeywordsWithRef || !(0, util_1.schemaHasRulesButRef)(schema, RULES))) {
        gen.block(() => keywordCode(it, "$ref", RULES.all.$ref.definition));
        return;
      }
      if (!opts.jtd)
        checkStrictTypes(it, types);
      gen.block(() => {
        for (const group of RULES.rules)
          groupKeywords(group);
        groupKeywords(RULES.post);
      });
      function groupKeywords(group) {
        if (!(0, applicability_1.shouldUseGroup)(schema, group))
          return;
        if (group.type) {
          gen.if((0, dataType_2.checkDataType)(group.type, data, opts.strictNumbers));
          iterateKeywords(it, group);
          if (types.length === 1 && types[0] === group.type && typeErrors) {
            gen.else();
            (0, dataType_2.reportTypeError)(it);
          }
          gen.endIf();
        } else {
          iterateKeywords(it, group);
        }
        if (!allErrors)
          gen.if((0, codegen_1._)`${names_1.default.errors} === ${errsCount || 0}`);
      }
    }
    function iterateKeywords(it, group) {
      const { gen, schema, opts: { useDefaults } } = it;
      if (useDefaults)
        (0, defaults_1.assignDefaults)(it, group.type);
      gen.block(() => {
        for (const rule of group.rules) {
          if ((0, applicability_1.shouldUseRule)(schema, rule)) {
            keywordCode(it, rule.keyword, rule.definition, group.type);
          }
        }
      });
    }
    function checkStrictTypes(it, types) {
      if (it.schemaEnv.meta || !it.opts.strictTypes)
        return;
      checkContextTypes(it, types);
      if (!it.opts.allowUnionTypes)
        checkMultipleTypes(it, types);
      checkKeywordTypes(it, it.dataTypes);
    }
    function checkContextTypes(it, types) {
      if (!types.length)
        return;
      if (!it.dataTypes.length) {
        it.dataTypes = types;
        return;
      }
      types.forEach((t) => {
        if (!includesType(it.dataTypes, t)) {
          strictTypesError(it, `type "${t}" not allowed by context "${it.dataTypes.join(",")}"`);
        }
      });
      narrowSchemaTypes(it, types);
    }
    function checkMultipleTypes(it, ts2) {
      if (ts2.length > 1 && !(ts2.length === 2 && ts2.includes("null"))) {
        strictTypesError(it, "use allowUnionTypes to allow union type keyword");
      }
    }
    function checkKeywordTypes(it, ts2) {
      const rules = it.self.RULES.all;
      for (const keyword in rules) {
        const rule = rules[keyword];
        if (typeof rule == "object" && (0, applicability_1.shouldUseRule)(it.schema, rule)) {
          const { type } = rule.definition;
          if (type.length && !type.some((t) => hasApplicableType(ts2, t))) {
            strictTypesError(it, `missing type "${type.join(",")}" for keyword "${keyword}"`);
          }
        }
      }
    }
    function hasApplicableType(schTs, kwdT) {
      return schTs.includes(kwdT) || kwdT === "number" && schTs.includes("integer");
    }
    function includesType(ts2, t) {
      return ts2.includes(t) || t === "integer" && ts2.includes("number");
    }
    function narrowSchemaTypes(it, withTypes) {
      const ts2 = [];
      for (const t of it.dataTypes) {
        if (includesType(withTypes, t))
          ts2.push(t);
        else if (withTypes.includes("integer") && t === "number")
          ts2.push("integer");
      }
      it.dataTypes = ts2;
    }
    function strictTypesError(it, msg) {
      const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
      msg += ` at "${schemaPath}" (strictTypes)`;
      (0, util_1.checkStrictMode)(it, msg, it.opts.strictTypes);
    }
    var KeywordCxt = class {
      constructor(it, def, keyword) {
        (0, keyword_1.validateKeywordUsage)(it, def, keyword);
        this.gen = it.gen;
        this.allErrors = it.allErrors;
        this.keyword = keyword;
        this.data = it.data;
        this.schema = it.schema[keyword];
        this.$data = def.$data && it.opts.$data && this.schema && this.schema.$data;
        this.schemaValue = (0, util_1.schemaRefOrVal)(it, this.schema, keyword, this.$data);
        this.schemaType = def.schemaType;
        this.parentSchema = it.schema;
        this.params = {};
        this.it = it;
        this.def = def;
        if (this.$data) {
          this.schemaCode = it.gen.const("vSchema", getData(this.$data, it));
        } else {
          this.schemaCode = this.schemaValue;
          if (!(0, keyword_1.validSchemaType)(this.schema, def.schemaType, def.allowUndefined)) {
            throw new Error(`${keyword} value must be ${JSON.stringify(def.schemaType)}`);
          }
        }
        if ("code" in def ? def.trackErrors : def.errors !== false) {
          this.errsCount = it.gen.const("_errs", names_1.default.errors);
        }
      }
      result(condition, successAction, failAction) {
        this.failResult((0, codegen_1.not)(condition), successAction, failAction);
      }
      failResult(condition, successAction, failAction) {
        this.gen.if(condition);
        if (failAction)
          failAction();
        else
          this.error();
        if (successAction) {
          this.gen.else();
          successAction();
          if (this.allErrors)
            this.gen.endIf();
        } else {
          if (this.allErrors)
            this.gen.endIf();
          else
            this.gen.else();
        }
      }
      pass(condition, failAction) {
        this.failResult((0, codegen_1.not)(condition), void 0, failAction);
      }
      fail(condition) {
        if (condition === void 0) {
          this.error();
          if (!this.allErrors)
            this.gen.if(false);
          return;
        }
        this.gen.if(condition);
        this.error();
        if (this.allErrors)
          this.gen.endIf();
        else
          this.gen.else();
      }
      fail$data(condition) {
        if (!this.$data)
          return this.fail(condition);
        const { schemaCode } = this;
        this.fail((0, codegen_1._)`${schemaCode} !== undefined && (${(0, codegen_1.or)(this.invalid$data(), condition)})`);
      }
      error(append, errorParams, errorPaths) {
        if (errorParams) {
          this.setParams(errorParams);
          this._error(append, errorPaths);
          this.setParams({});
          return;
        }
        this._error(append, errorPaths);
      }
      _error(append, errorPaths) {
        ;
        (append ? errors_1.reportExtraError : errors_1.reportError)(this, this.def.error, errorPaths);
      }
      $dataError() {
        (0, errors_1.reportError)(this, this.def.$dataError || errors_1.keyword$DataError);
      }
      reset() {
        if (this.errsCount === void 0)
          throw new Error('add "trackErrors" to keyword definition');
        (0, errors_1.resetErrorsCount)(this.gen, this.errsCount);
      }
      ok(cond) {
        if (!this.allErrors)
          this.gen.if(cond);
      }
      setParams(obj, assign) {
        if (assign)
          Object.assign(this.params, obj);
        else
          this.params = obj;
      }
      block$data(valid, codeBlock, $dataValid = codegen_1.nil) {
        this.gen.block(() => {
          this.check$data(valid, $dataValid);
          codeBlock();
        });
      }
      check$data(valid = codegen_1.nil, $dataValid = codegen_1.nil) {
        if (!this.$data)
          return;
        const { gen, schemaCode, schemaType, def } = this;
        gen.if((0, codegen_1.or)((0, codegen_1._)`${schemaCode} === undefined`, $dataValid));
        if (valid !== codegen_1.nil)
          gen.assign(valid, true);
        if (schemaType.length || def.validateSchema) {
          gen.elseIf(this.invalid$data());
          this.$dataError();
          if (valid !== codegen_1.nil)
            gen.assign(valid, false);
        }
        gen.else();
      }
      invalid$data() {
        const { gen, schemaCode, schemaType, def, it } = this;
        return (0, codegen_1.or)(wrong$DataType(), invalid$DataSchema());
        function wrong$DataType() {
          if (schemaType.length) {
            if (!(schemaCode instanceof codegen_1.Name))
              throw new Error("ajv implementation error");
            const st = Array.isArray(schemaType) ? schemaType : [schemaType];
            return (0, codegen_1._)`${(0, dataType_2.checkDataTypes)(st, schemaCode, it.opts.strictNumbers, dataType_2.DataType.Wrong)}`;
          }
          return codegen_1.nil;
        }
        function invalid$DataSchema() {
          if (def.validateSchema) {
            const validateSchemaRef = gen.scopeValue("validate$data", { ref: def.validateSchema });
            return (0, codegen_1._)`!${validateSchemaRef}(${schemaCode})`;
          }
          return codegen_1.nil;
        }
      }
      subschema(appl, valid) {
        const subschema = (0, subschema_1.getSubschema)(this.it, appl);
        (0, subschema_1.extendSubschemaData)(subschema, this.it, appl);
        (0, subschema_1.extendSubschemaMode)(subschema, appl);
        const nextContext = { ...this.it, ...subschema, items: void 0, props: void 0 };
        subschemaCode(nextContext, valid);
        return nextContext;
      }
      mergeEvaluated(schemaCxt, toName) {
        const { it, gen } = this;
        if (!it.opts.unevaluated)
          return;
        if (it.props !== true && schemaCxt.props !== void 0) {
          it.props = util_1.mergeEvaluated.props(gen, schemaCxt.props, it.props, toName);
        }
        if (it.items !== true && schemaCxt.items !== void 0) {
          it.items = util_1.mergeEvaluated.items(gen, schemaCxt.items, it.items, toName);
        }
      }
      mergeValidEvaluated(schemaCxt, valid) {
        const { it, gen } = this;
        if (it.opts.unevaluated && (it.props !== true || it.items !== true)) {
          gen.if(valid, () => this.mergeEvaluated(schemaCxt, codegen_1.Name));
          return true;
        }
      }
    };
    exports.KeywordCxt = KeywordCxt;
    function keywordCode(it, keyword, def, ruleType) {
      const cxt = new KeywordCxt(it, def, keyword);
      if ("code" in def) {
        def.code(cxt, ruleType);
      } else if (cxt.$data && def.validate) {
        (0, keyword_1.funcKeywordCode)(cxt, def);
      } else if ("macro" in def) {
        (0, keyword_1.macroKeywordCode)(cxt, def);
      } else if (def.compile || def.validate) {
        (0, keyword_1.funcKeywordCode)(cxt, def);
      }
    }
    var JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/;
    var RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;
    function getData($data, { dataLevel, dataNames, dataPathArr }) {
      let jsonPointer;
      let data;
      if ($data === "")
        return names_1.default.rootData;
      if ($data[0] === "/") {
        if (!JSON_POINTER.test($data))
          throw new Error(`Invalid JSON-pointer: ${$data}`);
        jsonPointer = $data;
        data = names_1.default.rootData;
      } else {
        const matches = RELATIVE_JSON_POINTER.exec($data);
        if (!matches)
          throw new Error(`Invalid JSON-pointer: ${$data}`);
        const up = +matches[1];
        jsonPointer = matches[2];
        if (jsonPointer === "#") {
          if (up >= dataLevel)
            throw new Error(errorMsg("property/index", up));
          return dataPathArr[dataLevel - up];
        }
        if (up > dataLevel)
          throw new Error(errorMsg("data", up));
        data = dataNames[dataLevel - up];
        if (!jsonPointer)
          return data;
      }
      let expr = data;
      const segments = jsonPointer.split("/");
      for (const segment of segments) {
        if (segment) {
          data = (0, codegen_1._)`${data}${(0, codegen_1.getProperty)((0, util_1.unescapeJsonPointer)(segment))}`;
          expr = (0, codegen_1._)`${expr} && ${data}`;
        }
      }
      return expr;
      function errorMsg(pointerType, up) {
        return `Cannot access ${pointerType} ${up} levels up, current level is ${dataLevel}`;
      }
    }
    exports.getData = getData;
  }
});

// node_modules/ajv/dist/runtime/validation_error.js
var require_validation_error = __commonJS({
  "node_modules/ajv/dist/runtime/validation_error.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var ValidationError = class extends Error {
      constructor(errors) {
        super("validation failed");
        this.errors = errors;
        this.ajv = this.validation = true;
      }
    };
    exports.default = ValidationError;
  }
});

// node_modules/ajv/dist/compile/ref_error.js
var require_ref_error = __commonJS({
  "node_modules/ajv/dist/compile/ref_error.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var resolve_1 = require_resolve();
    var MissingRefError = class extends Error {
      constructor(resolver, baseId, ref, msg) {
        super(msg || `can't resolve reference ${ref} from id ${baseId}`);
        this.missingRef = (0, resolve_1.resolveUrl)(resolver, baseId, ref);
        this.missingSchema = (0, resolve_1.normalizeId)((0, resolve_1.getFullPath)(resolver, this.missingRef));
      }
    };
    exports.default = MissingRefError;
  }
});

// node_modules/ajv/dist/compile/index.js
var require_compile = __commonJS({
  "node_modules/ajv/dist/compile/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.resolveSchema = exports.getCompilingSchema = exports.resolveRef = exports.compileSchema = exports.SchemaEnv = void 0;
    var codegen_1 = require_codegen();
    var validation_error_1 = require_validation_error();
    var names_1 = require_names();
    var resolve_1 = require_resolve();
    var util_1 = require_util();
    var validate_1 = require_validate();
    var SchemaEnv = class {
      constructor(env) {
        var _a;
        this.refs = {};
        this.dynamicAnchors = {};
        let schema;
        if (typeof env.schema == "object")
          schema = env.schema;
        this.schema = env.schema;
        this.schemaId = env.schemaId;
        this.root = env.root || this;
        this.baseId = (_a = env.baseId) !== null && _a !== void 0 ? _a : (0, resolve_1.normalizeId)(schema === null || schema === void 0 ? void 0 : schema[env.schemaId || "$id"]);
        this.schemaPath = env.schemaPath;
        this.localRefs = env.localRefs;
        this.meta = env.meta;
        this.$async = schema === null || schema === void 0 ? void 0 : schema.$async;
        this.refs = {};
      }
    };
    exports.SchemaEnv = SchemaEnv;
    function compileSchema(sch) {
      const _sch = getCompilingSchema.call(this, sch);
      if (_sch)
        return _sch;
      const rootId = (0, resolve_1.getFullPath)(this.opts.uriResolver, sch.root.baseId);
      const { es5, lines } = this.opts.code;
      const { ownProperties } = this.opts;
      const gen = new codegen_1.CodeGen(this.scope, { es5, lines, ownProperties });
      let _ValidationError;
      if (sch.$async) {
        _ValidationError = gen.scopeValue("Error", {
          ref: validation_error_1.default,
          code: (0, codegen_1._)`require("ajv/dist/runtime/validation_error").default`
        });
      }
      const validateName = gen.scopeName("validate");
      sch.validateName = validateName;
      const schemaCxt = {
        gen,
        allErrors: this.opts.allErrors,
        data: names_1.default.data,
        parentData: names_1.default.parentData,
        parentDataProperty: names_1.default.parentDataProperty,
        dataNames: [names_1.default.data],
        dataPathArr: [codegen_1.nil],
        // TODO can its length be used as dataLevel if nil is removed?
        dataLevel: 0,
        dataTypes: [],
        definedProperties: /* @__PURE__ */ new Set(),
        topSchemaRef: gen.scopeValue("schema", this.opts.code.source === true ? { ref: sch.schema, code: (0, codegen_1.stringify)(sch.schema) } : { ref: sch.schema }),
        validateName,
        ValidationError: _ValidationError,
        schema: sch.schema,
        schemaEnv: sch,
        rootId,
        baseId: sch.baseId || rootId,
        schemaPath: codegen_1.nil,
        errSchemaPath: sch.schemaPath || (this.opts.jtd ? "" : "#"),
        errorPath: (0, codegen_1._)`""`,
        opts: this.opts,
        self: this
      };
      let sourceCode;
      try {
        this._compilations.add(sch);
        (0, validate_1.validateFunctionCode)(schemaCxt);
        gen.optimize(this.opts.code.optimize);
        const validateCode = gen.toString();
        sourceCode = `${gen.scopeRefs(names_1.default.scope)}return ${validateCode}`;
        if (this.opts.code.process)
          sourceCode = this.opts.code.process(sourceCode, sch);
        const makeValidate = new Function(`${names_1.default.self}`, `${names_1.default.scope}`, sourceCode);
        const validate = makeValidate(this, this.scope.get());
        this.scope.value(validateName, { ref: validate });
        validate.errors = null;
        validate.schema = sch.schema;
        validate.schemaEnv = sch;
        if (sch.$async)
          validate.$async = true;
        if (this.opts.code.source === true) {
          validate.source = { validateName, validateCode, scopeValues: gen._values };
        }
        if (this.opts.unevaluated) {
          const { props, items } = schemaCxt;
          validate.evaluated = {
            props: props instanceof codegen_1.Name ? void 0 : props,
            items: items instanceof codegen_1.Name ? void 0 : items,
            dynamicProps: props instanceof codegen_1.Name,
            dynamicItems: items instanceof codegen_1.Name
          };
          if (validate.source)
            validate.source.evaluated = (0, codegen_1.stringify)(validate.evaluated);
        }
        sch.validate = validate;
        return sch;
      } catch (e) {
        delete sch.validate;
        delete sch.validateName;
        if (sourceCode)
          this.logger.error("Error compiling schema, function code:", sourceCode);
        throw e;
      } finally {
        this._compilations.delete(sch);
      }
    }
    exports.compileSchema = compileSchema;
    function resolveRef(root, baseId, ref) {
      var _a;
      ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, ref);
      const schOrFunc = root.refs[ref];
      if (schOrFunc)
        return schOrFunc;
      let _sch = resolve.call(this, root, ref);
      if (_sch === void 0) {
        const schema = (_a = root.localRefs) === null || _a === void 0 ? void 0 : _a[ref];
        const { schemaId } = this.opts;
        if (schema)
          _sch = new SchemaEnv({ schema, schemaId, root, baseId });
      }
      if (_sch === void 0)
        return;
      return root.refs[ref] = inlineOrCompile.call(this, _sch);
    }
    exports.resolveRef = resolveRef;
    function inlineOrCompile(sch) {
      if ((0, resolve_1.inlineRef)(sch.schema, this.opts.inlineRefs))
        return sch.schema;
      return sch.validate ? sch : compileSchema.call(this, sch);
    }
    function getCompilingSchema(schEnv) {
      for (const sch of this._compilations) {
        if (sameSchemaEnv(sch, schEnv))
          return sch;
      }
    }
    exports.getCompilingSchema = getCompilingSchema;
    function sameSchemaEnv(s1, s2) {
      return s1.schema === s2.schema && s1.root === s2.root && s1.baseId === s2.baseId;
    }
    function resolve(root, ref) {
      let sch;
      while (typeof (sch = this.refs[ref]) == "string")
        ref = sch;
      return sch || this.schemas[ref] || resolveSchema.call(this, root, ref);
    }
    function resolveSchema(root, ref) {
      const p = this.opts.uriResolver.parse(ref);
      const refPath = (0, resolve_1._getFullPath)(this.opts.uriResolver, p);
      let baseId = (0, resolve_1.getFullPath)(this.opts.uriResolver, root.baseId, void 0);
      if (Object.keys(root.schema).length > 0 && refPath === baseId) {
        return getJsonPointer.call(this, p, root);
      }
      const id = (0, resolve_1.normalizeId)(refPath);
      const schOrRef = this.refs[id] || this.schemas[id];
      if (typeof schOrRef == "string") {
        const sch = resolveSchema.call(this, root, schOrRef);
        if (typeof (sch === null || sch === void 0 ? void 0 : sch.schema) !== "object")
          return;
        return getJsonPointer.call(this, p, sch);
      }
      if (typeof (schOrRef === null || schOrRef === void 0 ? void 0 : schOrRef.schema) !== "object")
        return;
      if (!schOrRef.validate)
        compileSchema.call(this, schOrRef);
      if (id === (0, resolve_1.normalizeId)(ref)) {
        const { schema } = schOrRef;
        const { schemaId } = this.opts;
        const schId = schema[schemaId];
        if (schId)
          baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
        return new SchemaEnv({ schema, schemaId, root, baseId });
      }
      return getJsonPointer.call(this, p, schOrRef);
    }
    exports.resolveSchema = resolveSchema;
    var PREVENT_SCOPE_CHANGE = /* @__PURE__ */ new Set([
      "properties",
      "patternProperties",
      "enum",
      "dependencies",
      "definitions"
    ]);
    function getJsonPointer(parsedRef, { baseId, schema, root }) {
      var _a;
      if (((_a = parsedRef.fragment) === null || _a === void 0 ? void 0 : _a[0]) !== "/")
        return;
      for (const part of parsedRef.fragment.slice(1).split("/")) {
        if (typeof schema === "boolean")
          return;
        const partSchema = schema[(0, util_1.unescapeFragment)(part)];
        if (partSchema === void 0)
          return;
        schema = partSchema;
        const schId = typeof schema === "object" && schema[this.opts.schemaId];
        if (!PREVENT_SCOPE_CHANGE.has(part) && schId) {
          baseId = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schId);
        }
      }
      let env;
      if (typeof schema != "boolean" && schema.$ref && !(0, util_1.schemaHasRulesButRef)(schema, this.RULES)) {
        const $ref = (0, resolve_1.resolveUrl)(this.opts.uriResolver, baseId, schema.$ref);
        env = resolveSchema.call(this, root, $ref);
      }
      const { schemaId } = this.opts;
      env = env || new SchemaEnv({ schema, schemaId, root, baseId });
      if (env.schema !== env.root.schema)
        return env;
      return void 0;
    }
  }
});

// node_modules/ajv/dist/refs/data.json
var require_data = __commonJS({
  "node_modules/ajv/dist/refs/data.json"(exports, module) {
    module.exports = {
      $id: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#",
      description: "Meta-schema for $data reference (JSON AnySchema extension proposal)",
      type: "object",
      required: ["$data"],
      properties: {
        $data: {
          type: "string",
          anyOf: [{ format: "relative-json-pointer" }, { format: "json-pointer" }]
        }
      },
      additionalProperties: false
    };
  }
});

// node_modules/fast-uri/lib/utils.js
var require_utils = __commonJS({
  "node_modules/fast-uri/lib/utils.js"(exports, module) {
    "use strict";
    var isUUID = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu);
    var isIPv4 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u);
    var isPort = RegExp.prototype.test.bind(/^\d*$/u);
    var isHexPair = RegExp.prototype.test.bind(/^[\da-f]{2}$/iu);
    var isUnreserved = RegExp.prototype.test.bind(/^[\da-z\-._~]$/iu);
    var isPathCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:@/]$/u);
    var isQueryFragmentCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:@/?]$/u);
    var isUserinfoCharacter = RegExp.prototype.test.bind(/^[A-Za-z0-9\-._~!$&'()*+,;=:]$/u);
    var BYTE_HEX = new Array(256);
    {
      const HEX_DIGITS = "0123456789ABCDEF";
      for (let i = 0; i < 256; i++) {
        BYTE_HEX[i] = "%" + HEX_DIGITS[i >> 4] + HEX_DIGITS[i & 15];
      }
    }
    function percentEncodeNonAscii(cp) {
      if (cp < 2048) {
        return BYTE_HEX[192 | cp >> 6] + BYTE_HEX[128 | cp & 63];
      }
      if (cp < 65536) {
        return BYTE_HEX[224 | cp >> 12] + BYTE_HEX[128 | cp >> 6 & 63] + BYTE_HEX[128 | cp & 63];
      }
      return BYTE_HEX[240 | cp >> 18] + BYTE_HEX[128 | cp >> 12 & 63] + BYTE_HEX[128 | cp >> 6 & 63] + BYTE_HEX[128 | cp & 63];
    }
    function stringArrayToHexStripped(input) {
      let acc = "";
      let code = 0;
      let i = 0;
      for (i = 0; i < input.length; i++) {
        code = input[i].charCodeAt(0);
        if (code === 48) {
          continue;
        }
        if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
          return "";
        }
        acc += input[i];
        break;
      }
      for (i += 1; i < input.length; i++) {
        code = input[i].charCodeAt(0);
        if (!(code >= 48 && code <= 57 || code >= 65 && code <= 70 || code >= 97 && code <= 102)) {
          return "";
        }
        acc += input[i];
      }
      return acc;
    }
    var isHextet = RegExp.prototype.test.bind(/^[\dA-Fa-f]{1,4}$/);
    var isIPvFuture = RegExp.prototype.test.bind(/^[vV][\dA-Fa-f]+\.[A-Za-z\d\-._~!$&'()*+,;=:]+$/);
    var isZoneCharacter = RegExp.prototype.test.bind(/^[A-Za-z\d\-._~]$/);
    var nonSimpleDomain = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u);
    function isZoneIdentifier(zone) {
      if (zone.length === 0) return false;
      for (let i = 0; i < zone.length; i++) {
        if (isZoneCharacter(zone[i])) continue;
        if (zone[i] === "%" && i + 2 < zone.length && isHexPair(zone.slice(i + 1, i + 3))) {
          i += 2;
          continue;
        }
        return false;
      }
      return true;
    }
    function compressIPv6ZeroRun(hextets) {
      let bestStart = -1;
      let bestLength = 0;
      let runStart = -1;
      let runLength = 0;
      for (let i = 0; i < hextets.length; i++) {
        if (hextets[i] === "0") {
          if (runStart === -1) runStart = i;
          runLength++;
          if (runLength > bestLength) {
            bestLength = runLength;
            bestStart = runStart;
          }
        } else {
          runStart = -1;
          runLength = 0;
        }
      }
      if (bestLength < 2) return hextets.join(":");
      const head = hextets.slice(0, bestStart).join(":");
      const tail = hextets.slice(bestStart + bestLength).join(":");
      return head + "::" + tail;
    }
    function normalizeIPv6Address(input) {
      const compression = input.indexOf("::");
      if (compression !== -1 && input.indexOf("::", compression + 1) !== -1) return void 0;
      const left = compression === -1 ? input.split(":") : input.slice(0, compression).split(":");
      const right = compression === -1 ? [] : input.slice(compression + 2).split(":");
      if (compression !== -1) {
        if (left.length === 1 && left[0] === "") left.length = 0;
        if (right.length === 1 && right[0] === "") right.length = 0;
      }
      const parts = left.concat(right);
      let hextetCount = 0;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === "") return void 0;
        if (part.indexOf(".") !== -1) {
          if (i !== parts.length - 1 || compression !== -1 && right.length === 0 || !isIPv4(part)) return void 0;
          hextetCount += 2;
          continue;
        }
        if (!isHextet(part)) return void 0;
        parts[i] = parseInt(part, 16).toString(16);
        hextetCount++;
      }
      if (compression === -1) {
        if (hextetCount !== 8) return void 0;
        return compressIPv6ZeroRun(parts);
      }
      if (hextetCount >= 8) return void 0;
      const expanded = parts.slice(0, left.length);
      for (let i = hextetCount; i < 8; i++) expanded.push("0");
      for (let i = left.length; i < parts.length; i++) expanded.push(parts[i]);
      return compressIPv6ZeroRun(expanded);
    }
    function normalizeIPv6(host) {
      const bracketed = host[0] === "[" && host[host.length - 1] === "]";
      const hasBracket = host[0] === "[" || host[host.length - 1] === "]";
      if (hasBracket && !bracketed) return { host, isIPV6: false, error: true };
      let input = bracketed ? host.slice(1, -1) : host;
      if (bracketed && isIPvFuture(input)) {
        input = input.toLowerCase();
        return { host: `[${input}]`, escapedHost: input, isIPV6: false, isIPVFuture: true };
      }
      if (findToken(input, ":") < 2) {
        return { host, isIPV6: false, error: bracketed };
      }
      let zoneIdentifier = "";
      const zoneSeparator = input.indexOf("%");
      if (zoneSeparator !== -1) {
        const separatorLength = input.slice(zoneSeparator, zoneSeparator + 3).toLowerCase() === "%25" ? 3 : 1;
        zoneIdentifier = input.slice(zoneSeparator + separatorLength);
        if (!isZoneIdentifier(zoneIdentifier)) return { host, isIPV6: false, error: true };
        input = input.slice(0, zoneSeparator);
      }
      const address = normalizeIPv6Address(input);
      if (address === void 0) return { host, isIPV6: false, error: true };
      return {
        host: address + (zoneIdentifier ? "%" + zoneIdentifier : ""),
        escapedHost: address + (zoneIdentifier ? "%25" + zoneIdentifier : ""),
        isIPV6: true
      };
    }
    function findToken(str, token) {
      let ind = 0;
      for (let i = 0; i < str.length; i++) {
        if (str[i] === token) ind++;
      }
      return ind;
    }
    function removeDotSegments(path21) {
      let input = path21;
      const output = [];
      let nextSlash = -1;
      let len = 0;
      while (len = input.length) {
        if (len === 1) {
          if (input === ".") {
            break;
          } else if (input === "/") {
            output.push("/");
            break;
          } else {
            output.push(input);
            break;
          }
        } else if (len === 2) {
          if (input[0] === ".") {
            if (input[1] === ".") {
              break;
            } else if (input[1] === "/") {
              input = input.slice(2);
              continue;
            }
          } else if (input[0] === "/") {
            if (input[1] === "." || input[1] === "/") {
              output.push("/");
              break;
            }
          }
        } else if (len === 3) {
          if (input === "/..") {
            if (output.length !== 0) {
              output.pop();
            }
            output.push("/");
            break;
          }
        }
        if (input[0] === ".") {
          if (input[1] === ".") {
            if (input[2] === "/") {
              input = input.slice(3);
              continue;
            }
          } else if (input[1] === "/") {
            input = input.slice(2);
            continue;
          }
        } else if (input[0] === "/") {
          if (input[1] === ".") {
            if (input[2] === "/") {
              input = input.slice(2);
              continue;
            } else if (input[2] === ".") {
              if (input[3] === "/") {
                input = input.slice(3);
                if (output.length !== 0) {
                  output.pop();
                }
                continue;
              }
            }
          }
        }
        if ((nextSlash = input.indexOf("/", 1)) === -1) {
          output.push(input);
          break;
        } else {
          output.push(input.slice(0, nextSlash));
          input = input.slice(nextSlash);
        }
      }
      return output.join("");
    }
    var HOST_DELIMS = { "@": "%40", "/": "%2F", "?": "%3F", "#": "%23", ":": "%3A" };
    var HOST_DELIM_RE = /[@/?#:]/g;
    var HOST_DELIM_NO_COLON_RE = /[@/?#]/g;
    function reescapeHostDelimiters(host, isIP) {
      const re = isIP ? HOST_DELIM_NO_COLON_RE : HOST_DELIM_RE;
      re.lastIndex = 0;
      return host.replace(re, (ch) => HOST_DELIMS[ch]);
    }
    function normalizePercentEncoding(input, decodeUnreserved = false) {
      if (input.indexOf("%") === -1) {
        return input;
      }
      let output = "";
      for (let i = 0; i < input.length; i++) {
        if (input[i] === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            const normalizedHex = hex.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (decodeUnreserved && isUnreserved(decoded)) {
              output += decoded;
            } else {
              output += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        output += input[i];
      }
      return output;
    }
    function normalizePathEncoding(input) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            const normalizedHex = hex.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (decoded !== "." && isUnreserved(decoded)) {
              output += decoded;
            } else {
              output += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        if (isPathCharacter(ch)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += isEscapeSafe(code) ? ch : BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function serializePathEncoding(input, pathNoScheme = false) {
      let output = "";
      let firstSegment = pathNoScheme && input[0] !== "/";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            output += "%" + hex.toUpperCase();
            i += 2;
            continue;
          }
        }
        if (ch === "/") {
          firstSegment = false;
        }
        if (isPathCharacter(ch) && (ch !== ":" || !firstSegment)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function encodeComponent(input, isAllowed) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            output += "%" + hex.toUpperCase();
            i += 2;
            continue;
          }
        }
        if (isAllowed(ch)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function encodeUserinfo(input) {
      return encodeComponent(input, isUserinfoCharacter);
    }
    function encodeQuery(input) {
      return encodeComponent(input, isQueryFragmentCharacter);
    }
    function encodeFragment(input) {
      return encodeComponent(input, isQueryFragmentCharacter);
    }
    function isEscapeSafe(cp) {
      return cp >= 48 && cp <= 57 || cp >= 65 && cp <= 90 || cp >= 97 && cp <= 122 || cp === 42 || cp === 43 || cp === 45 || cp === 46 || cp === 47 || cp === 64 || cp === 95;
    }
    function normalizeQueryFragmentEncoding(input) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            const normalizedHex = hex.toUpperCase();
            const decoded = String.fromCharCode(parseInt(normalizedHex, 16));
            if (isUnreserved(decoded)) {
              output += decoded;
            } else {
              output += "%" + normalizedHex;
            }
            i += 2;
            continue;
          }
        }
        if (isQueryFragmentCharacter(ch)) {
          output += ch;
        } else {
          const code = input.charCodeAt(i);
          if (code < 128) {
            output += isEscapeSafe(code) ? ch : BYTE_HEX[code];
          } else if (code < 55296 || code > 57343) {
            output += percentEncodeNonAscii(code);
          } else if (code <= 56319 && i + 1 < input.length) {
            const low = input.charCodeAt(i + 1);
            if (low >= 56320 && low <= 57343) {
              output += percentEncodeNonAscii(65536 + (code - 55296 << 10) + (low - 56320));
              i++;
            } else {
              output += percentEncodeNonAscii(65533);
            }
          } else {
            output += percentEncodeNonAscii(65533);
          }
        }
      }
      return output;
    }
    function escapePreservingEscapes(input) {
      let output = "";
      for (let i = 0; i < input.length; i++) {
        if (input[i] === "%" && i + 2 < input.length) {
          const hex = input.slice(i + 1, i + 3);
          if (isHexPair(hex)) {
            output += "%" + hex.toUpperCase();
            i += 2;
            continue;
          }
        }
        output += escape(input[i]);
      }
      return output;
    }
    function recomposeAuthority(component) {
      const uriTokens = [];
      if (component.userinfo !== void 0) {
        uriTokens.push(encodeUserinfo(component.userinfo));
        uriTokens.push("@");
      }
      if (component.host !== void 0) {
        let host = component.host;
        if (!isIPv4(host)) {
          let ipV6res = normalizeIPv6(host);
          if (ipV6res.isIPV6 !== true && ipV6res.isIPVFuture !== true) {
            host = normalizePercentEncoding(host, true);
            ipV6res = normalizeIPv6(host);
          }
          if (ipV6res.isIPV6 === true || ipV6res.isIPVFuture === true) {
            host = `[${ipV6res.escapedHost}]`;
          } else {
            host = reescapeHostDelimiters(host, false);
          }
        }
        uriTokens.push(host);
      }
      if (typeof component.port === "number" || typeof component.port === "string") {
        const port = String(component.port);
        if (!isPort(port)) {
          throw new TypeError("URI port is malformed.");
        }
        uriTokens.push(":");
        uriTokens.push(port);
      }
      return uriTokens.length ? uriTokens.join("") : void 0;
    }
    module.exports = {
      nonSimpleDomain,
      recomposeAuthority,
      reescapeHostDelimiters,
      normalizePercentEncoding,
      normalizePathEncoding,
      serializePathEncoding,
      normalizeQueryFragmentEncoding,
      encodeUserinfo,
      encodeQuery,
      encodeFragment,
      escapePreservingEscapes,
      removeDotSegments,
      isIPv4,
      isUUID,
      normalizeIPv6,
      stringArrayToHexStripped
    };
  }
});

// node_modules/fast-uri/lib/schemes.js
var require_schemes = __commonJS({
  "node_modules/fast-uri/lib/schemes.js"(exports, module) {
    "use strict";
    var { isUUID } = require_utils();
    var URN_REG = /^([\da-z][\d\-a-z]{0,31}):((?:[\w!$'()*+,\-./:;=@]|%[\da-f]{2})+)$/iu;
    var supportedSchemeNames = (
      /** @type {const} */
      [
        "http",
        "https",
        "ws",
        "wss",
        "urn",
        "urn:uuid"
      ]
    );
    function isValidSchemeName(name) {
      return supportedSchemeNames.indexOf(
        /** @type {*} */
        name
      ) !== -1;
    }
    function wsIsSecure(wsComponent) {
      if (wsComponent.secure === true) {
        return true;
      } else if (wsComponent.secure === false) {
        return false;
      } else if (wsComponent.scheme) {
        return wsComponent.scheme.length === 3 && (wsComponent.scheme[0] === "w" || wsComponent.scheme[0] === "W") && (wsComponent.scheme[1] === "s" || wsComponent.scheme[1] === "S") && (wsComponent.scheme[2] === "s" || wsComponent.scheme[2] === "S");
      } else {
        return false;
      }
    }
    function httpParse(component) {
      if (!component.host) {
        component.error = component.error || "HTTP URIs must have a host.";
      }
      return component;
    }
    function httpSerialize(component) {
      const secure = String(component.scheme).toLowerCase() === "https";
      if (component.port === (secure ? 443 : 80) || component.port === "") {
        component.port = void 0;
      }
      if (!component.path) {
        component.path = "/";
      }
      return component;
    }
    function wsParse(wsComponent) {
      wsComponent.secure = wsIsSecure(wsComponent);
      wsComponent.resourceName = (wsComponent.path || "/") + (wsComponent.query ? "?" + wsComponent.query : "");
      wsComponent.path = void 0;
      wsComponent.query = void 0;
      return wsComponent;
    }
    function wsSerialize(wsComponent) {
      if (wsComponent.port === (wsIsSecure(wsComponent) ? 443 : 80) || wsComponent.port === "") {
        wsComponent.port = void 0;
      }
      if (typeof wsComponent.secure === "boolean") {
        wsComponent.scheme = wsComponent.secure ? "wss" : "ws";
        wsComponent.secure = void 0;
      }
      if (wsComponent.resourceName) {
        const queryIndex = wsComponent.resourceName.indexOf("?");
        const path21 = queryIndex === -1 ? wsComponent.resourceName : wsComponent.resourceName.slice(0, queryIndex);
        wsComponent.path = path21 && path21 !== "/" ? path21 : void 0;
        wsComponent.query = queryIndex === -1 ? void 0 : wsComponent.resourceName.slice(queryIndex + 1);
        wsComponent.resourceName = void 0;
      }
      wsComponent.fragment = void 0;
      return wsComponent;
    }
    function urnParse(urnComponent, options) {
      if (!urnComponent.path) {
        urnComponent.error = "URN can not be parsed";
        return urnComponent;
      }
      const matches = urnComponent.path.match(URN_REG);
      if (matches && matches[0] === urnComponent.path) {
        const scheme = options.scheme || urnComponent.scheme || "urn";
        urnComponent.nid = matches[1].toLowerCase();
        urnComponent.nss = matches[2];
        const urnScheme = `${scheme}:${options.nid || urnComponent.nid}`;
        const schemeHandler = getSchemeHandler(urnScheme);
        urnComponent.path = void 0;
        if (schemeHandler) {
          urnComponent = schemeHandler.parse(urnComponent, options);
        }
      } else {
        urnComponent.error = urnComponent.error || "URN can not be parsed.";
      }
      return urnComponent;
    }
    function urnSerialize(urnComponent, options) {
      if (urnComponent.nid === void 0) {
        throw new Error("URN without nid cannot be serialized");
      }
      const scheme = options.scheme || urnComponent.scheme || "urn";
      const nid = urnComponent.nid.toLowerCase();
      const urnScheme = `${scheme}:${options.nid || nid}`;
      const schemeHandler = getSchemeHandler(urnScheme);
      if (schemeHandler) {
        urnComponent = schemeHandler.serialize(urnComponent, options);
      }
      const uriComponent = urnComponent;
      const nss = urnComponent.nss;
      uriComponent.path = `${nid || options.nid}:${nss}`;
      options.skipEscape = true;
      return uriComponent;
    }
    function urnuuidParse(urnComponent, options) {
      const uuidComponent = urnComponent;
      uuidComponent.uuid = uuidComponent.nss;
      uuidComponent.nss = void 0;
      if (!options.tolerant && (!uuidComponent.uuid || !isUUID(uuidComponent.uuid))) {
        uuidComponent.error = uuidComponent.error || "UUID is not valid.";
      }
      return uuidComponent;
    }
    function urnuuidSerialize(uuidComponent) {
      const urnComponent = uuidComponent;
      urnComponent.nss = (uuidComponent.uuid || "").toLowerCase();
      return urnComponent;
    }
    var http2 = (
      /** @type {SchemeHandler} */
      {
        scheme: "http",
        domainHost: true,
        parse: httpParse,
        serialize: httpSerialize
      }
    );
    var https = (
      /** @type {SchemeHandler} */
      {
        scheme: "https",
        domainHost: http2.domainHost,
        parse: httpParse,
        serialize: httpSerialize
      }
    );
    var ws = (
      /** @type {SchemeHandler} */
      {
        scheme: "ws",
        domainHost: true,
        parse: wsParse,
        serialize: wsSerialize
      }
    );
    var wss = (
      /** @type {SchemeHandler} */
      {
        scheme: "wss",
        domainHost: ws.domainHost,
        parse: ws.parse,
        serialize: ws.serialize
      }
    );
    var urn = (
      /** @type {SchemeHandler} */
      {
        scheme: "urn",
        parse: urnParse,
        serialize: urnSerialize,
        skipNormalize: true
      }
    );
    var urnuuid = (
      /** @type {SchemeHandler} */
      {
        scheme: "urn:uuid",
        parse: urnuuidParse,
        serialize: urnuuidSerialize,
        skipNormalize: true
      }
    );
    var SCHEMES = (
      /** @type {Record<SchemeName, SchemeHandler>} */
      {
        http: http2,
        https,
        ws,
        wss,
        urn,
        "urn:uuid": urnuuid
      }
    );
    Object.setPrototypeOf(SCHEMES, null);
    function getSchemeHandler(scheme) {
      return scheme && (SCHEMES[
        /** @type {SchemeName} */
        scheme
      ] || SCHEMES[
        /** @type {SchemeName} */
        scheme.toLowerCase()
      ]) || void 0;
    }
    module.exports = {
      wsIsSecure,
      SCHEMES,
      isValidSchemeName,
      getSchemeHandler
    };
  }
});

// node_modules/fast-uri/index.js
var require_fast_uri = __commonJS({
  "node_modules/fast-uri/index.js"(exports, module) {
    "use strict";
    var { normalizeIPv6, removeDotSegments, recomposeAuthority, normalizePercentEncoding, normalizePathEncoding, serializePathEncoding, normalizeQueryFragmentEncoding, encodeQuery, encodeFragment, reescapeHostDelimiters, isIPv4, nonSimpleDomain } = require_utils();
    var { SCHEMES, getSchemeHandler } = require_schemes();
    var VALID_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/u;
    var MALFORMED_SCHEME_ERROR = "URI scheme is malformed.";
    function decodeValidScheme(scheme) {
      const decodedScheme = unescape(String(scheme));
      if (!VALID_SCHEME.test(decodedScheme)) {
        throw new TypeError(MALFORMED_SCHEME_ERROR);
      }
      return decodedScheme;
    }
    function normalize(uri, options) {
      if (typeof uri === "string") {
        uri = /** @type {T} */
        normalizeString(uri, options);
      } else if (typeof uri === "object") {
        uri = /** @type {T} */
        parse3(serialize(uri, options), options);
      }
      return uri;
    }
    function resolve(baseURI, relativeURI, options) {
      const schemelessOptions = options ? Object.assign({ scheme: "null" }, options) : { scheme: "null" };
      const {
        parsed: baseParsed,
        malformedAuthorityOrPort: baseMalformed,
        malformedPercentEncoding: baseMalformedPercentEncoding,
        malformedSchemeSpecific: baseMalformedSchemeSpecific,
        malformedHost: baseMalformedHost,
        malformedScheme: baseMalformedScheme
      } = parseWithStatus(baseURI, schemelessOptions);
      const {
        parsed: relativeParsed,
        malformedAuthorityOrPort: relativeMalformed,
        malformedPercentEncoding: relativeMalformedPercentEncoding,
        malformedSchemeSpecific: relativeMalformedSchemeSpecific,
        malformedHost: relativeMalformedHost,
        malformedScheme: relativeMalformedScheme
      } = parseWithStatus(relativeURI, schemelessOptions);
      if (baseMalformed || relativeMalformed || baseMalformedPercentEncoding || relativeMalformedPercentEncoding || baseMalformedSchemeSpecific || relativeMalformedSchemeSpecific || baseMalformedHost || relativeMalformedHost || baseMalformedScheme || relativeMalformedScheme) {
        throw new Error(baseParsed.error || relativeParsed.error || "URI is malformed.");
      }
      const resolved = resolveComponent(baseParsed, relativeParsed, schemelessOptions, true);
      const resolvedSchemeHandler = getSchemeHandler(options && options.scheme || resolved.scheme);
      const resolvedHost = resolved.host;
      const resolvedHostIsIP = resolvedHost !== void 0 && resolvedHost !== "" && (isIPv4(resolvedHost) || normalizeIPv6(resolvedHost).isIPV6);
      canonicalizeHost(resolved, options || {}, resolvedSchemeHandler, resolvedHostIsIP);
      const encodedASCIIHost = resolvedHost && resolvedHost.indexOf("%") !== -1 && !new RegExp("\\P{ASCII}", "u").test(resolvedHost);
      if (resolved.error && !encodedASCIIHost) {
        throw new Error(resolved.error);
      }
      schemelessOptions.skipEscape = true;
      return serialize(resolved, schemelessOptions);
    }
    function resolveComponent(base, relative, options, skipNormalization) {
      const target = {};
      if (!skipNormalization) {
        base = parse3(serialize(base, options), options);
        relative = parse3(serialize(relative, options), options);
      }
      options = options || {};
      if (!options.tolerant && relative.scheme) {
        target.scheme = relative.scheme;
        target.userinfo = relative.userinfo;
        target.host = relative.host;
        target.port = relative.port;
        target.path = removeDotSegments(relative.path || "");
        target.query = relative.query;
      } else {
        if (relative.userinfo !== void 0 || relative.host !== void 0 || relative.port !== void 0) {
          target.userinfo = relative.userinfo;
          target.host = relative.host;
          target.port = relative.port;
          target.path = removeDotSegments(relative.path || "");
          target.query = relative.query;
        } else {
          if (!relative.path) {
            target.path = base.path;
            if (relative.query !== void 0) {
              target.query = relative.query;
            } else {
              target.query = base.query;
            }
          } else {
            if (relative.path[0] === "/") {
              target.path = removeDotSegments(relative.path);
            } else {
              if ((base.userinfo !== void 0 || base.host !== void 0 || base.port !== void 0) && !base.path) {
                target.path = "/" + relative.path;
              } else if (!base.path) {
                target.path = relative.path;
              } else {
                target.path = base.path.slice(0, base.path.lastIndexOf("/") + 1) + relative.path;
              }
              target.path = removeDotSegments(target.path);
            }
            target.query = relative.query;
          }
          target.userinfo = base.userinfo;
          target.host = base.host;
          target.port = base.port;
        }
        target.scheme = base.scheme;
      }
      target.fragment = relative.fragment;
      return target;
    }
    function equal(uriA, uriB, options) {
      const normalizedA = normalizeComparableURI(uriA, options);
      const normalizedB = normalizeComparableURI(uriB, options);
      return normalizedA !== void 0 && normalizedB !== void 0 && normalizedA === normalizedB;
    }
    function serialize(cmpts, opts) {
      const component = {
        host: cmpts.host,
        scheme: cmpts.scheme,
        userinfo: cmpts.userinfo,
        port: cmpts.port,
        path: cmpts.path,
        query: cmpts.query,
        nid: cmpts.nid,
        nss: cmpts.nss,
        uuid: cmpts.uuid,
        fragment: cmpts.fragment,
        reference: cmpts.reference,
        resourceName: cmpts.resourceName,
        secure: cmpts.secure,
        error: ""
      };
      const options = Object.assign({}, opts);
      const uriTokens = [];
      if (component.scheme) {
        component.scheme = decodeValidScheme(component.scheme);
      }
      const schemeHandler = getSchemeHandler(options.scheme || component.scheme);
      if (schemeHandler && schemeHandler.serialize) schemeHandler.serialize(component, options);
      const hasAuthority = component.userinfo !== void 0 || component.host !== void 0 || component.port !== void 0;
      const pathNoScheme = !options.skipEscape && component.scheme === void 0 && !hasAuthority;
      if (component.path !== void 0) {
        if (!options.skipEscape) {
          component.path = serializePathEncoding(component.path, pathNoScheme);
        } else {
          component.path = normalizePercentEncoding(component.path);
        }
      }
      if (options.reference !== "suffix" && component.scheme) {
        component.scheme = decodeValidScheme(component.scheme);
        uriTokens.push(component.scheme, ":");
      }
      const authority = recomposeAuthority(component);
      if (authority !== void 0) {
        if (options.reference !== "suffix") {
          uriTokens.push("//");
        }
        uriTokens.push(authority);
        if (component.path && component.path[0] !== "/") {
          uriTokens.push("/");
        }
      }
      if (component.path !== void 0) {
        let s = component.path;
        if (!options.absolutePath && (!schemeHandler || !schemeHandler.absolutePath)) {
          s = removeDotSegments(s);
        }
        if (pathNoScheme) {
          s = serializePathEncoding(s, true);
        }
        if (authority === void 0 && s[0] === "/" && s[1] === "/") {
          s = "/%2F" + s.slice(2);
        }
        uriTokens.push(s);
      }
      if (component.query !== void 0) {
        uriTokens.push("?", encodeQuery(component.query));
      }
      if (component.fragment !== void 0) {
        uriTokens.push("#", encodeFragment(component.fragment));
      }
      return uriTokens.join("");
    }
    var URI_PARSE = /^(?:([^#/:?]+):)?(?:\/\/((?:([^#/?@]*)@)?(\[[^#/?\]]+\]|[^#/:?]*)(?::(\d*))?))?([^#?]*)(?:\?([^#]*))?(?:#((?:.|[\n\r])*))?/u;
    var AUTHORITY_PREFIX = /^(?:[^#/:?]+:)?\/\/([^/?#]*)/;
    var AUTHORITY_INTRODUCER_REGION = /^(?:[^#/:?]+:)?([/\\\t\n\r]*)/;
    function getParseError(parsed, matches) {
      if (matches[2] !== void 0 && parsed.path && parsed.path[0] !== "/") {
        return 'URI path must start with "/" when authority is present.';
      }
      if (typeof parsed.port === "number" && (parsed.port < 0 || parsed.port > 65535)) {
        return "URI port is malformed.";
      }
      return void 0;
    }
    function hasMalformedPercentEncoding(component) {
      if (component === void 0) return false;
      let percent = component.indexOf("%");
      while (percent !== -1) {
        if (percent + 2 >= component.length || !/^[\da-f]{2}$/iu.test(component.slice(percent + 1, percent + 3))) {
          return true;
        }
        percent = component.indexOf("%", percent + 3);
      }
      return false;
    }
    function isIPLiteral(host) {
      return host[0] === "[" && host[host.length - 1] === "]";
    }
    function hasMalformedComponentPercentEncoding(matches) {
      const host = matches[4];
      return hasMalformedPercentEncoding(matches[3]) || host !== void 0 && !isIPLiteral(host) && hasMalformedPercentEncoding(host) || hasMalformedPercentEncoding(matches[6]) || hasMalformedPercentEncoding(matches[7]) || hasMalformedPercentEncoding(matches[8]);
    }
    function canonicalizeHost(parsed, options, schemeHandler, isIP) {
      if (!options.unicodeSupport && (!schemeHandler || !schemeHandler.unicodeSupport) && parsed.host && !isIPLiteral(parsed.host) && (options.domainHost || schemeHandler && schemeHandler.domainHost) && isIP === false && nonSimpleDomain(parsed.host)) {
        try {
          parsed.host = new URL("http://" + parsed.host).hostname;
        } catch (e) {
          parsed.error = parsed.error || "Host's domain name can not be converted to ASCII: " + e;
          return true;
        }
      }
      return false;
    }
    function parseWithStatus(uri, opts) {
      const options = Object.assign({}, opts);
      const parsed = {
        scheme: void 0,
        userinfo: void 0,
        host: "",
        port: void 0,
        path: "",
        query: void 0,
        fragment: void 0
      };
      let malformedAuthorityOrPort = false;
      let malformedPercentEncoding = false;
      let malformedSchemeSpecific = false;
      let malformedHost = false;
      let malformedIPLiteral = false;
      let malformedScheme = false;
      let isIP = false;
      if (options.reference === "suffix") {
        if (options.scheme) {
          uri = options.scheme + ":" + uri;
        } else {
          uri = "//" + uri;
        }
      }
      const authorityMatch = uri.match(AUTHORITY_PREFIX);
      if (authorityMatch !== null && authorityMatch[1].indexOf("\\") !== -1) {
        parsed.error = "URI authority must not contain a literal backslash.";
        malformedAuthorityOrPort = true;
      }
      const introducerMatch = uri.match(AUTHORITY_INTRODUCER_REGION);
      if (introducerMatch !== null) {
        const region = introducerMatch[1];
        const normalizedRegion = region.replace(/[\t\n\r]/g, "");
        if (normalizedRegion.length >= 2) {
          if (normalizedRegion.slice(0, 2) !== "//") {
            parsed.error = parsed.error || "URI authority must not contain a literal backslash.";
            malformedAuthorityOrPort = true;
          } else if (region.length !== normalizedRegion.length) {
            parsed.error = parsed.error || "URI authority introducer must not contain whitespace.";
            malformedAuthorityOrPort = true;
          }
        }
      }
      const matches = uri.match(URI_PARSE);
      if (matches) {
        parsed.scheme = matches[1];
        parsed.userinfo = matches[3];
        parsed.host = matches[4];
        parsed.port = parseInt(matches[5], 10);
        parsed.path = matches[6] || "";
        parsed.query = matches[7];
        parsed.fragment = matches[8];
        if (parsed.scheme !== void 0) {
          const decodedScheme = unescape(parsed.scheme);
          if (VALID_SCHEME.test(decodedScheme)) {
            parsed.scheme = decodedScheme.toLowerCase();
          } else {
            parsed.error = parsed.error || MALFORMED_SCHEME_ERROR;
            malformedScheme = true;
          }
        }
        malformedPercentEncoding = hasMalformedComponentPercentEncoding(matches);
        if (malformedPercentEncoding) {
          parsed.error = parsed.error || "URI contains malformed percent-encoding.";
        }
        if (isNaN(parsed.port)) {
          parsed.port = matches[5];
        }
        const parseError = getParseError(parsed, matches);
        if (parseError !== void 0) {
          parsed.error = parsed.error || parseError;
          malformedAuthorityOrPort = true;
        }
        if (parsed.host) {
          const ipv4result = isIPv4(parsed.host);
          if (ipv4result === false) {
            const bracketedIPLiteral = isIPLiteral(parsed.host);
            const hasIPLiteralBracket = parsed.host.indexOf("[") !== -1 || parsed.host.indexOf("]") !== -1;
            const ipv6result = normalizeIPv6(parsed.host);
            isIP = ipv6result.isIPV6 || ipv6result.isIPVFuture === true;
            malformedIPLiteral = hasIPLiteralBracket && (!bracketedIPLiteral || ipv6result.error === true);
            parsed.host = isIP ? ipv6result.host : ipv6result.host.toLowerCase();
            if (malformedIPLiteral) {
              parsed.error = parsed.error || "URI host is malformed.";
              malformedAuthorityOrPort = true;
            }
          } else {
            isIP = true;
          }
        }
        if (parsed.scheme === void 0 && parsed.userinfo === void 0 && parsed.host === void 0 && parsed.port === void 0 && parsed.query === void 0 && !parsed.path) {
          parsed.reference = "same-document";
        } else if (parsed.scheme === void 0) {
          parsed.reference = "relative";
        } else if (parsed.fragment === void 0) {
          parsed.reference = "absolute";
        } else {
          parsed.reference = "uri";
        }
        if (options.reference && options.reference !== "suffix" && options.reference !== parsed.reference) {
          parsed.error = parsed.error || "URI is not a " + options.reference + " reference.";
        }
        const schemeHandler = getSchemeHandler(options.scheme || parsed.scheme);
        if (!malformedIPLiteral) {
          malformedHost = canonicalizeHost(parsed, options, schemeHandler, isIP);
        }
        if (uri.indexOf("%") !== -1 && parsed.host !== void 0 && !malformedIPLiteral) {
          let host = isIP ? parsed.host : normalizePercentEncoding(parsed.host, true);
          if (!isIP) {
            host = normalizePercentEncoding(host.toLowerCase());
          }
          parsed.host = reescapeHostDelimiters(host, isIP);
        }
        if (!schemeHandler || schemeHandler && !schemeHandler.skipNormalize) {
          if (parsed.path) {
            parsed.path = normalizePathEncoding(parsed.path);
          }
          if (parsed.query) {
            parsed.query = normalizeQueryFragmentEncoding(parsed.query);
          }
          if (parsed.fragment) {
            parsed.fragment = normalizeQueryFragmentEncoding(parsed.fragment);
          }
        }
        if (schemeHandler && schemeHandler.parse) {
          schemeHandler.parse(parsed, options);
          if (schemeHandler === SCHEMES.urn && parsed.nid === void 0) {
            malformedSchemeSpecific = true;
          }
        }
      } else {
        parsed.error = parsed.error || "URI can not be parsed.";
      }
      return { parsed, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme };
    }
    function parse3(uri, opts) {
      return parseWithStatus(uri, opts).parsed;
    }
    function normalizeString(uri, opts) {
      return normalizeStringWithStatus(uri, opts).normalized;
    }
    function normalizeStringWithStatus(uri, opts) {
      const { parsed, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme } = parseWithStatus(uri, opts);
      return {
        normalized: malformedAuthorityOrPort || malformedPercentEncoding || malformedSchemeSpecific || malformedHost || malformedScheme ? uri : serialize(parsed, opts),
        malformedAuthorityOrPort,
        malformedPercentEncoding,
        malformedSchemeSpecific,
        malformedHost,
        malformedScheme
      };
    }
    function normalizeComparableURI(uri, opts) {
      if (typeof uri !== "string" && typeof uri !== "object") {
        return void 0;
      }
      let value;
      try {
        value = typeof uri === "string" ? uri : serialize(uri, opts);
      } catch {
        return void 0;
      }
      const { normalized, malformedAuthorityOrPort, malformedPercentEncoding, malformedSchemeSpecific, malformedHost, malformedScheme } = normalizeStringWithStatus(value, opts);
      return malformedAuthorityOrPort || malformedPercentEncoding || malformedSchemeSpecific || malformedHost || malformedScheme ? void 0 : normalized;
    }
    var fastUri = {
      SCHEMES,
      normalize,
      resolve,
      resolveComponent,
      equal,
      serialize,
      parse: parse3
    };
    module.exports = fastUri;
    module.exports.default = fastUri;
    module.exports.fastUri = fastUri;
  }
});

// node_modules/ajv/dist/runtime/uri.js
var require_uri = __commonJS({
  "node_modules/ajv/dist/runtime/uri.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var uri = require_fast_uri();
    uri.code = 'require("ajv/dist/runtime/uri").default';
    exports.default = uri;
  }
});

// node_modules/ajv/dist/core.js
var require_core = __commonJS({
  "node_modules/ajv/dist/core.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = void 0;
    var validate_1 = require_validate();
    Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
      return codegen_1.CodeGen;
    } });
    var validation_error_1 = require_validation_error();
    var ref_error_1 = require_ref_error();
    var rules_1 = require_rules();
    var compile_1 = require_compile();
    var codegen_2 = require_codegen();
    var resolve_1 = require_resolve();
    var dataType_1 = require_dataType();
    var util_1 = require_util();
    var $dataRefSchema = require_data();
    var uri_1 = require_uri();
    var defaultRegExp = (str, flags) => new RegExp(str, flags);
    defaultRegExp.code = "new RegExp";
    var META_IGNORE_OPTIONS = ["removeAdditional", "useDefaults", "coerceTypes"];
    var EXT_SCOPE_NAMES = /* @__PURE__ */ new Set([
      "validate",
      "serialize",
      "parse",
      "wrapper",
      "root",
      "schema",
      "keyword",
      "pattern",
      "formats",
      "validate$data",
      "func",
      "obj",
      "Error"
    ]);
    var removedOptions = {
      errorDataPath: "",
      format: "`validateFormats: false` can be used instead.",
      nullable: '"nullable" keyword is supported by default.',
      jsonPointers: "Deprecated jsPropertySyntax can be used instead.",
      extendRefs: "Deprecated ignoreKeywordsWithRef can be used instead.",
      missingRefs: "Pass empty schema with $id that should be ignored to ajv.addSchema.",
      processCode: "Use option `code: {process: (code, schemaEnv: object) => string}`",
      sourceCode: "Use option `code: {source: true}`",
      strictDefaults: "It is default now, see option `strict`.",
      strictKeywords: "It is default now, see option `strict`.",
      uniqueItems: '"uniqueItems" keyword is always validated.',
      unknownFormats: "Disable strict mode or pass `true` to `ajv.addFormat` (or `formats` option).",
      cache: "Map is used as cache, schema object as key.",
      serialize: "Map is used as cache, schema object as key.",
      ajvErrors: "It is default now."
    };
    var deprecatedOptions = {
      ignoreKeywordsWithRef: "",
      jsPropertySyntax: "",
      unicode: '"minLength"/"maxLength" account for unicode characters by default.'
    };
    var MAX_EXPRESSION = 200;
    function requiredOptions(o) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
      const s = o.strict;
      const _optz = (_a = o.code) === null || _a === void 0 ? void 0 : _a.optimize;
      const optimize = _optz === true || _optz === void 0 ? 1 : _optz || 0;
      const regExp = (_c = (_b = o.code) === null || _b === void 0 ? void 0 : _b.regExp) !== null && _c !== void 0 ? _c : defaultRegExp;
      const uriResolver = (_d = o.uriResolver) !== null && _d !== void 0 ? _d : uri_1.default;
      return {
        strictSchema: (_f = (_e = o.strictSchema) !== null && _e !== void 0 ? _e : s) !== null && _f !== void 0 ? _f : true,
        strictNumbers: (_h = (_g = o.strictNumbers) !== null && _g !== void 0 ? _g : s) !== null && _h !== void 0 ? _h : true,
        strictTypes: (_k = (_j = o.strictTypes) !== null && _j !== void 0 ? _j : s) !== null && _k !== void 0 ? _k : "log",
        strictTuples: (_m = (_l = o.strictTuples) !== null && _l !== void 0 ? _l : s) !== null && _m !== void 0 ? _m : "log",
        strictRequired: (_p = (_o = o.strictRequired) !== null && _o !== void 0 ? _o : s) !== null && _p !== void 0 ? _p : false,
        code: o.code ? { ...o.code, optimize, regExp } : { optimize, regExp },
        loopRequired: (_q = o.loopRequired) !== null && _q !== void 0 ? _q : MAX_EXPRESSION,
        loopEnum: (_r = o.loopEnum) !== null && _r !== void 0 ? _r : MAX_EXPRESSION,
        meta: (_s = o.meta) !== null && _s !== void 0 ? _s : true,
        messages: (_t = o.messages) !== null && _t !== void 0 ? _t : true,
        inlineRefs: (_u = o.inlineRefs) !== null && _u !== void 0 ? _u : true,
        schemaId: (_v = o.schemaId) !== null && _v !== void 0 ? _v : "$id",
        addUsedSchema: (_w = o.addUsedSchema) !== null && _w !== void 0 ? _w : true,
        validateSchema: (_x = o.validateSchema) !== null && _x !== void 0 ? _x : true,
        validateFormats: (_y = o.validateFormats) !== null && _y !== void 0 ? _y : true,
        unicodeRegExp: (_z = o.unicodeRegExp) !== null && _z !== void 0 ? _z : true,
        int32range: (_0 = o.int32range) !== null && _0 !== void 0 ? _0 : true,
        uriResolver
      };
    }
    var Ajv2 = class {
      constructor(opts = {}) {
        this.schemas = {};
        this.refs = {};
        this.formats = /* @__PURE__ */ Object.create(null);
        this._compilations = /* @__PURE__ */ new Set();
        this._loading = {};
        this._cache = /* @__PURE__ */ new Map();
        opts = this.opts = { ...opts, ...requiredOptions(opts) };
        const { es5, lines } = this.opts.code;
        this.scope = new codegen_2.ValueScope({ scope: {}, prefixes: EXT_SCOPE_NAMES, es5, lines });
        this.logger = getLogger(opts.logger);
        const formatOpt = opts.validateFormats;
        opts.validateFormats = false;
        this.RULES = (0, rules_1.getRules)();
        checkOptions.call(this, removedOptions, opts, "NOT SUPPORTED");
        checkOptions.call(this, deprecatedOptions, opts, "DEPRECATED", "warn");
        this._metaOpts = getMetaSchemaOptions.call(this);
        if (opts.formats)
          addInitialFormats.call(this);
        this._addVocabularies();
        this._addDefaultMetaSchema();
        if (opts.keywords)
          addInitialKeywords.call(this, opts.keywords);
        if (typeof opts.meta == "object")
          this.addMetaSchema(opts.meta);
        addInitialSchemas.call(this);
        opts.validateFormats = formatOpt;
      }
      _addVocabularies() {
        this.addKeyword("$async");
      }
      _addDefaultMetaSchema() {
        const { $data, meta, schemaId } = this.opts;
        let _dataRefSchema = $dataRefSchema;
        if (schemaId === "id") {
          _dataRefSchema = { ...$dataRefSchema };
          _dataRefSchema.id = _dataRefSchema.$id;
          delete _dataRefSchema.$id;
        }
        if (meta && $data)
          this.addMetaSchema(_dataRefSchema, _dataRefSchema[schemaId], false);
      }
      defaultMeta() {
        const { meta, schemaId } = this.opts;
        return this.opts.defaultMeta = typeof meta == "object" ? meta[schemaId] || meta : void 0;
      }
      validate(schemaKeyRef, data) {
        let v;
        if (typeof schemaKeyRef == "string") {
          v = this.getSchema(schemaKeyRef);
          if (!v)
            throw new Error(`no schema with key or ref "${schemaKeyRef}"`);
        } else {
          v = this.compile(schemaKeyRef);
        }
        const valid = v(data);
        if (!("$async" in v))
          this.errors = v.errors;
        return valid;
      }
      compile(schema, _meta) {
        const sch = this._addSchema(schema, _meta);
        return sch.validate || this._compileSchemaEnv(sch);
      }
      compileAsync(schema, meta) {
        if (typeof this.opts.loadSchema != "function") {
          throw new Error("options.loadSchema should be a function");
        }
        const { loadSchema } = this.opts;
        return runCompileAsync.call(this, schema, meta);
        async function runCompileAsync(_schema, _meta) {
          await loadMetaSchema.call(this, _schema.$schema);
          const sch = this._addSchema(_schema, _meta);
          return sch.validate || _compileAsync.call(this, sch);
        }
        async function loadMetaSchema($ref) {
          if ($ref && !this.getSchema($ref)) {
            await runCompileAsync.call(this, { $ref }, true);
          }
        }
        async function _compileAsync(sch) {
          try {
            return this._compileSchemaEnv(sch);
          } catch (e) {
            if (!(e instanceof ref_error_1.default))
              throw e;
            checkLoaded.call(this, e);
            await loadMissingSchema.call(this, e.missingSchema);
            return _compileAsync.call(this, sch);
          }
        }
        function checkLoaded({ missingSchema: ref, missingRef }) {
          if (this.refs[ref]) {
            throw new Error(`AnySchema ${ref} is loaded but ${missingRef} cannot be resolved`);
          }
        }
        async function loadMissingSchema(ref) {
          const _schema = await _loadSchema.call(this, ref);
          if (!this.refs[ref])
            await loadMetaSchema.call(this, _schema.$schema);
          if (!this.refs[ref])
            this.addSchema(_schema, ref, meta);
        }
        async function _loadSchema(ref) {
          const p = this._loading[ref];
          if (p)
            return p;
          try {
            return await (this._loading[ref] = loadSchema(ref));
          } finally {
            delete this._loading[ref];
          }
        }
      }
      // Adds schema to the instance
      addSchema(schema, key, _meta, _validateSchema = this.opts.validateSchema) {
        if (Array.isArray(schema)) {
          for (const sch of schema)
            this.addSchema(sch, void 0, _meta, _validateSchema);
          return this;
        }
        let id;
        if (typeof schema === "object") {
          const { schemaId } = this.opts;
          id = schema[schemaId];
          if (id !== void 0 && typeof id != "string") {
            throw new Error(`schema ${schemaId} must be string`);
          }
        }
        key = (0, resolve_1.normalizeId)(key || id);
        this._checkUnique(key);
        this.schemas[key] = this._addSchema(schema, _meta, key, _validateSchema, true);
        return this;
      }
      // Add schema that will be used to validate other schemas
      // options in META_IGNORE_OPTIONS are alway set to false
      addMetaSchema(schema, key, _validateSchema = this.opts.validateSchema) {
        this.addSchema(schema, key, true, _validateSchema);
        return this;
      }
      //  Validate schema against its meta-schema
      validateSchema(schema, throwOrLogError) {
        if (typeof schema == "boolean")
          return true;
        let $schema;
        $schema = schema.$schema;
        if ($schema !== void 0 && typeof $schema != "string") {
          throw new Error("$schema must be a string");
        }
        $schema = $schema || this.opts.defaultMeta || this.defaultMeta();
        if (!$schema) {
          this.logger.warn("meta-schema not available");
          this.errors = null;
          return true;
        }
        const valid = this.validate($schema, schema);
        if (!valid && throwOrLogError) {
          const message = "schema is invalid: " + this.errorsText();
          if (this.opts.validateSchema === "log")
            this.logger.error(message);
          else
            throw new Error(message);
        }
        return valid;
      }
      // Get compiled schema by `key` or `ref`.
      // (`key` that was passed to `addSchema` or full schema reference - `schema.$id` or resolved id)
      getSchema(keyRef) {
        let sch;
        while (typeof (sch = getSchEnv.call(this, keyRef)) == "string")
          keyRef = sch;
        if (sch === void 0) {
          const { schemaId } = this.opts;
          const root = new compile_1.SchemaEnv({ schema: {}, schemaId });
          sch = compile_1.resolveSchema.call(this, root, keyRef);
          if (!sch)
            return;
          this.refs[keyRef] = sch;
        }
        return sch.validate || this._compileSchemaEnv(sch);
      }
      // Remove cached schema(s).
      // If no parameter is passed all schemas but meta-schemas are removed.
      // If RegExp is passed all schemas with key/id matching pattern but meta-schemas are removed.
      // Even if schema is referenced by other schemas it still can be removed as other schemas have local references.
      removeSchema(schemaKeyRef) {
        if (schemaKeyRef instanceof RegExp) {
          this._removeAllSchemas(this.schemas, schemaKeyRef);
          this._removeAllSchemas(this.refs, schemaKeyRef);
          return this;
        }
        switch (typeof schemaKeyRef) {
          case "undefined":
            this._removeAllSchemas(this.schemas);
            this._removeAllSchemas(this.refs);
            this._cache.clear();
            return this;
          case "string": {
            const sch = getSchEnv.call(this, schemaKeyRef);
            if (typeof sch == "object")
              this._cache.delete(sch.schema);
            delete this.schemas[schemaKeyRef];
            delete this.refs[schemaKeyRef];
            return this;
          }
          case "object": {
            const cacheKey = schemaKeyRef;
            this._cache.delete(cacheKey);
            let id = schemaKeyRef[this.opts.schemaId];
            if (id) {
              id = (0, resolve_1.normalizeId)(id);
              delete this.schemas[id];
              delete this.refs[id];
            }
            return this;
          }
          default:
            throw new Error("ajv.removeSchema: invalid parameter");
        }
      }
      // add "vocabulary" - a collection of keywords
      addVocabulary(definitions) {
        for (const def of definitions)
          this.addKeyword(def);
        return this;
      }
      addKeyword(kwdOrDef, def) {
        let keyword;
        if (typeof kwdOrDef == "string") {
          keyword = kwdOrDef;
          if (typeof def == "object") {
            this.logger.warn("these parameters are deprecated, see docs for addKeyword");
            def.keyword = keyword;
          }
        } else if (typeof kwdOrDef == "object" && def === void 0) {
          def = kwdOrDef;
          keyword = def.keyword;
          if (Array.isArray(keyword) && !keyword.length) {
            throw new Error("addKeywords: keyword must be string or non-empty array");
          }
        } else {
          throw new Error("invalid addKeywords parameters");
        }
        checkKeyword.call(this, keyword, def);
        if (!def) {
          (0, util_1.eachItem)(keyword, (kwd) => addRule.call(this, kwd));
          return this;
        }
        keywordMetaschema.call(this, def);
        const definition = {
          ...def,
          type: (0, dataType_1.getJSONTypes)(def.type),
          schemaType: (0, dataType_1.getJSONTypes)(def.schemaType)
        };
        (0, util_1.eachItem)(keyword, definition.type.length === 0 ? (k) => addRule.call(this, k, definition) : (k) => definition.type.forEach((t) => addRule.call(this, k, definition, t)));
        return this;
      }
      getKeyword(keyword) {
        const rule = this.RULES.all[keyword];
        return typeof rule == "object" ? rule.definition : !!rule;
      }
      // Remove keyword
      removeKeyword(keyword) {
        const { RULES } = this;
        delete RULES.keywords[keyword];
        delete RULES.all[keyword];
        for (const group of RULES.rules) {
          const i = group.rules.findIndex((rule) => rule.keyword === keyword);
          if (i >= 0)
            group.rules.splice(i, 1);
        }
        return this;
      }
      // Add format
      addFormat(name, format) {
        if (typeof format == "string")
          format = new RegExp(format);
        this.formats[name] = format;
        return this;
      }
      errorsText(errors = this.errors, { separator = ", ", dataVar = "data" } = {}) {
        if (!errors || errors.length === 0)
          return "No errors";
        return errors.map((e) => `${dataVar}${e.instancePath} ${e.message}`).reduce((text, msg) => text + separator + msg);
      }
      $dataMetaSchema(metaSchema, keywordsJsonPointers) {
        const rules = this.RULES.all;
        metaSchema = JSON.parse(JSON.stringify(metaSchema));
        for (const jsonPointer of keywordsJsonPointers) {
          const segments = jsonPointer.split("/").slice(1);
          let keywords = metaSchema;
          for (const seg of segments)
            keywords = keywords[seg];
          for (const key in rules) {
            const rule = rules[key];
            if (typeof rule != "object")
              continue;
            const { $data } = rule.definition;
            const schema = keywords[key];
            if ($data && schema)
              keywords[key] = schemaOrData(schema);
          }
        }
        return metaSchema;
      }
      _removeAllSchemas(schemas, regex) {
        for (const keyRef in schemas) {
          const sch = schemas[keyRef];
          if (!regex || regex.test(keyRef)) {
            if (typeof sch == "string") {
              delete schemas[keyRef];
            } else if (sch && !sch.meta) {
              this._cache.delete(sch.schema);
              delete schemas[keyRef];
            }
          }
        }
      }
      _addSchema(schema, meta, baseId, validateSchema = this.opts.validateSchema, addSchema = this.opts.addUsedSchema) {
        let id;
        const { schemaId } = this.opts;
        if (typeof schema == "object") {
          id = schema[schemaId];
        } else {
          if (this.opts.jtd)
            throw new Error("schema must be object");
          else if (typeof schema != "boolean")
            throw new Error("schema must be object or boolean");
        }
        let sch = this._cache.get(schema);
        if (sch !== void 0)
          return sch;
        baseId = (0, resolve_1.normalizeId)(id || baseId);
        const localRefs = resolve_1.getSchemaRefs.call(this, schema, baseId);
        sch = new compile_1.SchemaEnv({ schema, schemaId, meta, baseId, localRefs });
        this._cache.set(sch.schema, sch);
        if (addSchema && !baseId.startsWith("#")) {
          if (baseId)
            this._checkUnique(baseId);
          this.refs[baseId] = sch;
        }
        if (validateSchema)
          this.validateSchema(schema, true);
        return sch;
      }
      _checkUnique(id) {
        if (this.schemas[id] || this.refs[id]) {
          throw new Error(`schema with key or id "${id}" already exists`);
        }
      }
      _compileSchemaEnv(sch) {
        if (sch.meta)
          this._compileMetaSchema(sch);
        else
          compile_1.compileSchema.call(this, sch);
        if (!sch.validate)
          throw new Error("ajv implementation error");
        return sch.validate;
      }
      _compileMetaSchema(sch) {
        const currentOpts = this.opts;
        this.opts = this._metaOpts;
        try {
          compile_1.compileSchema.call(this, sch);
        } finally {
          this.opts = currentOpts;
        }
      }
    };
    Ajv2.ValidationError = validation_error_1.default;
    Ajv2.MissingRefError = ref_error_1.default;
    exports.default = Ajv2;
    function checkOptions(checkOpts, options, msg, log = "error") {
      for (const key in checkOpts) {
        const opt = key;
        if (opt in options)
          this.logger[log](`${msg}: option ${key}. ${checkOpts[opt]}`);
      }
    }
    function getSchEnv(keyRef) {
      keyRef = (0, resolve_1.normalizeId)(keyRef);
      return this.schemas[keyRef] || this.refs[keyRef];
    }
    function addInitialSchemas() {
      const optsSchemas = this.opts.schemas;
      if (!optsSchemas)
        return;
      if (Array.isArray(optsSchemas))
        this.addSchema(optsSchemas);
      else
        for (const key in optsSchemas)
          this.addSchema(optsSchemas[key], key);
    }
    function addInitialFormats() {
      for (const name in this.opts.formats) {
        const format = this.opts.formats[name];
        if (format)
          this.addFormat(name, format);
      }
    }
    function addInitialKeywords(defs) {
      if (Array.isArray(defs)) {
        this.addVocabulary(defs);
        return;
      }
      this.logger.warn("keywords option as map is deprecated, pass array");
      for (const keyword in defs) {
        const def = defs[keyword];
        if (!def.keyword)
          def.keyword = keyword;
        this.addKeyword(def);
      }
    }
    function getMetaSchemaOptions() {
      const metaOpts = { ...this.opts };
      for (const opt of META_IGNORE_OPTIONS)
        delete metaOpts[opt];
      return metaOpts;
    }
    var noLogs = { log() {
    }, warn() {
    }, error() {
    } };
    function getLogger(logger) {
      if (logger === false)
        return noLogs;
      if (logger === void 0)
        return console;
      if (logger.log && logger.warn && logger.error)
        return logger;
      throw new Error("logger must implement log, warn and error methods");
    }
    var KEYWORD_NAME = /^[a-z_$][a-z0-9_$:-]*$/i;
    function checkKeyword(keyword, def) {
      const { RULES } = this;
      (0, util_1.eachItem)(keyword, (kwd) => {
        if (RULES.keywords[kwd])
          throw new Error(`Keyword ${kwd} is already defined`);
        if (!KEYWORD_NAME.test(kwd))
          throw new Error(`Keyword ${kwd} has invalid name`);
      });
      if (!def)
        return;
      if (def.$data && !("code" in def || "validate" in def)) {
        throw new Error('$data keyword must have "code" or "validate" function');
      }
    }
    function addRule(keyword, definition, dataType) {
      var _a;
      const post = definition === null || definition === void 0 ? void 0 : definition.post;
      if (dataType && post)
        throw new Error('keyword with "post" flag cannot have "type"');
      const { RULES } = this;
      let ruleGroup = post ? RULES.post : RULES.rules.find(({ type: t }) => t === dataType);
      if (!ruleGroup) {
        ruleGroup = { type: dataType, rules: [] };
        RULES.rules.push(ruleGroup);
      }
      RULES.keywords[keyword] = true;
      if (!definition)
        return;
      const rule = {
        keyword,
        definition: {
          ...definition,
          type: (0, dataType_1.getJSONTypes)(definition.type),
          schemaType: (0, dataType_1.getJSONTypes)(definition.schemaType)
        }
      };
      if (definition.before)
        addBeforeRule.call(this, ruleGroup, rule, definition.before);
      else
        ruleGroup.rules.push(rule);
      RULES.all[keyword] = rule;
      (_a = definition.implements) === null || _a === void 0 ? void 0 : _a.forEach((kwd) => this.addKeyword(kwd));
    }
    function addBeforeRule(ruleGroup, rule, before) {
      const i = ruleGroup.rules.findIndex((_rule) => _rule.keyword === before);
      if (i >= 0) {
        ruleGroup.rules.splice(i, 0, rule);
      } else {
        ruleGroup.rules.push(rule);
        this.logger.warn(`rule ${before} is not defined`);
      }
    }
    function keywordMetaschema(def) {
      let { metaSchema } = def;
      if (metaSchema === void 0)
        return;
      if (def.$data && this.opts.$data)
        metaSchema = schemaOrData(metaSchema);
      def.validateSchema = this.compile(metaSchema, true);
    }
    var $dataRef = {
      $ref: "https://raw.githubusercontent.com/ajv-validator/ajv/master/lib/refs/data.json#"
    };
    function schemaOrData(schema) {
      return { anyOf: [schema, $dataRef] };
    }
  }
});

// node_modules/ajv/dist/vocabularies/core/id.js
var require_id = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/id.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var def = {
      keyword: "id",
      code() {
        throw new Error('NOT SUPPORTED: keyword "id", use "$id" for schema ID');
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/core/ref.js
var require_ref = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/ref.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.callRef = exports.getValidate = void 0;
    var ref_error_1 = require_ref_error();
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var compile_1 = require_compile();
    var util_1 = require_util();
    var def = {
      keyword: "$ref",
      schemaType: "string",
      code(cxt) {
        const { gen, schema: $ref, it } = cxt;
        const { baseId, schemaEnv: env, validateName, opts, self } = it;
        const { root } = env;
        if (($ref === "#" || $ref === "#/") && baseId === root.baseId)
          return callRootRef();
        const schOrEnv = compile_1.resolveRef.call(self, root, baseId, $ref);
        if (schOrEnv === void 0)
          throw new ref_error_1.default(it.opts.uriResolver, baseId, $ref);
        if (schOrEnv instanceof compile_1.SchemaEnv)
          return callValidate(schOrEnv);
        return inlineRefSchema(schOrEnv);
        function callRootRef() {
          if (env === root)
            return callRef(cxt, validateName, env, env.$async);
          const rootName = gen.scopeValue("root", { ref: root });
          return callRef(cxt, (0, codegen_1._)`${rootName}.validate`, root, root.$async);
        }
        function callValidate(sch) {
          const v = getValidate(cxt, sch);
          callRef(cxt, v, sch, sch.$async);
        }
        function inlineRefSchema(sch) {
          const schName = gen.scopeValue("schema", opts.code.source === true ? { ref: sch, code: (0, codegen_1.stringify)(sch) } : { ref: sch });
          const valid = gen.name("valid");
          const schCxt = cxt.subschema({
            schema: sch,
            dataTypes: [],
            schemaPath: codegen_1.nil,
            topSchemaRef: schName,
            errSchemaPath: $ref
          }, valid);
          cxt.mergeEvaluated(schCxt);
          cxt.ok(valid);
        }
      }
    };
    function getValidate(cxt, sch) {
      const { gen } = cxt;
      return sch.validate ? gen.scopeValue("validate", { ref: sch.validate }) : (0, codegen_1._)`${gen.scopeValue("wrapper", { ref: sch })}.validate`;
    }
    exports.getValidate = getValidate;
    function callRef(cxt, v, sch, $async) {
      const { gen, it } = cxt;
      const { allErrors, schemaEnv: env, opts } = it;
      const passCxt = opts.passContext ? names_1.default.this : codegen_1.nil;
      if ($async)
        callAsyncRef();
      else
        callSyncRef();
      function callAsyncRef() {
        if (!env.$async)
          throw new Error("async schema referenced by sync schema");
        const valid = gen.let("valid");
        gen.try(() => {
          gen.code((0, codegen_1._)`await ${(0, code_1.callValidateCode)(cxt, v, passCxt)}`);
          addEvaluatedFrom(v);
          if (!allErrors)
            gen.assign(valid, true);
        }, (e) => {
          gen.if((0, codegen_1._)`!(${e} instanceof ${it.ValidationError})`, () => gen.throw(e));
          addErrorsFrom(e);
          if (!allErrors)
            gen.assign(valid, false);
        });
        cxt.ok(valid);
      }
      function callSyncRef() {
        cxt.result((0, code_1.callValidateCode)(cxt, v, passCxt), () => addEvaluatedFrom(v), () => addErrorsFrom(v));
      }
      function addErrorsFrom(source) {
        const errs = (0, codegen_1._)`${source}.errors`;
        gen.assign(names_1.default.vErrors, (0, codegen_1._)`${names_1.default.vErrors} === null ? ${errs} : ${names_1.default.vErrors}.concat(${errs})`);
        gen.assign(names_1.default.errors, (0, codegen_1._)`${names_1.default.vErrors}.length`);
      }
      function addEvaluatedFrom(source) {
        var _a;
        if (!it.opts.unevaluated)
          return;
        const schEvaluated = (_a = sch === null || sch === void 0 ? void 0 : sch.validate) === null || _a === void 0 ? void 0 : _a.evaluated;
        if (it.props !== true) {
          if (schEvaluated && !schEvaluated.dynamicProps) {
            if (schEvaluated.props !== void 0) {
              it.props = util_1.mergeEvaluated.props(gen, schEvaluated.props, it.props);
            }
          } else {
            const props = gen.var("props", (0, codegen_1._)`${source}.evaluated.props`);
            it.props = util_1.mergeEvaluated.props(gen, props, it.props, codegen_1.Name);
          }
        }
        if (it.items !== true) {
          if (schEvaluated && !schEvaluated.dynamicItems) {
            if (schEvaluated.items !== void 0) {
              it.items = util_1.mergeEvaluated.items(gen, schEvaluated.items, it.items);
            }
          } else {
            const items = gen.var("items", (0, codegen_1._)`${source}.evaluated.items`);
            it.items = util_1.mergeEvaluated.items(gen, items, it.items, codegen_1.Name);
          }
        }
      }
    }
    exports.callRef = callRef;
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/core/index.js
var require_core2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/core/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var id_1 = require_id();
    var ref_1 = require_ref();
    var core = [
      "$schema",
      "$id",
      "$defs",
      "$vocabulary",
      { keyword: "$comment" },
      "definitions",
      id_1.default,
      ref_1.default
    ];
    exports.default = core;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitNumber.js
var require_limitNumber = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitNumber.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var ops = codegen_1.operators;
    var KWDs = {
      maximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
      minimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
      exclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
      exclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
    };
    var error2 = {
      message: ({ keyword, schemaCode }) => (0, codegen_1.str)`must be ${KWDs[keyword].okStr} ${schemaCode}`,
      params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
    };
    var def = {
      keyword: Object.keys(KWDs),
      type: "number",
      schemaType: "number",
      $data: true,
      error: error2,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        cxt.fail$data((0, codegen_1._)`${data} ${KWDs[keyword].fail} ${schemaCode} || isNaN(${data})`);
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/multipleOf.js
var require_multipleOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/multipleOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error2 = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must be multiple of ${schemaCode}`,
      params: ({ schemaCode }) => (0, codegen_1._)`{multipleOf: ${schemaCode}}`
    };
    var def = {
      keyword: "multipleOf",
      type: "number",
      schemaType: "number",
      $data: true,
      error: error2,
      code(cxt) {
        const { gen, data, schemaCode, it } = cxt;
        const prec = it.opts.multipleOfPrecision;
        const res = gen.let("res");
        const invalid = prec ? (0, codegen_1._)`Math.abs(Math.round(${res}) - ${res}) > 1e-${prec}` : (0, codegen_1._)`${res} !== parseInt(${res})`;
        cxt.fail$data((0, codegen_1._)`(${schemaCode} === 0 || (${res} = ${data}/${schemaCode}, ${invalid}))`);
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "node_modules/ajv/dist/runtime/ucs2length.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitLength.js
var require_limitLength = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitLength.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var ucs2length_1 = require_ucs2length();
    var error2 = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxLength" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} characters`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxLength", "minLength"],
      type: "string",
      schemaType: "number",
      $data: true,
      error: error2,
      code(cxt) {
        const { keyword, data, schemaCode, it } = cxt;
        const op = keyword === "maxLength" ? codegen_1.operators.GT : codegen_1.operators.LT;
        const len = it.opts.unicode === false ? (0, codegen_1._)`${data}.length` : (0, codegen_1._)`${(0, util_1.useFunc)(cxt.gen, ucs2length_1.default)}(${data})`;
        cxt.fail$data((0, codegen_1._)`${len} ${op} ${schemaCode}`);
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/pattern.js
var require_pattern = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/pattern.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var util_1 = require_util();
    var codegen_1 = require_codegen();
    var error2 = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must match pattern "${schemaCode}"`,
      params: ({ schemaCode }) => (0, codegen_1._)`{pattern: ${schemaCode}}`
    };
    var def = {
      keyword: "pattern",
      type: "string",
      schemaType: "string",
      $data: true,
      error: error2,
      code(cxt) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        const u = it.opts.unicodeRegExp ? "u" : "";
        if ($data) {
          const { regExp } = it.opts.code;
          const regExpCode = regExp.code === "new RegExp" ? (0, codegen_1._)`new RegExp` : (0, util_1.useFunc)(gen, regExp);
          const valid = gen.let("valid");
          gen.try(() => gen.assign(valid, (0, codegen_1._)`${regExpCode}(${schemaCode}, ${u}).test(${data})`), () => gen.assign(valid, false));
          cxt.fail$data((0, codegen_1._)`!${valid}`);
        } else {
          const regExp = (0, code_1.usePattern)(cxt, schema);
          cxt.fail$data((0, codegen_1._)`!${regExp}.test(${data})`);
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitProperties.js
var require_limitProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitProperties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error2 = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxProperties" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} properties`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxProperties", "minProperties"],
      type: "object",
      schemaType: "number",
      $data: true,
      error: error2,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        const op = keyword === "maxProperties" ? codegen_1.operators.GT : codegen_1.operators.LT;
        cxt.fail$data((0, codegen_1._)`Object.keys(${data}).length ${op} ${schemaCode}`);
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/required.js
var require_required = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/required.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error2 = {
      message: ({ params: { missingProperty } }) => (0, codegen_1.str)`must have required property '${missingProperty}'`,
      params: ({ params: { missingProperty } }) => (0, codegen_1._)`{missingProperty: ${missingProperty}}`
    };
    var def = {
      keyword: "required",
      type: "object",
      schemaType: "array",
      $data: true,
      error: error2,
      code(cxt) {
        const { gen, schema, schemaCode, data, $data, it } = cxt;
        const { opts } = it;
        if (!$data && schema.length === 0)
          return;
        const useLoop = schema.length >= opts.loopRequired;
        if (it.allErrors)
          allErrorsMode();
        else
          exitOnErrorMode();
        if (opts.strictRequired) {
          const props = cxt.parentSchema.properties;
          const { definedProperties } = cxt.it;
          for (const requiredKey of schema) {
            if ((props === null || props === void 0 ? void 0 : props[requiredKey]) === void 0 && !definedProperties.has(requiredKey)) {
              const schemaPath = it.schemaEnv.baseId + it.errSchemaPath;
              const msg = `required property "${requiredKey}" is not defined at "${schemaPath}" (strictRequired)`;
              (0, util_1.checkStrictMode)(it, msg, it.opts.strictRequired);
            }
          }
        }
        function allErrorsMode() {
          if (useLoop || $data) {
            cxt.block$data(codegen_1.nil, loopAllRequired);
          } else {
            for (const prop of schema) {
              (0, code_1.checkReportMissingProp)(cxt, prop);
            }
          }
        }
        function exitOnErrorMode() {
          const missing = gen.let("missing");
          if (useLoop || $data) {
            const valid = gen.let("valid", true);
            cxt.block$data(valid, () => loopUntilMissing(missing, valid));
            cxt.ok(valid);
          } else {
            gen.if((0, code_1.checkMissingProp)(cxt, schema, missing));
            (0, code_1.reportMissingProp)(cxt, missing);
            gen.else();
          }
        }
        function loopAllRequired() {
          gen.forOf("prop", schemaCode, (prop) => {
            cxt.setParams({ missingProperty: prop });
            gen.if((0, code_1.noPropertyInData)(gen, data, prop, opts.ownProperties), () => cxt.error());
          });
        }
        function loopUntilMissing(missing, valid) {
          cxt.setParams({ missingProperty: missing });
          gen.forOf(missing, schemaCode, () => {
            gen.assign(valid, (0, code_1.propertyInData)(gen, data, missing, opts.ownProperties));
            gen.if((0, codegen_1.not)(valid), () => {
              cxt.error();
              gen.break();
            });
          }, codegen_1.nil);
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/limitItems.js
var require_limitItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/limitItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error2 = {
      message({ keyword, schemaCode }) {
        const comp = keyword === "maxItems" ? "more" : "fewer";
        return (0, codegen_1.str)`must NOT have ${comp} than ${schemaCode} items`;
      },
      params: ({ schemaCode }) => (0, codegen_1._)`{limit: ${schemaCode}}`
    };
    var def = {
      keyword: ["maxItems", "minItems"],
      type: "array",
      schemaType: "number",
      $data: true,
      error: error2,
      code(cxt) {
        const { keyword, data, schemaCode } = cxt;
        const op = keyword === "maxItems" ? codegen_1.operators.GT : codegen_1.operators.LT;
        cxt.fail$data((0, codegen_1._)`${data}.length ${op} ${schemaCode}`);
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS({
  "node_modules/ajv/dist/runtime/equal.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var equal = require_fast_deep_equal();
    equal.code = 'require("ajv/dist/runtime/equal").default';
    exports.default = equal;
  }
});

// node_modules/ajv/dist/vocabularies/validation/uniqueItems.js
var require_uniqueItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/uniqueItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var dataType_1 = require_dataType();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error2 = {
      message: ({ params: { i, j } }) => (0, codegen_1.str)`must NOT have duplicate items (items ## ${j} and ${i} are identical)`,
      params: ({ params: { i, j } }) => (0, codegen_1._)`{i: ${i}, j: ${j}}`
    };
    var def = {
      keyword: "uniqueItems",
      type: "array",
      schemaType: "boolean",
      $data: true,
      error: error2,
      code(cxt) {
        const { gen, data, $data, schema, parentSchema, schemaCode, it } = cxt;
        if (!$data && !schema)
          return;
        const valid = gen.let("valid");
        const itemTypes = parentSchema.items ? (0, dataType_1.getSchemaTypes)(parentSchema.items) : [];
        cxt.block$data(valid, validateUniqueItems, (0, codegen_1._)`${schemaCode} === false`);
        cxt.ok(valid);
        function validateUniqueItems() {
          const i = gen.let("i", (0, codegen_1._)`${data}.length`);
          const j = gen.let("j");
          cxt.setParams({ i, j });
          gen.assign(valid, true);
          gen.if((0, codegen_1._)`${i} > 1`, () => (canOptimize() ? loopN : loopN2)(i, j));
        }
        function canOptimize() {
          return itemTypes.length > 0 && !itemTypes.some((t) => t === "object" || t === "array");
        }
        function loopN(i, j) {
          const item = gen.name("item");
          const wrongType = (0, dataType_1.checkDataTypes)(itemTypes, item, it.opts.strictNumbers, dataType_1.DataType.Wrong);
          const indices = gen.const("indices", (0, codegen_1._)`{}`);
          gen.for((0, codegen_1._)`;${i}--;`, () => {
            gen.let(item, (0, codegen_1._)`${data}[${i}]`);
            gen.if(wrongType, (0, codegen_1._)`continue`);
            if (itemTypes.length > 1)
              gen.if((0, codegen_1._)`typeof ${item} == "string"`, (0, codegen_1._)`${item} += "_"`);
            gen.if((0, codegen_1._)`typeof ${indices}[${item}] == "number"`, () => {
              gen.assign(j, (0, codegen_1._)`${indices}[${item}]`);
              cxt.error();
              gen.assign(valid, false).break();
            }).code((0, codegen_1._)`${indices}[${item}] = ${i}`);
          });
        }
        function loopN2(i, j) {
          const eql = (0, util_1.useFunc)(gen, equal_1.default);
          const outer = gen.name("outer");
          gen.label(outer).for((0, codegen_1._)`;${i}--;`, () => gen.for((0, codegen_1._)`${j} = ${i}; ${j}--;`, () => gen.if((0, codegen_1._)`${eql}(${data}[${i}], ${data}[${j}])`, () => {
            cxt.error();
            gen.assign(valid, false).break(outer);
          })));
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/const.js
var require_const = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/const.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error2 = {
      message: "must be equal to constant",
      params: ({ schemaCode }) => (0, codegen_1._)`{allowedValue: ${schemaCode}}`
    };
    var def = {
      keyword: "const",
      $data: true,
      error: error2,
      code(cxt) {
        const { gen, data, $data, schemaCode, schema } = cxt;
        if ($data || schema && typeof schema == "object") {
          cxt.fail$data((0, codegen_1._)`!${(0, util_1.useFunc)(gen, equal_1.default)}(${data}, ${schemaCode})`);
        } else {
          cxt.fail((0, codegen_1._)`${schema} !== ${data}`);
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/enum.js
var require_enum = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/enum.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var equal_1 = require_equal();
    var error2 = {
      message: "must be equal to one of the allowed values",
      params: ({ schemaCode }) => (0, codegen_1._)`{allowedValues: ${schemaCode}}`
    };
    var def = {
      keyword: "enum",
      schemaType: "array",
      $data: true,
      error: error2,
      code(cxt) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        if (!$data && schema.length === 0)
          throw new Error("enum must have non-empty array");
        const useLoop = schema.length >= it.opts.loopEnum;
        let eql;
        const getEql = () => eql !== null && eql !== void 0 ? eql : eql = (0, util_1.useFunc)(gen, equal_1.default);
        let valid;
        if (useLoop || $data) {
          valid = gen.let("valid");
          cxt.block$data(valid, loopEnum);
        } else {
          if (!Array.isArray(schema))
            throw new Error("ajv implementation error");
          const vSchema = gen.const("vSchema", schemaCode);
          valid = (0, codegen_1.or)(...schema.map((_x, i) => equalCode(vSchema, i)));
        }
        cxt.pass(valid);
        function loopEnum() {
          gen.assign(valid, false);
          gen.forOf("v", schemaCode, (v) => gen.if((0, codegen_1._)`${getEql()}(${data}, ${v})`, () => gen.assign(valid, true).break()));
        }
        function equalCode(vSchema, i) {
          const sch = schema[i];
          return typeof sch === "object" && sch !== null ? (0, codegen_1._)`${getEql()}(${data}, ${vSchema}[${i}])` : (0, codegen_1._)`${data} === ${sch}`;
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/validation/index.js
var require_validation = __commonJS({
  "node_modules/ajv/dist/vocabularies/validation/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var limitNumber_1 = require_limitNumber();
    var multipleOf_1 = require_multipleOf();
    var limitLength_1 = require_limitLength();
    var pattern_1 = require_pattern();
    var limitProperties_1 = require_limitProperties();
    var required_1 = require_required();
    var limitItems_1 = require_limitItems();
    var uniqueItems_1 = require_uniqueItems();
    var const_1 = require_const();
    var enum_1 = require_enum();
    var validation = [
      // number
      limitNumber_1.default,
      multipleOf_1.default,
      // string
      limitLength_1.default,
      pattern_1.default,
      // object
      limitProperties_1.default,
      required_1.default,
      // array
      limitItems_1.default,
      uniqueItems_1.default,
      // any
      { keyword: "type", schemaType: ["string", "array"] },
      { keyword: "nullable", schemaType: "boolean" },
      const_1.default,
      enum_1.default
    ];
    exports.default = validation;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/additionalItems.js
var require_additionalItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/additionalItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateAdditionalItems = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error2 = {
      message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
      params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
    };
    var def = {
      keyword: "additionalItems",
      type: "array",
      schemaType: ["boolean", "object"],
      before: "uniqueItems",
      error: error2,
      code(cxt) {
        const { parentSchema, it } = cxt;
        const { items } = parentSchema;
        if (!Array.isArray(items)) {
          (0, util_1.checkStrictMode)(it, '"additionalItems" is ignored when "items" is not an array of schemas');
          return;
        }
        validateAdditionalItems(cxt, items);
      }
    };
    function validateAdditionalItems(cxt, items) {
      const { gen, schema, data, keyword, it } = cxt;
      it.items = true;
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      if (schema === false) {
        cxt.setParams({ len: items.length });
        cxt.pass((0, codegen_1._)`${len} <= ${items.length}`);
      } else if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
        const valid = gen.var("valid", (0, codegen_1._)`${len} <= ${items.length}`);
        gen.if((0, codegen_1.not)(valid), () => validateItems(valid));
        cxt.ok(valid);
      }
      function validateItems(valid) {
        gen.forRange("i", items.length, len, (i) => {
          cxt.subschema({ keyword, dataProp: i, dataPropType: util_1.Type.Num }, valid);
          if (!it.allErrors)
            gen.if((0, codegen_1.not)(valid), () => gen.break());
        });
      }
    }
    exports.validateAdditionalItems = validateAdditionalItems;
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/items.js
var require_items = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/items.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateTuple = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    var def = {
      keyword: "items",
      type: "array",
      schemaType: ["object", "array", "boolean"],
      before: "uniqueItems",
      code(cxt) {
        const { schema, it } = cxt;
        if (Array.isArray(schema))
          return validateTuple(cxt, "additionalItems", schema);
        it.items = true;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        cxt.ok((0, code_1.validateArray)(cxt));
      }
    };
    function validateTuple(cxt, extraItems, schArr = cxt.schema) {
      const { gen, parentSchema, data, keyword, it } = cxt;
      checkStrictTuple(parentSchema);
      if (it.opts.unevaluated && schArr.length && it.items !== true) {
        it.items = util_1.mergeEvaluated.items(gen, schArr.length, it.items);
      }
      const valid = gen.name("valid");
      const len = gen.const("len", (0, codegen_1._)`${data}.length`);
      schArr.forEach((sch, i) => {
        if ((0, util_1.alwaysValidSchema)(it, sch))
          return;
        gen.if((0, codegen_1._)`${len} > ${i}`, () => cxt.subschema({
          keyword,
          schemaProp: i,
          dataProp: i
        }, valid));
        cxt.ok(valid);
      });
      function checkStrictTuple(sch) {
        const { opts, errSchemaPath } = it;
        const l = schArr.length;
        const fullTuple = l === sch.minItems && (l === sch.maxItems || sch[extraItems] === false);
        if (opts.strictTuples && !fullTuple) {
          const msg = `"${keyword}" is ${l}-tuple, but minItems or maxItems/${extraItems} are not specified or different at path "${errSchemaPath}"`;
          (0, util_1.checkStrictMode)(it, msg, opts.strictTuples);
        }
      }
    }
    exports.validateTuple = validateTuple;
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/prefixItems.js
var require_prefixItems = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/prefixItems.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var items_1 = require_items();
    var def = {
      keyword: "prefixItems",
      type: "array",
      schemaType: ["array"],
      before: "uniqueItems",
      code: (cxt) => (0, items_1.validateTuple)(cxt, "items")
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/items2020.js
var require_items2020 = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/items2020.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    var additionalItems_1 = require_additionalItems();
    var error2 = {
      message: ({ params: { len } }) => (0, codegen_1.str)`must NOT have more than ${len} items`,
      params: ({ params: { len } }) => (0, codegen_1._)`{limit: ${len}}`
    };
    var def = {
      keyword: "items",
      type: "array",
      schemaType: ["object", "boolean"],
      before: "uniqueItems",
      error: error2,
      code(cxt) {
        const { schema, parentSchema, it } = cxt;
        const { prefixItems } = parentSchema;
        it.items = true;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        if (prefixItems)
          (0, additionalItems_1.validateAdditionalItems)(cxt, prefixItems);
        else
          cxt.ok((0, code_1.validateArray)(cxt));
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/contains.js
var require_contains = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/contains.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error2 = {
      message: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1.str)`must contain at least ${min} valid item(s)` : (0, codegen_1.str)`must contain at least ${min} and no more than ${max} valid item(s)`,
      params: ({ params: { min, max } }) => max === void 0 ? (0, codegen_1._)`{minContains: ${min}}` : (0, codegen_1._)`{minContains: ${min}, maxContains: ${max}}`
    };
    var def = {
      keyword: "contains",
      type: "array",
      schemaType: ["object", "boolean"],
      before: "uniqueItems",
      trackErrors: true,
      error: error2,
      code(cxt) {
        const { gen, schema, parentSchema, data, it } = cxt;
        let min;
        let max;
        const { minContains, maxContains } = parentSchema;
        if (it.opts.next) {
          min = minContains === void 0 ? 1 : minContains;
          max = maxContains;
        } else {
          min = 1;
        }
        const len = gen.const("len", (0, codegen_1._)`${data}.length`);
        cxt.setParams({ min, max });
        if (max === void 0 && min === 0) {
          (0, util_1.checkStrictMode)(it, `"minContains" == 0 without "maxContains": "contains" keyword ignored`);
          return;
        }
        if (max !== void 0 && min > max) {
          (0, util_1.checkStrictMode)(it, `"minContains" > "maxContains" is always invalid`);
          cxt.fail();
          return;
        }
        if ((0, util_1.alwaysValidSchema)(it, schema)) {
          let cond = (0, codegen_1._)`${len} >= ${min}`;
          if (max !== void 0)
            cond = (0, codegen_1._)`${cond} && ${len} <= ${max}`;
          cxt.pass(cond);
          return;
        }
        it.items = true;
        const valid = gen.name("valid");
        if (max === void 0 && min === 1) {
          validateItems(valid, () => gen.if(valid, () => gen.break()));
        } else if (min === 0) {
          gen.let(valid, true);
          if (max !== void 0)
            gen.if((0, codegen_1._)`${data}.length > 0`, validateItemsWithCount);
        } else {
          gen.let(valid, false);
          validateItemsWithCount();
        }
        cxt.result(valid, () => cxt.reset());
        function validateItemsWithCount() {
          const schValid = gen.name("_valid");
          const count = gen.let("count", 0);
          validateItems(schValid, () => gen.if(schValid, () => checkLimits(count)));
        }
        function validateItems(_valid, block) {
          gen.forRange("i", 0, len, (i) => {
            cxt.subschema({
              keyword: "contains",
              dataProp: i,
              dataPropType: util_1.Type.Num,
              compositeRule: true
            }, _valid);
            block();
          });
        }
        function checkLimits(count) {
          gen.code((0, codegen_1._)`${count}++`);
          if (max === void 0) {
            gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true).break());
          } else {
            gen.if((0, codegen_1._)`${count} > ${max}`, () => gen.assign(valid, false).break());
            if (min === 1)
              gen.assign(valid, true);
            else
              gen.if((0, codegen_1._)`${count} >= ${min}`, () => gen.assign(valid, true));
          }
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/dependencies.js
var require_dependencies = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/dependencies.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.validateSchemaDeps = exports.validatePropertyDeps = exports.error = void 0;
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var code_1 = require_code2();
    exports.error = {
      message: ({ params: { property, depsCount, deps } }) => {
        const property_ies = depsCount === 1 ? "property" : "properties";
        return (0, codegen_1.str)`must have ${property_ies} ${deps} when property ${property} is present`;
      },
      params: ({ params: { property, depsCount, deps, missingProperty } }) => (0, codegen_1._)`{property: ${property},
    missingProperty: ${missingProperty},
    depsCount: ${depsCount},
    deps: ${deps}}`
      // TODO change to reference
    };
    var def = {
      keyword: "dependencies",
      type: "object",
      schemaType: "object",
      error: exports.error,
      code(cxt) {
        const [propDeps, schDeps] = splitDependencies(cxt);
        validatePropertyDeps(cxt, propDeps);
        validateSchemaDeps(cxt, schDeps);
      }
    };
    function splitDependencies({ schema }) {
      const propertyDeps = {};
      const schemaDeps = {};
      for (const key in schema) {
        if (key === "__proto__")
          continue;
        const deps = Array.isArray(schema[key]) ? propertyDeps : schemaDeps;
        deps[key] = schema[key];
      }
      return [propertyDeps, schemaDeps];
    }
    function validatePropertyDeps(cxt, propertyDeps = cxt.schema) {
      const { gen, data, it } = cxt;
      if (Object.keys(propertyDeps).length === 0)
        return;
      const missing = gen.let("missing");
      for (const prop in propertyDeps) {
        const deps = propertyDeps[prop];
        if (deps.length === 0)
          continue;
        const hasProperty = (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties);
        cxt.setParams({
          property: prop,
          depsCount: deps.length,
          deps: deps.join(", ")
        });
        if (it.allErrors) {
          gen.if(hasProperty, () => {
            for (const depProp of deps) {
              (0, code_1.checkReportMissingProp)(cxt, depProp);
            }
          });
        } else {
          gen.if((0, codegen_1._)`${hasProperty} && (${(0, code_1.checkMissingProp)(cxt, deps, missing)})`);
          (0, code_1.reportMissingProp)(cxt, missing);
          gen.else();
        }
      }
    }
    exports.validatePropertyDeps = validatePropertyDeps;
    function validateSchemaDeps(cxt, schemaDeps = cxt.schema) {
      const { gen, data, keyword, it } = cxt;
      const valid = gen.name("valid");
      for (const prop in schemaDeps) {
        if ((0, util_1.alwaysValidSchema)(it, schemaDeps[prop]))
          continue;
        gen.if(
          (0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties),
          () => {
            const schCxt = cxt.subschema({ keyword, schemaProp: prop }, valid);
            cxt.mergeValidEvaluated(schCxt, valid);
          },
          () => gen.var(valid, true)
          // TODO var
        );
        cxt.ok(valid);
      }
    }
    exports.validateSchemaDeps = validateSchemaDeps;
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/propertyNames.js
var require_propertyNames = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/propertyNames.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error2 = {
      message: "property name must be valid",
      params: ({ params }) => (0, codegen_1._)`{propertyName: ${params.propertyName}}`
    };
    var def = {
      keyword: "propertyNames",
      type: "object",
      schemaType: ["object", "boolean"],
      error: error2,
      code(cxt) {
        const { gen, schema, data, it } = cxt;
        if ((0, util_1.alwaysValidSchema)(it, schema))
          return;
        const valid = gen.name("valid");
        gen.forIn("key", data, (key) => {
          cxt.setParams({ propertyName: key });
          cxt.subschema({
            keyword: "propertyNames",
            data: key,
            dataTypes: ["string"],
            propertyName: key,
            compositeRule: true
          }, valid);
          gen.if((0, codegen_1.not)(valid), () => {
            cxt.error(true);
            if (!it.allErrors)
              gen.break();
          });
        });
        cxt.ok(valid);
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js
var require_additionalProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/additionalProperties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var names_1 = require_names();
    var util_1 = require_util();
    var error2 = {
      message: "must NOT have additional properties",
      params: ({ params }) => (0, codegen_1._)`{additionalProperty: ${params.additionalProperty}}`
    };
    var def = {
      keyword: "additionalProperties",
      type: ["object"],
      schemaType: ["boolean", "object"],
      allowUndefined: true,
      trackErrors: true,
      error: error2,
      code(cxt) {
        const { gen, schema, parentSchema, data, errsCount, it } = cxt;
        if (!errsCount)
          throw new Error("ajv implementation error");
        const { allErrors, opts } = it;
        it.props = true;
        if (opts.removeAdditional !== "all" && (0, util_1.alwaysValidSchema)(it, schema))
          return;
        const props = (0, code_1.allSchemaProperties)(parentSchema.properties);
        const patProps = (0, code_1.allSchemaProperties)(parentSchema.patternProperties);
        checkAdditionalProperties();
        cxt.ok((0, codegen_1._)`${errsCount} === ${names_1.default.errors}`);
        function checkAdditionalProperties() {
          gen.forIn("key", data, (key) => {
            if (!props.length && !patProps.length)
              additionalPropertyCode(key);
            else
              gen.if(isAdditional(key), () => additionalPropertyCode(key));
          });
        }
        function isAdditional(key) {
          let definedProp;
          if (props.length > 8) {
            const propsSchema = (0, util_1.schemaRefOrVal)(it, parentSchema.properties, "properties");
            definedProp = (0, code_1.isOwnProperty)(gen, propsSchema, key);
          } else if (props.length) {
            definedProp = (0, codegen_1.or)(...props.map((p) => (0, codegen_1._)`${key} === ${p}`));
          } else {
            definedProp = codegen_1.nil;
          }
          if (patProps.length) {
            definedProp = (0, codegen_1.or)(definedProp, ...patProps.map((p) => (0, codegen_1._)`${(0, code_1.usePattern)(cxt, p)}.test(${key})`));
          }
          return (0, codegen_1.not)(definedProp);
        }
        function deleteAdditional(key) {
          gen.code((0, codegen_1._)`delete ${data}[${key}]`);
        }
        function additionalPropertyCode(key) {
          if (opts.removeAdditional === "all" || opts.removeAdditional && schema === false) {
            deleteAdditional(key);
            return;
          }
          if (schema === false) {
            cxt.setParams({ additionalProperty: key });
            cxt.error();
            if (!allErrors)
              gen.break();
            return;
          }
          if (typeof schema == "object" && !(0, util_1.alwaysValidSchema)(it, schema)) {
            const valid = gen.name("valid");
            if (opts.removeAdditional === "failing") {
              applyAdditionalSchema(key, valid, false);
              gen.if((0, codegen_1.not)(valid), () => {
                cxt.reset();
                deleteAdditional(key);
              });
            } else {
              applyAdditionalSchema(key, valid);
              if (!allErrors)
                gen.if((0, codegen_1.not)(valid), () => gen.break());
            }
          }
        }
        function applyAdditionalSchema(key, valid, errors) {
          const subschema = {
            keyword: "additionalProperties",
            dataProp: key,
            dataPropType: util_1.Type.Str
          };
          if (errors === false) {
            Object.assign(subschema, {
              compositeRule: true,
              createErrors: false,
              allErrors: false
            });
          }
          cxt.subschema(subschema, valid);
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/properties.js
var require_properties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/properties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var validate_1 = require_validate();
    var code_1 = require_code2();
    var util_1 = require_util();
    var additionalProperties_1 = require_additionalProperties();
    var def = {
      keyword: "properties",
      type: "object",
      schemaType: "object",
      code(cxt) {
        const { gen, schema, parentSchema, data, it } = cxt;
        if (it.opts.removeAdditional === "all" && parentSchema.additionalProperties === void 0) {
          additionalProperties_1.default.code(new validate_1.KeywordCxt(it, additionalProperties_1.default, "additionalProperties"));
        }
        const allProps = (0, code_1.allSchemaProperties)(schema);
        for (const prop of allProps) {
          it.definedProperties.add(prop);
        }
        if (it.opts.unevaluated && allProps.length && it.props !== true) {
          it.props = util_1.mergeEvaluated.props(gen, (0, util_1.toHash)(allProps), it.props);
        }
        const properties = allProps.filter((p) => !(0, util_1.alwaysValidSchema)(it, schema[p]));
        if (properties.length === 0)
          return;
        const valid = gen.name("valid");
        for (const prop of properties) {
          if (hasDefault(prop)) {
            applyPropertySchema(prop);
          } else {
            gen.if((0, code_1.propertyInData)(gen, data, prop, it.opts.ownProperties));
            applyPropertySchema(prop);
            if (!it.allErrors)
              gen.else().var(valid, true);
            gen.endIf();
          }
          cxt.it.definedProperties.add(prop);
          cxt.ok(valid);
        }
        function hasDefault(prop) {
          return it.opts.useDefaults && !it.compositeRule && schema[prop].default !== void 0;
        }
        function applyPropertySchema(prop) {
          cxt.subschema({
            keyword: "properties",
            schemaProp: prop,
            dataProp: prop
          }, valid);
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/patternProperties.js
var require_patternProperties = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/patternProperties.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var util_2 = require_util();
    var def = {
      keyword: "patternProperties",
      type: "object",
      schemaType: "object",
      code(cxt) {
        const { gen, schema, data, parentSchema, it } = cxt;
        const { opts } = it;
        const patterns = (0, code_1.allSchemaProperties)(schema);
        const alwaysValidPatterns = patterns.filter((p) => (0, util_1.alwaysValidSchema)(it, schema[p]));
        if (patterns.length === 0 || alwaysValidPatterns.length === patterns.length && (!it.opts.unevaluated || it.props === true)) {
          return;
        }
        const checkProperties = opts.strictSchema && !opts.allowMatchingProperties && parentSchema.properties;
        const valid = gen.name("valid");
        if (it.props !== true && !(it.props instanceof codegen_1.Name)) {
          it.props = (0, util_2.evaluatedPropsToName)(gen, it.props);
        }
        const { props } = it;
        validatePatternProperties();
        function validatePatternProperties() {
          for (const pat of patterns) {
            if (checkProperties)
              checkMatchingProperties(pat);
            if (it.allErrors) {
              validateProperties(pat);
            } else {
              gen.var(valid, true);
              validateProperties(pat);
              gen.if(valid);
            }
          }
        }
        function checkMatchingProperties(pat) {
          for (const prop in checkProperties) {
            if (new RegExp(pat).test(prop)) {
              (0, util_1.checkStrictMode)(it, `property ${prop} matches pattern ${pat} (use allowMatchingProperties)`);
            }
          }
        }
        function validateProperties(pat) {
          gen.forIn("key", data, (key) => {
            gen.if((0, codegen_1._)`${(0, code_1.usePattern)(cxt, pat)}.test(${key})`, () => {
              const alwaysValid = alwaysValidPatterns.includes(pat);
              if (!alwaysValid) {
                cxt.subschema({
                  keyword: "patternProperties",
                  schemaProp: pat,
                  dataProp: key,
                  dataPropType: util_2.Type.Str
                }, valid);
              }
              if (it.opts.unevaluated && props !== true) {
                gen.assign((0, codegen_1._)`${props}[${key}]`, true);
              } else if (!alwaysValid && !it.allErrors) {
                gen.if((0, codegen_1.not)(valid), () => gen.break());
              }
            });
          });
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/not.js
var require_not = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/not.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: "not",
      schemaType: ["object", "boolean"],
      trackErrors: true,
      code(cxt) {
        const { gen, schema, it } = cxt;
        if ((0, util_1.alwaysValidSchema)(it, schema)) {
          cxt.fail();
          return;
        }
        const valid = gen.name("valid");
        cxt.subschema({
          keyword: "not",
          compositeRule: true,
          createErrors: false,
          allErrors: false
        }, valid);
        cxt.failResult(valid, () => cxt.reset(), () => cxt.error());
      },
      error: { message: "must NOT be valid" }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/anyOf.js
var require_anyOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/anyOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var code_1 = require_code2();
    var def = {
      keyword: "anyOf",
      schemaType: "array",
      trackErrors: true,
      code: code_1.validateUnion,
      error: { message: "must match a schema in anyOf" }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/oneOf.js
var require_oneOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/oneOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error2 = {
      message: "must match exactly one schema in oneOf",
      params: ({ params }) => (0, codegen_1._)`{passingSchemas: ${params.passing}}`
    };
    var def = {
      keyword: "oneOf",
      schemaType: "array",
      trackErrors: true,
      error: error2,
      code(cxt) {
        const { gen, schema, parentSchema, it } = cxt;
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        if (it.opts.discriminator && parentSchema.discriminator)
          return;
        const schArr = schema;
        const valid = gen.let("valid", false);
        const passing = gen.let("passing", null);
        const schValid = gen.name("_valid");
        cxt.setParams({ passing });
        gen.block(validateOneOf);
        cxt.result(valid, () => cxt.reset(), () => cxt.error(true));
        function validateOneOf() {
          schArr.forEach((sch, i) => {
            let schCxt;
            if ((0, util_1.alwaysValidSchema)(it, sch)) {
              gen.var(schValid, true);
            } else {
              schCxt = cxt.subschema({
                keyword: "oneOf",
                schemaProp: i,
                compositeRule: true
              }, schValid);
            }
            if (i > 0) {
              gen.if((0, codegen_1._)`${schValid} && ${valid}`).assign(valid, false).assign(passing, (0, codegen_1._)`[${passing}, ${i}]`).else();
            }
            gen.if(schValid, () => {
              gen.assign(valid, true);
              gen.assign(passing, i);
              if (schCxt)
                cxt.mergeEvaluated(schCxt, codegen_1.Name);
            });
          });
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/allOf.js
var require_allOf = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/allOf.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: "allOf",
      schemaType: "array",
      code(cxt) {
        const { gen, schema, it } = cxt;
        if (!Array.isArray(schema))
          throw new Error("ajv implementation error");
        const valid = gen.name("valid");
        schema.forEach((sch, i) => {
          if ((0, util_1.alwaysValidSchema)(it, sch))
            return;
          const schCxt = cxt.subschema({ keyword: "allOf", schemaProp: i }, valid);
          cxt.ok(valid);
          cxt.mergeEvaluated(schCxt);
        });
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/if.js
var require_if = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/if.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var util_1 = require_util();
    var error2 = {
      message: ({ params }) => (0, codegen_1.str)`must match "${params.ifClause}" schema`,
      params: ({ params }) => (0, codegen_1._)`{failingKeyword: ${params.ifClause}}`
    };
    var def = {
      keyword: "if",
      schemaType: ["object", "boolean"],
      trackErrors: true,
      error: error2,
      code(cxt) {
        const { gen, parentSchema, it } = cxt;
        if (parentSchema.then === void 0 && parentSchema.else === void 0) {
          (0, util_1.checkStrictMode)(it, '"if" without "then" and "else" is ignored');
        }
        const hasThen = hasSchema(it, "then");
        const hasElse = hasSchema(it, "else");
        if (!hasThen && !hasElse)
          return;
        const valid = gen.let("valid", true);
        const schValid = gen.name("_valid");
        validateIf();
        cxt.reset();
        if (hasThen && hasElse) {
          const ifClause = gen.let("ifClause");
          cxt.setParams({ ifClause });
          gen.if(schValid, validateClause("then", ifClause), validateClause("else", ifClause));
        } else if (hasThen) {
          gen.if(schValid, validateClause("then"));
        } else {
          gen.if((0, codegen_1.not)(schValid), validateClause("else"));
        }
        cxt.pass(valid, () => cxt.error(true));
        function validateIf() {
          const schCxt = cxt.subschema({
            keyword: "if",
            compositeRule: true,
            createErrors: false,
            allErrors: false
          }, schValid);
          cxt.mergeEvaluated(schCxt);
        }
        function validateClause(keyword, ifClause) {
          return () => {
            const schCxt = cxt.subschema({ keyword }, schValid);
            gen.assign(valid, schValid);
            cxt.mergeValidEvaluated(schCxt, valid);
            if (ifClause)
              gen.assign(ifClause, (0, codegen_1._)`${keyword}`);
            else
              cxt.setParams({ ifClause: keyword });
          };
        }
      }
    };
    function hasSchema(it, keyword) {
      const schema = it.schema[keyword];
      return schema !== void 0 && !(0, util_1.alwaysValidSchema)(it, schema);
    }
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/thenElse.js
var require_thenElse = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/thenElse.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var util_1 = require_util();
    var def = {
      keyword: ["then", "else"],
      schemaType: ["object", "boolean"],
      code({ keyword, parentSchema, it }) {
        if (parentSchema.if === void 0)
          (0, util_1.checkStrictMode)(it, `"${keyword}" without "if" is ignored`);
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/applicator/index.js
var require_applicator = __commonJS({
  "node_modules/ajv/dist/vocabularies/applicator/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var additionalItems_1 = require_additionalItems();
    var prefixItems_1 = require_prefixItems();
    var items_1 = require_items();
    var items2020_1 = require_items2020();
    var contains_1 = require_contains();
    var dependencies_1 = require_dependencies();
    var propertyNames_1 = require_propertyNames();
    var additionalProperties_1 = require_additionalProperties();
    var properties_1 = require_properties();
    var patternProperties_1 = require_patternProperties();
    var not_1 = require_not();
    var anyOf_1 = require_anyOf();
    var oneOf_1 = require_oneOf();
    var allOf_1 = require_allOf();
    var if_1 = require_if();
    var thenElse_1 = require_thenElse();
    function getApplicator(draft2020 = false) {
      const applicator = [
        // any
        not_1.default,
        anyOf_1.default,
        oneOf_1.default,
        allOf_1.default,
        if_1.default,
        thenElse_1.default,
        // object
        propertyNames_1.default,
        additionalProperties_1.default,
        dependencies_1.default,
        properties_1.default,
        patternProperties_1.default
      ];
      if (draft2020)
        applicator.push(prefixItems_1.default, items2020_1.default);
      else
        applicator.push(additionalItems_1.default, items_1.default);
      applicator.push(contains_1.default);
      return applicator;
    }
    exports.default = getApplicator;
  }
});

// node_modules/ajv/dist/vocabularies/format/format.js
var require_format = __commonJS({
  "node_modules/ajv/dist/vocabularies/format/format.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var error2 = {
      message: ({ schemaCode }) => (0, codegen_1.str)`must match format "${schemaCode}"`,
      params: ({ schemaCode }) => (0, codegen_1._)`{format: ${schemaCode}}`
    };
    var def = {
      keyword: "format",
      type: ["number", "string"],
      schemaType: "string",
      $data: true,
      error: error2,
      code(cxt, ruleType) {
        const { gen, data, $data, schema, schemaCode, it } = cxt;
        const { opts, errSchemaPath, schemaEnv, self } = it;
        if (!opts.validateFormats)
          return;
        if ($data)
          validate$DataFormat();
        else
          validateFormat();
        function validate$DataFormat() {
          const fmts = gen.scopeValue("formats", {
            ref: self.formats,
            code: opts.code.formats
          });
          const fDef = gen.const("fDef", (0, codegen_1._)`${fmts}[${schemaCode}]`);
          const fType = gen.let("fType");
          const format = gen.let("format");
          gen.if((0, codegen_1._)`typeof ${fDef} == "object" && !(${fDef} instanceof RegExp)`, () => gen.assign(fType, (0, codegen_1._)`${fDef}.type || "string"`).assign(format, (0, codegen_1._)`${fDef}.validate`), () => gen.assign(fType, (0, codegen_1._)`"string"`).assign(format, fDef));
          cxt.fail$data((0, codegen_1.or)(unknownFmt(), invalidFmt()));
          function unknownFmt() {
            if (opts.strictSchema === false)
              return codegen_1.nil;
            return (0, codegen_1._)`${schemaCode} && !${format}`;
          }
          function invalidFmt() {
            const callFormat = schemaEnv.$async ? (0, codegen_1._)`(${fDef}.async ? await ${format}(${data}) : ${format}(${data}))` : (0, codegen_1._)`${format}(${data})`;
            const validData = (0, codegen_1._)`(typeof ${format} == "function" ? ${callFormat} : ${format}.test(${data}))`;
            return (0, codegen_1._)`${format} && ${format} !== true && ${fType} === ${ruleType} && !${validData}`;
          }
        }
        function validateFormat() {
          const formatDef = self.formats[schema];
          if (!formatDef) {
            unknownFormat();
            return;
          }
          if (formatDef === true)
            return;
          const [fmtType, format, fmtRef] = getFormat(formatDef);
          if (fmtType === ruleType)
            cxt.pass(validCondition());
          function unknownFormat() {
            if (opts.strictSchema === false) {
              self.logger.warn(unknownMsg());
              return;
            }
            throw new Error(unknownMsg());
            function unknownMsg() {
              return `unknown format "${schema}" ignored in schema at path "${errSchemaPath}"`;
            }
          }
          function getFormat(fmtDef) {
            const code = fmtDef instanceof RegExp ? (0, codegen_1.regexpCode)(fmtDef) : opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(schema)}` : void 0;
            const fmt = gen.scopeValue("formats", { key: schema, ref: fmtDef, code });
            if (typeof fmtDef == "object" && !(fmtDef instanceof RegExp)) {
              return [fmtDef.type || "string", fmtDef.validate, (0, codegen_1._)`${fmt}.validate`];
            }
            return ["string", fmtDef, fmt];
          }
          function validCondition() {
            if (typeof formatDef == "object" && !(formatDef instanceof RegExp) && formatDef.async) {
              if (!schemaEnv.$async)
                throw new Error("async format in sync schema");
              return (0, codegen_1._)`await ${fmtRef}(${data})`;
            }
            return typeof format == "function" ? (0, codegen_1._)`${fmtRef}(${data})` : (0, codegen_1._)`${fmtRef}.test(${data})`;
          }
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/vocabularies/format/index.js
var require_format2 = __commonJS({
  "node_modules/ajv/dist/vocabularies/format/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var format_1 = require_format();
    var format = [format_1.default];
    exports.default = format;
  }
});

// node_modules/ajv/dist/vocabularies/metadata.js
var require_metadata = __commonJS({
  "node_modules/ajv/dist/vocabularies/metadata.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.contentVocabulary = exports.metadataVocabulary = void 0;
    exports.metadataVocabulary = [
      "title",
      "description",
      "default",
      "deprecated",
      "readOnly",
      "writeOnly",
      "examples"
    ];
    exports.contentVocabulary = [
      "contentMediaType",
      "contentEncoding",
      "contentSchema"
    ];
  }
});

// node_modules/ajv/dist/vocabularies/draft7.js
var require_draft7 = __commonJS({
  "node_modules/ajv/dist/vocabularies/draft7.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var core_1 = require_core2();
    var validation_1 = require_validation();
    var applicator_1 = require_applicator();
    var format_1 = require_format2();
    var metadata_1 = require_metadata();
    var draft7Vocabularies = [
      core_1.default,
      validation_1.default,
      (0, applicator_1.default)(),
      format_1.default,
      metadata_1.metadataVocabulary,
      metadata_1.contentVocabulary
    ];
    exports.default = draft7Vocabularies;
  }
});

// node_modules/ajv/dist/vocabularies/discriminator/types.js
var require_types = __commonJS({
  "node_modules/ajv/dist/vocabularies/discriminator/types.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DiscrError = void 0;
    var DiscrError;
    (function(DiscrError2) {
      DiscrError2["Tag"] = "tag";
      DiscrError2["Mapping"] = "mapping";
    })(DiscrError || (exports.DiscrError = DiscrError = {}));
  }
});

// node_modules/ajv/dist/vocabularies/discriminator/index.js
var require_discriminator = __commonJS({
  "node_modules/ajv/dist/vocabularies/discriminator/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var codegen_1 = require_codegen();
    var types_1 = require_types();
    var compile_1 = require_compile();
    var ref_error_1 = require_ref_error();
    var util_1 = require_util();
    var error2 = {
      message: ({ params: { discrError, tagName } }) => discrError === types_1.DiscrError.Tag ? `tag "${tagName}" must be string` : `value of tag "${tagName}" must be in oneOf`,
      params: ({ params: { discrError, tag, tagName } }) => (0, codegen_1._)`{error: ${discrError}, tag: ${tagName}, tagValue: ${tag}}`
    };
    var def = {
      keyword: "discriminator",
      type: "object",
      schemaType: "object",
      error: error2,
      code(cxt) {
        const { gen, data, schema, parentSchema, it } = cxt;
        const { oneOf } = parentSchema;
        if (!it.opts.discriminator) {
          throw new Error("discriminator: requires discriminator option");
        }
        const tagName = schema.propertyName;
        if (typeof tagName != "string")
          throw new Error("discriminator: requires propertyName");
        if (schema.mapping)
          throw new Error("discriminator: mapping is not supported");
        if (!oneOf)
          throw new Error("discriminator: requires oneOf keyword");
        const valid = gen.let("valid", false);
        const tag = gen.const("tag", (0, codegen_1._)`${data}${(0, codegen_1.getProperty)(tagName)}`);
        gen.if((0, codegen_1._)`typeof ${tag} == "string"`, () => validateMapping(), () => cxt.error(false, { discrError: types_1.DiscrError.Tag, tag, tagName }));
        cxt.ok(valid);
        function validateMapping() {
          const mapping = getMapping();
          gen.if(false);
          for (const tagValue in mapping) {
            gen.elseIf((0, codegen_1._)`${tag} === ${tagValue}`);
            gen.assign(valid, applyTagSchema(mapping[tagValue]));
          }
          gen.else();
          cxt.error(false, { discrError: types_1.DiscrError.Mapping, tag, tagName });
          gen.endIf();
        }
        function applyTagSchema(schemaProp) {
          const _valid = gen.name("valid");
          const schCxt = cxt.subschema({ keyword: "oneOf", schemaProp }, _valid);
          cxt.mergeEvaluated(schCxt, codegen_1.Name);
          return _valid;
        }
        function getMapping() {
          var _a;
          const oneOfMapping = {};
          const topRequired = hasRequired(parentSchema);
          let tagRequired = true;
          for (let i = 0; i < oneOf.length; i++) {
            let sch = oneOf[i];
            if ((sch === null || sch === void 0 ? void 0 : sch.$ref) && !(0, util_1.schemaHasRulesButRef)(sch, it.self.RULES)) {
              const ref = sch.$ref;
              sch = compile_1.resolveRef.call(it.self, it.schemaEnv.root, it.baseId, ref);
              if (sch instanceof compile_1.SchemaEnv)
                sch = sch.schema;
              if (sch === void 0)
                throw new ref_error_1.default(it.opts.uriResolver, it.baseId, ref);
            }
            const propSch = (_a = sch === null || sch === void 0 ? void 0 : sch.properties) === null || _a === void 0 ? void 0 : _a[tagName];
            if (typeof propSch != "object") {
              throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
            }
            tagRequired = tagRequired && (topRequired || hasRequired(sch));
            addMappings(propSch, i);
          }
          if (!tagRequired)
            throw new Error(`discriminator: "${tagName}" must be required`);
          return oneOfMapping;
          function hasRequired({ required: required2 }) {
            return Array.isArray(required2) && required2.includes(tagName);
          }
          function addMappings(sch, i) {
            if (sch.const) {
              addMapping(sch.const, i);
            } else if (sch.enum) {
              for (const tagValue of sch.enum) {
                addMapping(tagValue, i);
              }
            } else {
              throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
            }
          }
          function addMapping(tagValue, i) {
            if (typeof tagValue != "string" || tagValue in oneOfMapping) {
              throw new Error(`discriminator: "${tagName}" values must be unique strings`);
            }
            oneOfMapping[tagValue] = i;
          }
        }
      }
    };
    exports.default = def;
  }
});

// node_modules/ajv/dist/refs/json-schema-draft-07.json
var require_json_schema_draft_07 = __commonJS({
  "node_modules/ajv/dist/refs/json-schema-draft-07.json"(exports, module) {
    module.exports = {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: "http://json-schema.org/draft-07/schema#",
      title: "Core schema meta-schema",
      definitions: {
        schemaArray: {
          type: "array",
          minItems: 1,
          items: { $ref: "#" }
        },
        nonNegativeInteger: {
          type: "integer",
          minimum: 0
        },
        nonNegativeIntegerDefault0: {
          allOf: [{ $ref: "#/definitions/nonNegativeInteger" }, { default: 0 }]
        },
        simpleTypes: {
          enum: ["array", "boolean", "integer", "null", "number", "object", "string"]
        },
        stringArray: {
          type: "array",
          items: { type: "string" },
          uniqueItems: true,
          default: []
        }
      },
      type: ["object", "boolean"],
      properties: {
        $id: {
          type: "string",
          format: "uri-reference"
        },
        $schema: {
          type: "string",
          format: "uri"
        },
        $ref: {
          type: "string",
          format: "uri-reference"
        },
        $comment: {
          type: "string"
        },
        title: {
          type: "string"
        },
        description: {
          type: "string"
        },
        default: true,
        readOnly: {
          type: "boolean",
          default: false
        },
        examples: {
          type: "array",
          items: true
        },
        multipleOf: {
          type: "number",
          exclusiveMinimum: 0
        },
        maximum: {
          type: "number"
        },
        exclusiveMaximum: {
          type: "number"
        },
        minimum: {
          type: "number"
        },
        exclusiveMinimum: {
          type: "number"
        },
        maxLength: { $ref: "#/definitions/nonNegativeInteger" },
        minLength: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        pattern: {
          type: "string",
          format: "regex"
        },
        additionalItems: { $ref: "#" },
        items: {
          anyOf: [{ $ref: "#" }, { $ref: "#/definitions/schemaArray" }],
          default: true
        },
        maxItems: { $ref: "#/definitions/nonNegativeInteger" },
        minItems: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        uniqueItems: {
          type: "boolean",
          default: false
        },
        contains: { $ref: "#" },
        maxProperties: { $ref: "#/definitions/nonNegativeInteger" },
        minProperties: { $ref: "#/definitions/nonNegativeIntegerDefault0" },
        required: { $ref: "#/definitions/stringArray" },
        additionalProperties: { $ref: "#" },
        definitions: {
          type: "object",
          additionalProperties: { $ref: "#" },
          default: {}
        },
        properties: {
          type: "object",
          additionalProperties: { $ref: "#" },
          default: {}
        },
        patternProperties: {
          type: "object",
          additionalProperties: { $ref: "#" },
          propertyNames: { format: "regex" },
          default: {}
        },
        dependencies: {
          type: "object",
          additionalProperties: {
            anyOf: [{ $ref: "#" }, { $ref: "#/definitions/stringArray" }]
          }
        },
        propertyNames: { $ref: "#" },
        const: true,
        enum: {
          type: "array",
          items: true,
          minItems: 1,
          uniqueItems: true
        },
        type: {
          anyOf: [
            { $ref: "#/definitions/simpleTypes" },
            {
              type: "array",
              items: { $ref: "#/definitions/simpleTypes" },
              minItems: 1,
              uniqueItems: true
            }
          ]
        },
        format: { type: "string" },
        contentMediaType: { type: "string" },
        contentEncoding: { type: "string" },
        if: { $ref: "#" },
        then: { $ref: "#" },
        else: { $ref: "#" },
        allOf: { $ref: "#/definitions/schemaArray" },
        anyOf: { $ref: "#/definitions/schemaArray" },
        oneOf: { $ref: "#/definitions/schemaArray" },
        not: { $ref: "#" }
      },
      default: true
    };
  }
});

// node_modules/ajv/dist/ajv.js
var require_ajv = __commonJS({
  "node_modules/ajv/dist/ajv.js"(exports, module) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MissingRefError = exports.ValidationError = exports.CodeGen = exports.Name = exports.nil = exports.stringify = exports.str = exports._ = exports.KeywordCxt = exports.Ajv = void 0;
    var core_1 = require_core();
    var draft7_1 = require_draft7();
    var discriminator_1 = require_discriminator();
    var draft7MetaSchema = require_json_schema_draft_07();
    var META_SUPPORT_DATA = ["/properties"];
    var META_SCHEMA_ID = "http://json-schema.org/draft-07/schema";
    var Ajv2 = class extends core_1.default {
      _addVocabularies() {
        super._addVocabularies();
        draft7_1.default.forEach((v) => this.addVocabulary(v));
        if (this.opts.discriminator)
          this.addKeyword(discriminator_1.default);
      }
      _addDefaultMetaSchema() {
        super._addDefaultMetaSchema();
        if (!this.opts.meta)
          return;
        const metaSchema = this.opts.$data ? this.$dataMetaSchema(draft7MetaSchema, META_SUPPORT_DATA) : draft7MetaSchema;
        this.addMetaSchema(metaSchema, META_SCHEMA_ID, false);
        this.refs["http://json-schema.org/schema"] = META_SCHEMA_ID;
      }
      defaultMeta() {
        return this.opts.defaultMeta = super.defaultMeta() || (this.getSchema(META_SCHEMA_ID) ? META_SCHEMA_ID : void 0);
      }
    };
    exports.Ajv = Ajv2;
    module.exports = exports = Ajv2;
    module.exports.Ajv = Ajv2;
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = Ajv2;
    var validate_1 = require_validate();
    Object.defineProperty(exports, "KeywordCxt", { enumerable: true, get: function() {
      return validate_1.KeywordCxt;
    } });
    var codegen_1 = require_codegen();
    Object.defineProperty(exports, "_", { enumerable: true, get: function() {
      return codegen_1._;
    } });
    Object.defineProperty(exports, "str", { enumerable: true, get: function() {
      return codegen_1.str;
    } });
    Object.defineProperty(exports, "stringify", { enumerable: true, get: function() {
      return codegen_1.stringify;
    } });
    Object.defineProperty(exports, "nil", { enumerable: true, get: function() {
      return codegen_1.nil;
    } });
    Object.defineProperty(exports, "Name", { enumerable: true, get: function() {
      return codegen_1.Name;
    } });
    Object.defineProperty(exports, "CodeGen", { enumerable: true, get: function() {
      return codegen_1.CodeGen;
    } });
    var validation_error_1 = require_validation_error();
    Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function() {
      return validation_error_1.default;
    } });
    var ref_error_1 = require_ref_error();
    Object.defineProperty(exports, "MissingRefError", { enumerable: true, get: function() {
      return ref_error_1.default;
    } });
  }
});

// node_modules/ajv-formats/dist/formats.js
var require_formats = __commonJS({
  "node_modules/ajv-formats/dist/formats.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.formatNames = exports.fastFormats = exports.fullFormats = void 0;
    function fmtDef(validate, compare) {
      return { validate, compare };
    }
    exports.fullFormats = {
      // date: http://tools.ietf.org/html/rfc3339#section-5.6
      date: fmtDef(date3, compareDate),
      // date-time: http://tools.ietf.org/html/rfc3339#section-5.6
      time: fmtDef(getTime(true), compareTime),
      "date-time": fmtDef(getDateTime(true), compareDateTime),
      "iso-time": fmtDef(getTime(), compareIsoTime),
      "iso-date-time": fmtDef(getDateTime(), compareIsoDateTime),
      // duration: https://tools.ietf.org/html/rfc3339#appendix-A
      duration: /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/,
      uri,
      "uri-reference": /^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i,
      // uri-template: https://tools.ietf.org/html/rfc6570
      "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
      // For the source: https://gist.github.com/dperini/729294
      // For test cases: https://mathiasbynens.be/demo/url-regex
      url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
      email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
      hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
      // optimized https://www.safaribooksonline.com/library/view/regular-expressions-cookbook/9780596802837/ch07s16.html
      ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
      ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
      regex,
      // uuid: http://tools.ietf.org/html/rfc4122
      uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
      // JSON-pointer: https://tools.ietf.org/html/rfc6901
      // uri fragment: https://tools.ietf.org/html/rfc3986#appendix-A
      "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
      "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
      // relative JSON-pointer: http://tools.ietf.org/html/draft-luff-relative-json-pointer-00
      "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
      // the following formats are used by the openapi specification: https://spec.openapis.org/oas/v3.0.0#data-types
      // byte: https://github.com/miguelmota/is-base64
      byte,
      // signed 32 bit integer
      int32: { type: "number", validate: validateInt32 },
      // signed 64 bit integer
      int64: { type: "number", validate: validateInt64 },
      // C-type float
      float: { type: "number", validate: validateNumber },
      // C-type double
      double: { type: "number", validate: validateNumber },
      // hint to the UI to hide input strings
      password: true,
      // unchecked string payload
      binary: true
    };
    exports.fastFormats = {
      ...exports.fullFormats,
      date: fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d$/, compareDate),
      time: fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareTime),
      "date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\dt(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)$/i, compareDateTime),
      "iso-time": fmtDef(/^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoTime),
      "iso-date-time": fmtDef(/^\d\d\d\d-[0-1]\d-[0-3]\d[t\s](?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:z|[+-]\d\d(?::?\d\d)?)?$/i, compareIsoDateTime),
      // uri: https://github.com/mafintosh/is-my-json-valid/blob/master/formats.js
      uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
      "uri-reference": /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
      // email (sources from jsen validator):
      // http://stackoverflow.com/questions/201323/using-a-regular-expression-to-validate-an-email-address#answer-8829363
      // http://www.w3.org/TR/html5/forms.html#valid-e-mail-address (search for 'wilful violation')
      email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i
    };
    exports.formatNames = Object.keys(exports.fullFormats);
    function isLeapYear(year) {
      return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    }
    var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
    var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    function date3(str) {
      const matches = DATE.exec(str);
      if (!matches)
        return false;
      const year = +matches[1];
      const month = +matches[2];
      const day = +matches[3];
      return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month]);
    }
    function compareDate(d1, d2) {
      if (!(d1 && d2))
        return void 0;
      if (d1 > d2)
        return 1;
      if (d1 < d2)
        return -1;
      return 0;
    }
    var TIME = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i;
    function getTime(strictTimeZone) {
      return function time3(str) {
        const matches = TIME.exec(str);
        if (!matches)
          return false;
        const hr = +matches[1];
        const min = +matches[2];
        const sec = +matches[3];
        const tz = matches[4];
        const tzSign = matches[5] === "-" ? -1 : 1;
        const tzH = +(matches[6] || 0);
        const tzM = +(matches[7] || 0);
        if (tzH > 23 || tzM > 59 || strictTimeZone && !tz)
          return false;
        if (hr <= 23 && min <= 59 && sec < 60)
          return true;
        const utcMin = min - tzM * tzSign;
        const utcHr = hr - tzH * tzSign - (utcMin < 0 ? 1 : 0);
        return (utcHr === 23 || utcHr === -1) && (utcMin === 59 || utcMin === -1) && sec < 61;
      };
    }
    function compareTime(s1, s2) {
      if (!(s1 && s2))
        return void 0;
      const t1 = (/* @__PURE__ */ new Date("2020-01-01T" + s1)).valueOf();
      const t2 = (/* @__PURE__ */ new Date("2020-01-01T" + s2)).valueOf();
      if (!(t1 && t2))
        return void 0;
      return t1 - t2;
    }
    function compareIsoTime(t1, t2) {
      if (!(t1 && t2))
        return void 0;
      const a1 = TIME.exec(t1);
      const a2 = TIME.exec(t2);
      if (!(a1 && a2))
        return void 0;
      t1 = a1[1] + a1[2] + a1[3];
      t2 = a2[1] + a2[2] + a2[3];
      if (t1 > t2)
        return 1;
      if (t1 < t2)
        return -1;
      return 0;
    }
    var DATE_TIME_SEPARATOR = /t|\s/i;
    function getDateTime(strictTimeZone) {
      const time3 = getTime(strictTimeZone);
      return function date_time(str) {
        const dateTime = str.split(DATE_TIME_SEPARATOR);
        return dateTime.length === 2 && date3(dateTime[0]) && time3(dateTime[1]);
      };
    }
    function compareDateTime(dt1, dt2) {
      if (!(dt1 && dt2))
        return void 0;
      const d1 = new Date(dt1).valueOf();
      const d2 = new Date(dt2).valueOf();
      if (!(d1 && d2))
        return void 0;
      return d1 - d2;
    }
    function compareIsoDateTime(dt1, dt2) {
      if (!(dt1 && dt2))
        return void 0;
      const [d1, t1] = dt1.split(DATE_TIME_SEPARATOR);
      const [d2, t2] = dt2.split(DATE_TIME_SEPARATOR);
      const res = compareDate(d1, d2);
      if (res === void 0)
        return void 0;
      return res || compareTime(t1, t2);
    }
    var NOT_URI_FRAGMENT = /\/|:/;
    var URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)(?:\?(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
    function uri(str) {
      return NOT_URI_FRAGMENT.test(str) && URI.test(str);
    }
    var BYTE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/gm;
    function byte(str) {
      BYTE.lastIndex = 0;
      return BYTE.test(str);
    }
    var MIN_INT32 = -(2 ** 31);
    var MAX_INT32 = 2 ** 31 - 1;
    function validateInt32(value) {
      return Number.isInteger(value) && value <= MAX_INT32 && value >= MIN_INT32;
    }
    function validateInt64(value) {
      return Number.isInteger(value);
    }
    function validateNumber() {
      return true;
    }
    var Z_ANCHOR = /[^\\]\\Z/;
    function regex(str) {
      if (Z_ANCHOR.test(str))
        return false;
      try {
        new RegExp(str);
        return true;
      } catch (e) {
        return false;
      }
    }
  }
});

// node_modules/ajv-formats/dist/limit.js
var require_limit = __commonJS({
  "node_modules/ajv-formats/dist/limit.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.formatLimitDefinition = void 0;
    var ajv_1 = require_ajv();
    var codegen_1 = require_codegen();
    var ops = codegen_1.operators;
    var KWDs = {
      formatMaximum: { okStr: "<=", ok: ops.LTE, fail: ops.GT },
      formatMinimum: { okStr: ">=", ok: ops.GTE, fail: ops.LT },
      formatExclusiveMaximum: { okStr: "<", ok: ops.LT, fail: ops.GTE },
      formatExclusiveMinimum: { okStr: ">", ok: ops.GT, fail: ops.LTE }
    };
    var error2 = {
      message: ({ keyword, schemaCode }) => (0, codegen_1.str)`should be ${KWDs[keyword].okStr} ${schemaCode}`,
      params: ({ keyword, schemaCode }) => (0, codegen_1._)`{comparison: ${KWDs[keyword].okStr}, limit: ${schemaCode}}`
    };
    exports.formatLimitDefinition = {
      keyword: Object.keys(KWDs),
      type: "string",
      schemaType: "string",
      $data: true,
      error: error2,
      code(cxt) {
        const { gen, data, schemaCode, keyword, it } = cxt;
        const { opts, self } = it;
        if (!opts.validateFormats)
          return;
        const fCxt = new ajv_1.KeywordCxt(it, self.RULES.all.format.definition, "format");
        if (fCxt.$data)
          validate$DataFormat();
        else
          validateFormat();
        function validate$DataFormat() {
          const fmts = gen.scopeValue("formats", {
            ref: self.formats,
            code: opts.code.formats
          });
          const fmt = gen.const("fmt", (0, codegen_1._)`${fmts}[${fCxt.schemaCode}]`);
          cxt.fail$data((0, codegen_1.or)((0, codegen_1._)`typeof ${fmt} != "object"`, (0, codegen_1._)`${fmt} instanceof RegExp`, (0, codegen_1._)`typeof ${fmt}.compare != "function"`, compareCode(fmt)));
        }
        function validateFormat() {
          const format = fCxt.schema;
          const fmtDef = self.formats[format];
          if (!fmtDef || fmtDef === true)
            return;
          if (typeof fmtDef != "object" || fmtDef instanceof RegExp || typeof fmtDef.compare != "function") {
            throw new Error(`"${keyword}": format "${format}" does not define "compare" function`);
          }
          const fmt = gen.scopeValue("formats", {
            key: format,
            ref: fmtDef,
            code: opts.code.formats ? (0, codegen_1._)`${opts.code.formats}${(0, codegen_1.getProperty)(format)}` : void 0
          });
          cxt.fail$data(compareCode(fmt));
        }
        function compareCode(fmt) {
          return (0, codegen_1._)`${fmt}.compare(${data}, ${schemaCode}) ${KWDs[keyword].fail} 0`;
        }
      },
      dependencies: ["format"]
    };
    var formatLimitPlugin = (ajv) => {
      ajv.addKeyword(exports.formatLimitDefinition);
      return ajv;
    };
    exports.default = formatLimitPlugin;
  }
});

// node_modules/ajv-formats/dist/index.js
var require_dist = __commonJS({
  "node_modules/ajv-formats/dist/index.js"(exports, module) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    var formats_1 = require_formats();
    var limit_1 = require_limit();
    var codegen_1 = require_codegen();
    var fullName = new codegen_1.Name("fullFormats");
    var fastName = new codegen_1.Name("fastFormats");
    var formatsPlugin = (ajv, opts = { keywords: true }) => {
      if (Array.isArray(opts)) {
        addFormats(ajv, opts, formats_1.fullFormats, fullName);
        return ajv;
      }
      const [formats, exportName] = opts.mode === "fast" ? [formats_1.fastFormats, fastName] : [formats_1.fullFormats, fullName];
      const list = opts.formats || formats_1.formatNames;
      addFormats(ajv, list, formats, exportName);
      if (opts.keywords)
        (0, limit_1.default)(ajv);
      return ajv;
    };
    formatsPlugin.get = (name, mode = "full") => {
      const formats = mode === "fast" ? formats_1.fastFormats : formats_1.fullFormats;
      const f = formats[name];
      if (!f)
        throw new Error(`Unknown format "${name}"`);
      return f;
    };
    function addFormats(ajv, list, fs22, exportName) {
      var _a;
      var _b;
      (_a = (_b = ajv.opts.code).formats) !== null && _a !== void 0 ? _a : _b.formats = (0, codegen_1._)`require("ajv-formats/dist/formats").${exportName}`;
      for (const f of list)
        ajv.addFormat(f, fs22[f]);
    }
    module.exports = exports = formatsPlugin;
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = formatsPlugin;
  }
});

// src/daemon.ts
import fs21 from "node:fs";
import path20 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";

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
  function assertIs2(_arg) {
  }
  util2.assertIs = assertIs2;
  function assertNever2(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever2;
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
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object3) => {
    const keys = [];
    for (const key in object3) {
      if (Object.prototype.hasOwnProperty.call(object3, key)) {
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
  function joinValues2(array2, separator = " | ") {
    return array2.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues2;
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
  const t = typeof data;
  switch (t) {
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
    const mapper = _mapper || function(issue2) {
      return issue2.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error2) => {
      for (const issue2 of error2.issues) {
        if (issue2.code === "invalid_union") {
          issue2.unionErrors.map(processError);
        } else if (issue2.code === "invalid_return_type") {
          processError(issue2.returnTypeError);
        } else if (issue2.code === "invalid_arguments") {
          processError(issue2.argumentsError);
        } else if (issue2.path.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue2.path.length) {
            const el = issue2.path[i];
            const terminal = i === issue2.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue2));
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
  flatten(mapper = (issue2) => issue2.message) {
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
  const error2 = new ZodError(issues);
  return error2;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue2, _ctx) => {
  let message;
  switch (issue2.code) {
    case ZodIssueCode.invalid_type:
      if (issue2.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue2.expected}, received ${issue2.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue2.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue2.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue2.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue2.options)}, received '${issue2.received}'`;
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
      if (typeof issue2.validation === "object") {
        if ("includes" in issue2.validation) {
          message = `Invalid input: must include "${issue2.validation.includes}"`;
          if (typeof issue2.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue2.validation.position}`;
          }
        } else if ("startsWith" in issue2.validation) {
          message = `Invalid input: must start with "${issue2.validation.startsWith}"`;
        } else if ("endsWith" in issue2.validation) {
          message = `Invalid input: must end with "${issue2.validation.endsWith}"`;
        } else {
          util.assertNever(issue2.validation);
        }
      } else if (issue2.validation !== "regex") {
        message = `Invalid ${issue2.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue2.type === "array")
        message = `Array must contain ${issue2.exact ? "exactly" : issue2.inclusive ? `at least` : `more than`} ${issue2.minimum} element(s)`;
      else if (issue2.type === "string")
        message = `String must contain ${issue2.exact ? "exactly" : issue2.inclusive ? `at least` : `over`} ${issue2.minimum} character(s)`;
      else if (issue2.type === "number")
        message = `Number must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${issue2.minimum}`;
      else if (issue2.type === "bigint")
        message = `Number must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${issue2.minimum}`;
      else if (issue2.type === "date")
        message = `Date must be ${issue2.exact ? `exactly equal to ` : issue2.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue2.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue2.type === "array")
        message = `Array must contain ${issue2.exact ? `exactly` : issue2.inclusive ? `at most` : `less than`} ${issue2.maximum} element(s)`;
      else if (issue2.type === "string")
        message = `String must contain ${issue2.exact ? `exactly` : issue2.inclusive ? `at most` : `under`} ${issue2.maximum} character(s)`;
      else if (issue2.type === "number")
        message = `Number must be ${issue2.exact ? `exactly` : issue2.inclusive ? `less than or equal to` : `less than`} ${issue2.maximum}`;
      else if (issue2.type === "bigint")
        message = `BigInt must be ${issue2.exact ? `exactly` : issue2.inclusive ? `less than or equal to` : `less than`} ${issue2.maximum}`;
      else if (issue2.type === "date")
        message = `Date must be ${issue2.exact ? `exactly` : issue2.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue2.maximum))}`;
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
      message = `Number must be a multiple of ${issue2.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue2);
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
  const { data, path: path21, errorMaps, issueData } = params;
  const fullPath = [...path21, ...issueData.path || []];
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
  let errorMessage2 = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage2 = map(fullIssue, { data, defaultError: errorMessage2 }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage2
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue2 = makeIssue({
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
  ctx.common.issues.push(issue2);
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
  constructor(parent, value, path21, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path21;
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
        const error2 = new ZodError(ctx.common.issues);
        this._error = error2;
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
  refine(check2, message) {
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
      const result = check2(val);
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
  refinement(check2, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check2(val)) {
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
  transform(transform2) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform: transform2 }
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
function isValidIP(ip, version2) {
  if ((version2 === "v4" || !version2) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version2 === "v6" || !version2) && ipv6Regex.test(ip)) {
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
    const base642 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base642));
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
function isValidCidr(ip, version2) {
  if ((version2 === "v4" || !version2) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version2 === "v6" || !version2) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString2 extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.string) {
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
    for (const check2 of this._def.checks) {
      if (check2.kind === "min") {
        if (input.data.length < check2.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check2.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "max") {
        if (input.data.length > check2.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check2.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "length") {
        const tooBig = input.data.length > check2.value;
        const tooSmall = input.data.length < check2.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check2.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check2.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check2.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check2.message
            });
          }
          status.dirty();
        }
      } else if (check2.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "regex") {
        check2.regex.lastIndex = 0;
        const testResult = check2.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "trim") {
        input.data = input.data.trim();
      } else if (check2.kind === "includes") {
        if (!input.data.includes(check2.value, check2.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check2.value, position: check2.position },
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check2.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check2.kind === "startsWith") {
        if (!input.data.startsWith(check2.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check2.value },
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "endsWith") {
        if (!input.data.endsWith(check2.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check2.value },
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "datetime") {
        const regex = datetimeRegex(check2);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "time") {
        const regex = timeRegex(check2);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "ip") {
        if (!isValidIP(input.data, check2.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "jwt") {
        if (!isValidJWT(input.data, check2.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "cidr") {
        if (!isValidCidr(input.data, check2.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check2.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check2);
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
  _addCheck(check2) {
    return new _ZodString2({
      ...this._def,
      checks: [...this._def.checks, check2]
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
    return new _ZodString2({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString2({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString2({
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
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.number) {
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
    for (const check2 of this._def.checks) {
      if (check2.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "min") {
        const tooSmall = check2.inclusive ? input.data < check2.value : input.data <= check2.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check2.value,
            type: "number",
            inclusive: check2.inclusive,
            exact: false,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "max") {
        const tooBig = check2.inclusive ? input.data > check2.value : input.data >= check2.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check2.value,
            type: "number",
            inclusive: check2.inclusive,
            exact: false,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check2.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check2.value,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check2.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check2);
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
  _addCheck(check2) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check2]
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
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check2 of this._def.checks) {
      if (check2.kind === "min") {
        const tooSmall = check2.inclusive ? input.data < check2.value : input.data <= check2.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check2.value,
            inclusive: check2.inclusive,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "max") {
        const tooBig = check2.inclusive ? input.data > check2.value : input.data >= check2.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check2.value,
            inclusive: check2.inclusive,
            message: check2.message
          });
          status.dirty();
        }
      } else if (check2.kind === "multipleOf") {
        if (input.data % check2.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check2.value,
            message: check2.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check2);
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
  _addCheck(check2) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check2]
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
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.boolean) {
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
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.date) {
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
    for (const check2 of this._def.checks) {
      if (check2.kind === "min") {
        if (input.data.getTime() < check2.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check2.message,
            inclusive: true,
            exact: false,
            minimum: check2.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check2.kind === "max") {
        if (input.data.getTime() > check2.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check2.message,
            inclusive: true,
            exact: false,
            maximum: check2.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check2);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check2) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check2]
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
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.symbol) {
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
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.undefined) {
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
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.null) {
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
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.undefined) {
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
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.object) {
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
        errorMap: (issue2, ctx) => {
          const defaultError = this._def.errorMap?.(issue2, ctx).message ?? ctx.defaultError;
          if (issue2.code === "unrecognized_keys")
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
    function makeArgsIssue(args, error2) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error2
        }
      });
    }
    function makeReturnsIssue(returns, error2) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error2
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error2 = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error2.addIssue(makeArgsIssue(args, e));
          throw error2;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error2.addIssue(makeReturnsIssue(result, e));
          throw error2;
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
ZodEffects.createWithPreprocess = (preprocess2, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess2 },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType2 = this._getType(input);
    if (parsedType2 === ZodParsedType.undefined) {
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
    const parsedType2 = this._getType(input);
    if (parsedType2 === ZodParsedType.null) {
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
    const parsedType2 = this._getType(input);
    if (parsedType2 !== ZodParsedType.nan) {
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
function custom(check2, _params = {}, fatal) {
  if (check2)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check2(data);
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

// node_modules/zod/v4/core/core.js
var NEVER2 = Object.freeze({
  status: "aborted"
});
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer3, params) {
  function init(inst, def) {
    var _a;
    Object.defineProperty(inst, "_zod", {
      value: inst._zod ?? {},
      enumerable: false
    });
    (_a = inst._zod).traits ?? (_a.traits = /* @__PURE__ */ new Set());
    inst._zod.traits.add(name);
    initializer3(inst, def);
    for (const k in _.prototype) {
      if (!(k in inst))
        Object.defineProperty(inst, k, { value: _.prototype[k].bind(inst) });
    }
    inst._zod.constr = _;
    inst._zod.def = def;
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a;
    const inst = params?.Parent ? new Definition() : this;
    init(inst, def);
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $brand = Symbol("zod_brand");
var $ZodAsyncError = class extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
};
var globalConfig = {};
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}

// node_modules/zod/v4/core/util.js
var util_exports = {};
__export(util_exports, {
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES,
  Class: () => Class,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  aborted: () => aborted,
  allowsEval: () => allowsEval,
  assert: () => assert,
  assertEqual: () => assertEqual,
  assertIs: () => assertIs,
  assertNever: () => assertNever,
  assertNotEqual: () => assertNotEqual,
  assignProp: () => assignProp,
  cached: () => cached,
  captureStackTrace: () => captureStackTrace,
  cleanEnum: () => cleanEnum,
  cleanRegex: () => cleanRegex,
  clone: () => clone,
  createTransparentProxy: () => createTransparentProxy,
  defineLazy: () => defineLazy,
  esc: () => esc,
  escapeRegex: () => escapeRegex,
  extend: () => extend,
  finalizeIssue: () => finalizeIssue,
  floatSafeRemainder: () => floatSafeRemainder2,
  getElementAtPath: () => getElementAtPath,
  getEnumValues: () => getEnumValues,
  getLengthableOrigin: () => getLengthableOrigin,
  getParsedType: () => getParsedType2,
  getSizableOrigin: () => getSizableOrigin,
  isObject: () => isObject,
  isPlainObject: () => isPlainObject,
  issue: () => issue,
  joinValues: () => joinValues,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  merge: () => merge,
  normalizeParams: () => normalizeParams,
  nullish: () => nullish,
  numKeys: () => numKeys,
  omit: () => omit,
  optionalKeys: () => optionalKeys,
  partial: () => partial,
  pick: () => pick,
  prefixIssues: () => prefixIssues,
  primitiveTypes: () => primitiveTypes,
  promiseAllObject: () => promiseAllObject,
  propertyKeyTypes: () => propertyKeyTypes,
  randomString: () => randomString,
  required: () => required,
  stringifyPrimitive: () => stringifyPrimitive,
  unwrapMessage: () => unwrapMessage
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function assertIs(_arg) {
}
function assertNever(_x) {
  throw new Error();
}
function assert(_) {
}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set = false;
  return {
    get value() {
      if (!set) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder2(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
function defineLazy(object3, key, getter) {
  const set = false;
  Object.defineProperty(object3, key, {
    get() {
      if (!set) {
        const value = getter();
        object3[key] = value;
        return value;
      }
      throw new Error("cached value already set");
    },
    set(v) {
      Object.defineProperty(object3, key, {
        value: v
        // configurable: true,
      });
    },
    configurable: true
  });
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function getElementAtPath(obj, path21) {
  if (!path21)
    return obj;
  return path21.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0; i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}
function esc(str) {
  return JSON.stringify(str);
}
var captureStackTrace = Error.captureStackTrace ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = cached(() => {
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
var getParsedType2 = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return "promise";
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return "map";
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return "set";
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return "date";
      }
      if (typeof File !== "undefined" && data instanceof File) {
        return "file";
      }
      return "object";
    default:
      throw new Error(`Unknown data type: ${t}`);
  }
};
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
var primitiveTypes = /* @__PURE__ */ new Set(["string", "number", "bigint", "boolean", "symbol", "undefined"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const newShape = {};
  const currDef = schema._zod.def;
  for (const key in mask) {
    if (!(key in currDef.shape)) {
      throw new Error(`Unrecognized key: "${key}"`);
    }
    if (!mask[key])
      continue;
    newShape[key] = currDef.shape[key];
  }
  return clone(schema, {
    ...schema._zod.def,
    shape: newShape,
    checks: []
  });
}
function omit(schema, mask) {
  const newShape = { ...schema._zod.def.shape };
  const currDef = schema._zod.def;
  for (const key in mask) {
    if (!(key in currDef.shape)) {
      throw new Error(`Unrecognized key: "${key}"`);
    }
    if (!mask[key])
      continue;
    delete newShape[key];
  }
  return clone(schema, {
    ...schema._zod.def,
    shape: newShape,
    checks: []
  });
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const def = {
    ...schema._zod.def,
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    checks: []
    // delete existing checks
  };
  return clone(schema, def);
}
function merge(a, b) {
  return clone(a, {
    ...a._zod.def,
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    catchall: b._zod.def.catchall,
    checks: []
    // delete existing checks
  });
}
function partial(Class2, schema, mask) {
  const oldShape = schema._zod.def.shape;
  const shape = { ...oldShape };
  if (mask) {
    for (const key in mask) {
      if (!(key in oldShape)) {
        throw new Error(`Unrecognized key: "${key}"`);
      }
      if (!mask[key])
        continue;
      shape[key] = Class2 ? new Class2({
        type: "optional",
        innerType: oldShape[key]
      }) : oldShape[key];
    }
  } else {
    for (const key in oldShape) {
      shape[key] = Class2 ? new Class2({
        type: "optional",
        innerType: oldShape[key]
      }) : oldShape[key];
    }
  }
  return clone(schema, {
    ...schema._zod.def,
    shape,
    checks: []
  });
}
function required(Class2, schema, mask) {
  const oldShape = schema._zod.def.shape;
  const shape = { ...oldShape };
  if (mask) {
    for (const key in mask) {
      if (!(key in shape)) {
        throw new Error(`Unrecognized key: "${key}"`);
      }
      if (!mask[key])
        continue;
      shape[key] = new Class2({
        type: "nonoptional",
        innerType: oldShape[key]
      });
    }
  } else {
    for (const key in oldShape) {
      shape[key] = new Class2({
        type: "nonoptional",
        innerType: oldShape[key]
      });
    }
  }
  return clone(schema, {
    ...schema._zod.def,
    shape,
    // optional: [],
    checks: []
  });
}
function aborted(x, startIndex = 0) {
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true)
      return true;
  }
  return false;
}
function prefixIssues(path21, issues) {
  return issues.map((iss) => {
    var _a;
    (_a = iss).path ?? (_a.path = []);
    iss.path.unshift(path21);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config3) {
  const full = { ...iss, path: iss.path ?? [] };
  if (!iss.message) {
    const message = unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config3.customError?.(iss)) ?? unwrapMessage(config3.localeError?.(iss)) ?? "Invalid input";
    full.message = message;
  }
  delete full.inst;
  delete full.continue;
  if (!ctx?.reportInput) {
    delete full.input;
  }
  return full;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}
var Class = class {
  constructor(..._args) {
  }
};

// node_modules/zod/v4/core/errors.js
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  Object.defineProperty(inst, "message", {
    get() {
      return JSON.stringify(def, jsonStringifyReplacer, 2);
    },
    enumerable: true
    // configurable: false,
  });
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error2.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error2, _mapper) {
  const mapper = _mapper || function(issue2) {
    return issue2.message;
  };
  const fieldErrors = { _errors: [] };
  const processError = (error3) => {
    for (const issue2 of error3.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues });
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues });
      } else if (issue2.path.length === 0) {
        fieldErrors._errors.push(mapper(issue2));
      } else {
        let curr = fieldErrors;
        let i = 0;
        while (i < issue2.path.length) {
          const el = issue2.path[i];
          const terminal = i === issue2.path.length - 1;
          if (!terminal) {
            curr[el] = curr[el] || { _errors: [] };
          } else {
            curr[el] = curr[el] || { _errors: [] };
            curr[el]._errors.push(mapper(issue2));
          }
          curr = curr[el];
          i++;
        }
      }
    }
  };
  processError(error2);
  return fieldErrors;
}

// node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: false }) : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);

// node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][^\s-]{8,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version2) => {
  if (!version2)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var hostname = /^([a-zA-Z0-9-]+\.)*[a-zA-Z0-9-]+$/;
var e164 = /^\+(?:[0-9]){6,14}[0-9]$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const time3 = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-]\\d{2}:\\d{2})`);
  const timeRegex2 = `${time3}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex2})$`);
}
var string = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
var integer = /^\d+$/;
var number = /^-?\d+(?:\.\d+)?/i;
var boolean = /true|false/i;
var _null = /null/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    if (def.value < curr) {
      if (def.inclusive)
        bag.maximum = def.value;
      else
        bag.exclusiveMaximum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    if (def.value > curr) {
      if (def.inclusive)
        bag.minimum = def.value;
      else
        bag.exclusiveMinimum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    var _a;
    (_a = inst2._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
  });
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder2(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
    if (isInt)
      bag.pattern = integer;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inst
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== void 0;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a = inst._zod).check ?? (_a.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {
    });
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// node_modules/zod/v4/core/doc.js
var Doc = class {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split("\n").filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const content = this?.content ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join("\n"));
  }
};

// node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 0,
  patch: 0
};

// node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      let isAborted2 = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted2) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted2)
              isAborted2 = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted2)
            isAborted2 = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    inst._zod.run = (payload, ctx) => {
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  inst["~standard"] = {
    validate: (value) => {
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  };
});
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {
      }
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === void 0)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const orig = payload.value;
      const url = new URL(orig);
      const href = url.href;
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url.hostname)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (!orig.endsWith("/") && href.endsWith("/")) {
        payload.value = href.slice(0, -1);
      } else {
        payload.value = href;
      }
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = `ipv4`;
  });
});
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = `ipv6`;
  });
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const [address, prefix] = payload.value.split("/");
    try {
      if (!prefix)
        throw new Error();
      const prefixNum = Number(prefix);
      if (`${prefixNum}` !== prefix)
        throw new Error();
      if (prefixNum < 0 || prefixNum > 128)
        throw new Error();
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    inst2._zod.bag.contentEncoding = "base64";
  });
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    inst2._zod.bag.contentEncoding = "base64url";
  });
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT2(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT2(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = inst._zod.bag.pattern ?? number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodNull = /* @__PURE__ */ $constructor("$ZodNull", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = _null;
  inst._zod.values = /* @__PURE__ */ new Set([null]);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (input === null)
      return payload;
    payload.issues.push({
      expected: "null",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handleObjectResult(result, final, key) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(key, result.issues));
  }
  final.value[key] = result.value;
}
function handleOptionalObjectResult(result, final, key, input) {
  if (result.issues.length) {
    if (input[key] === void 0) {
      if (key in input) {
        final.value[key] = void 0;
      } else {
        final.value[key] = result.value;
      }
    } else {
      final.issues.push(...prefixIssues(key, result.issues));
    }
  } else if (result.value === void 0) {
    if (key in input)
      final.value[key] = void 0;
  } else {
    final.value[key] = result.value;
  }
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const _normalized = cached(() => {
    const keys = Object.keys(def.shape);
    for (const k of keys) {
      if (!(def.shape[k] instanceof $ZodType)) {
        throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
      }
    }
    const okeys = optionalKeys(def.shape);
    return {
      shape: def.shape,
      keys,
      keySet: new Set(keys),
      numKeys: keys.length,
      optionalKeys: new Set(okeys)
    };
  });
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = /* @__PURE__ */ Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {}`);
    for (const key of normalized.keys) {
      if (normalized.optionalKeys.has(key)) {
        const id = ids[key];
        doc.write(`const ${id} = ${parseStr(key)};`);
        const k = esc(key);
        doc.write(`
        if (${id}.issues.length) {
          if (input[${k}] === undefined) {
            if (${k} in input) {
              newResult[${k}] = undefined;
            }
          } else {
            payload.issues = payload.issues.concat(
              ${id}.issues.map((iss) => ({
                ...iss,
                path: iss.path ? [${k}, ...iss.path] : [${k}],
              }))
            );
          }
        } else if (${id}.value === undefined) {
          if (${k} in input) newResult[${k}] = undefined;
        } else {
          newResult[${k}] = ${id}.value;
        }
        `);
      } else {
        const id = ids[key];
        doc.write(`const ${id} = ${parseStr(key)};`);
        doc.write(`
          if (${id}.issues.length) payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${esc(key)}, ...iss.path] : [${esc(key)}]
          })));`);
        doc.write(`newResult[${esc(key)}] = ${id}.value`);
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
    } else {
      payload.value = {};
      const shape = value.shape;
      for (const key of value.keys) {
        const el = shape[key];
        const r = el._zod.run({ value: input[key], issues: [] }, ctx);
        const isOptional = el._zod.optin === "optional" && el._zod.optout === "optional";
        if (r instanceof Promise) {
          proms.push(r.then((r2) => isOptional ? handleOptionalObjectResult(r2, payload, key, input) : handleObjectResult(r2, payload, key)));
        } else if (isOptional) {
          handleOptionalObjectResult(r, payload, key, input);
        } else {
          handleObjectResult(r, payload, key);
        }
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    const unrecognized = [];
    const keySet = value.keySet;
    const _catchall = catchall._zod;
    const t = _catchall.def.type;
    for (const key of Object.keys(input)) {
      if (keySet.has(key))
        continue;
      if (t === "never") {
        unrecognized.push(key);
        continue;
      }
      const r = _catchall.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handleObjectResult(r2, payload, key)));
      } else {
        handleObjectResult(r, payload, key);
      }
    }
    if (unrecognized.length) {
      payload.issues.push({
        code: "unrecognized_keys",
        keys: unrecognized,
        input,
        inst
      });
    }
    if (!proms.length)
      return payload;
    return Promise.all(proms).then(() => {
      return payload;
    });
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return void 0;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
var $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  const _super = inst._zod.parse;
  defineLazy(inst._zod, "propValues", () => {
    const propValues = {};
    for (const option of def.options) {
      const pv = option._zod.propValues;
      if (!pv || Object.keys(pv).length === 0)
        throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
      for (const [k, v] of Object.entries(pv)) {
        if (!propValues[k])
          propValues[k] = /* @__PURE__ */ new Set();
        for (const val of v) {
          propValues[k].add(val);
        }
      }
    }
    return propValues;
  });
  const disc = cached(() => {
    const opts = def.options;
    const map = /* @__PURE__ */ new Map();
    for (const o of opts) {
      const values = o._zod.propValues[def.discriminator];
      if (!values || values.size === 0)
        throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(o)}"`);
      for (const v of values) {
        if (map.has(v)) {
          throw new Error(`Duplicate discriminator value "${String(v)}"`);
        }
        map.set(v, o);
      }
    }
    return map;
  });
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isObject(input)) {
      payload.issues.push({
        code: "invalid_type",
        expected: "object",
        input,
        inst
      });
      return payload;
    }
    const opt = disc.value.get(input?.[def.discriminator]);
    if (opt) {
      return opt._zod.run(payload, ctx);
    }
    if (def.unionFallback) {
      return _super(payload, ctx);
    }
    payload.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      input,
      path: [def.discriminator],
      inst
    });
    return payload;
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues2(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues2(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues2(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  if (left.issues.length) {
    result.issues.push(...left.issues);
  }
  if (right.issues.length) {
    result.issues.push(...right.issues);
  }
  if (aborted(result))
    return result;
  const merged = mergeValues2(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    if (def.keyType._zod.values) {
      const values = def.keyType._zod.values;
      payload.value = {};
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => {
              if (result2.issues.length) {
                payload.issues.push(...prefixIssues(key, result2.issues));
              }
              payload.value[key] = result2.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[key] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!values.has(key)) {
          unrecognized = unrecognized ?? [];
          unrecognized.push(key);
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized
        });
      }
    } else {
      payload.value = {};
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        if (keyResult.issues.length) {
          payload.issues.push({
            origin: "record",
            code: "invalid_key",
            issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
            input: key,
            path: [key],
            inst
          });
          payload.value[keyResult.value] = keyResult.value;
          continue;
        }
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result2) => {
            if (result2.issues.length) {
              payload.issues.push(...prefixIssues(key, result2.issues));
            }
            payload.value[keyResult.value] = result2.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[keyResult.value] = result.value;
        }
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  inst._zod.values = new Set(values);
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (inst._zod.values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.values = new Set(def.values);
  inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? o.toString() : String(o)).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (inst._zod.values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const _out = def.transform(payload.value, payload);
    if (_ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError();
    }
    payload.value = _out;
    return payload;
  };
});
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === void 0) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => {
        payload.value = result2.value;
        if (result2.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result2.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
    }
    return payload;
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  inst._zod.parse = (payload, ctx) => {
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def, ctx));
    }
    return handlePipeResult(left, def, ctx);
  };
});
function handlePipeResult(left, def, ctx) {
  if (aborted(left)) {
    return left;
  }
  return def.out._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}

// node_modules/zod/v4/locales/en.js
var parsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "NaN" : "number";
    }
    case "object": {
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
        return data.constructor.name;
      }
    }
  }
  return t;
};
var error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const Nouns = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    jwt: "JWT",
    template_literal: "input"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Invalid input: expected ${issue2.expected}, received ${parsedType(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Too small: expected ${issue2.origin} to have ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue2.origin} to be ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue2.origin}`;
      case "invalid_union":
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue2.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default2() {
  return {
    localeError: error()
  };
}

// node_modules/zod/v4/core/registries.js
var $output = Symbol("ZodOutput");
var $input = Symbol("ZodInput");
var $ZodRegistry = class {
  constructor() {
    this._map = /* @__PURE__ */ new Map();
    this._idmap = /* @__PURE__ */ new Map();
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      if (this._idmap.has(meta.id)) {
        throw new Error(`ID ${meta.id} already exists in the registry`);
      }
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new Map();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      return { ...pm, ...this._map.get(schema) };
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
};
function registry() {
  return new $ZodRegistry();
}
var globalRegistry = /* @__PURE__ */ registry();

// node_modules/zod/v4/core/api.js
function _string(Class2, params) {
  return new Class2({
    type: "string",
    ...normalizeParams(params)
  });
}
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class2, params) {
  return new Class2({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _boolean(Class2, params) {
  return new Class2({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _null2(Class2, params) {
  return new Class2({
    type: "null",
    ...normalizeParams(params)
  });
}
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    // get element() {
    //   return element;
    // },
    ...normalizeParams(params)
  });
}
function _custom(Class2, fn, _params) {
  const norm = normalizeParams(_params);
  norm.abort ?? (norm.abort = true);
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...norm
  });
  return schema;
}
function _refine(Class2, fn, _params) {
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}

// node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js
function isZ4Schema(s) {
  const schema = s;
  return !!schema._zod;
}
function safeParse2(schema, data) {
  if (isZ4Schema(schema)) {
    const result2 = safeParse(schema, data);
    return result2;
  }
  const v3Schema = schema;
  const result = v3Schema.safeParse(data);
  return result;
}
function getObjectShape(schema) {
  if (!schema)
    return void 0;
  let rawShape;
  if (isZ4Schema(schema)) {
    const v4Schema = schema;
    rawShape = v4Schema._zod?.def?.shape;
  } else {
    const v3Schema = schema;
    rawShape = v3Schema.shape;
  }
  if (!rawShape)
    return void 0;
  if (typeof rawShape === "function") {
    try {
      return rawShape();
    } catch {
      return void 0;
    }
  }
  return rawShape;
}
function getLiteralValue(schema) {
  if (isZ4Schema(schema)) {
    const v4Schema = schema;
    const def2 = v4Schema._zod?.def;
    if (def2) {
      if (def2.value !== void 0)
        return def2.value;
      if (Array.isArray(def2.values) && def2.values.length > 0) {
        return def2.values[0];
      }
    }
  }
  const v3Schema = schema;
  const def = v3Schema._def;
  if (def) {
    if (def.value !== void 0)
      return def.value;
    if (Array.isArray(def.values) && def.values.length > 0) {
      return def.values[0];
    }
  }
  const directValue = schema.value;
  if (directValue !== void 0)
    return directValue;
  return void 0;
}

// node_modules/zod/v4/classic/iso.js
var iso_exports = {};
__export(iso_exports, {
  ZodISODate: () => ZodISODate,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODuration: () => ZodISODuration,
  ZodISOTime: () => ZodISOTime,
  date: () => date2,
  datetime: () => datetime2,
  duration: () => duration2,
  time: () => time2
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function date2(params) {
  return _isoDate(ZodISODate, params);
}
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}

// node_modules/zod/v4/classic/errors.js
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: (mapper) => formatError(inst, mapper)
      // enumerable: false,
    },
    flatten: {
      value: (mapper) => flattenError(inst, mapper)
      // enumerable: false,
    },
    addIssue: {
      value: (issue2) => inst.issues.push(issue2)
      // enumerable: false,
    },
    addIssues: {
      value: (issues2) => inst.issues.push(...issues2)
      // enumerable: false,
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
      // enumerable: false,
    }
  });
};
var ZodError2 = $constructor("ZodError", initializer2);
var ZodRealError = $constructor("ZodError", initializer2, {
  Parent: Error
});

// node_modules/zod/v4/classic/parse.js
var parse2 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync2 = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse3 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);

// node_modules/zod/v4/classic/schemas.js
var ZodType2 = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  inst.def = def;
  Object.defineProperty(inst, "_def", { value: def });
  inst.check = (...checks) => {
    return inst.clone(
      {
        ...def,
        checks: [
          ...def.checks ?? [],
          ...checks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
        ]
      }
      // { parent: true }
    );
  };
  inst.clone = (def2, params) => clone(inst, def2, params);
  inst.brand = () => inst;
  inst.register = (reg, meta) => {
    reg.add(inst, meta);
    return inst;
  };
  inst.parse = (data, params) => parse2(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse3(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync2(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.refine = (check2, params) => inst.check(refine(check2, params));
  inst.superRefine = (refinement) => inst.check(superRefine(refinement));
  inst.overwrite = (fn) => inst.check(_overwrite(fn));
  inst.optional = () => optional(inst);
  inst.nullable = () => nullable(inst);
  inst.nullish = () => optional(nullable(inst));
  inst.nonoptional = (params) => nonoptional(inst, params);
  inst.array = () => array(inst);
  inst.or = (arg) => union([inst, arg]);
  inst.and = (arg) => intersection(inst, arg);
  inst.transform = (tx) => pipe(inst, transform(tx));
  inst.default = (def2) => _default(inst, def2);
  inst.prefault = (def2) => prefault(inst, def2);
  inst.catch = (params) => _catch(inst, params);
  inst.pipe = (target) => pipe(inst, target);
  inst.readonly = () => readonly(inst);
  inst.describe = (description) => {
    const cl = inst.clone();
    globalRegistry.add(cl, { description });
    return cl;
  };
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true
  });
  inst.meta = (...args) => {
    if (args.length === 0) {
      return globalRegistry.get(inst);
    }
    const cl = inst.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  };
  inst.isOptional = () => inst.safeParse(void 0).success;
  inst.isNullable = () => inst.safeParse(null).success;
  return inst;
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType2.init(inst, def);
  const bag = inst._zod.bag;
  inst.format = bag.format ?? null;
  inst.minLength = bag.minimum ?? null;
  inst.maxLength = bag.maximum ?? null;
  inst.regex = (...args) => inst.check(_regex(...args));
  inst.includes = (...args) => inst.check(_includes(...args));
  inst.startsWith = (...args) => inst.check(_startsWith(...args));
  inst.endsWith = (...args) => inst.check(_endsWith(...args));
  inst.min = (...args) => inst.check(_minLength(...args));
  inst.max = (...args) => inst.check(_maxLength(...args));
  inst.length = (...args) => inst.check(_length(...args));
  inst.nonempty = (...args) => inst.check(_minLength(1, ...args));
  inst.lowercase = (params) => inst.check(_lowercase(params));
  inst.uppercase = (params) => inst.check(_uppercase(params));
  inst.trim = () => inst.check(_trim());
  inst.normalize = (...args) => inst.check(_normalize(...args));
  inst.toLowerCase = () => inst.check(_toLowerCase());
  inst.toUpperCase = () => inst.check(_toUpperCase());
});
var ZodString2 = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
  inst.email = (params) => inst.check(_email(ZodEmail, params));
  inst.url = (params) => inst.check(_url(ZodURL, params));
  inst.jwt = (params) => inst.check(_jwt(ZodJWT, params));
  inst.emoji = (params) => inst.check(_emoji2(ZodEmoji, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.uuid = (params) => inst.check(_uuid(ZodUUID, params));
  inst.uuidv4 = (params) => inst.check(_uuidv4(ZodUUID, params));
  inst.uuidv6 = (params) => inst.check(_uuidv6(ZodUUID, params));
  inst.uuidv7 = (params) => inst.check(_uuidv7(ZodUUID, params));
  inst.nanoid = (params) => inst.check(_nanoid(ZodNanoID, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.cuid = (params) => inst.check(_cuid(ZodCUID, params));
  inst.cuid2 = (params) => inst.check(_cuid2(ZodCUID2, params));
  inst.ulid = (params) => inst.check(_ulid(ZodULID, params));
  inst.base64 = (params) => inst.check(_base64(ZodBase64, params));
  inst.base64url = (params) => inst.check(_base64url(ZodBase64URL, params));
  inst.xid = (params) => inst.check(_xid(ZodXID, params));
  inst.ksuid = (params) => inst.check(_ksuid(ZodKSUID, params));
  inst.ipv4 = (params) => inst.check(_ipv4(ZodIPv4, params));
  inst.ipv6 = (params) => inst.check(_ipv6(ZodIPv6, params));
  inst.cidrv4 = (params) => inst.check(_cidrv4(ZodCIDRv4, params));
  inst.cidrv6 = (params) => inst.check(_cidrv6(ZodCIDRv6, params));
  inst.e164 = (params) => inst.check(_e164(ZodE164, params));
  inst.datetime = (params) => inst.check(datetime2(params));
  inst.date = (params) => inst.check(date2(params));
  inst.time = (params) => inst.check(time2(params));
  inst.duration = (params) => inst.check(duration2(params));
});
function string2(params) {
  return _string(ZodString2, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber2 = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType2.init(inst, def);
  inst.gt = (value, params) => inst.check(_gt(value, params));
  inst.gte = (value, params) => inst.check(_gte(value, params));
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.lt = (value, params) => inst.check(_lt(value, params));
  inst.lte = (value, params) => inst.check(_lte(value, params));
  inst.max = (value, params) => inst.check(_lte(value, params));
  inst.int = (params) => inst.check(int(params));
  inst.safe = (params) => inst.check(int(params));
  inst.positive = (params) => inst.check(_gt(0, params));
  inst.nonnegative = (params) => inst.check(_gte(0, params));
  inst.negative = (params) => inst.check(_lt(0, params));
  inst.nonpositive = (params) => inst.check(_lte(0, params));
  inst.multipleOf = (value, params) => inst.check(_multipleOf(value, params));
  inst.step = (value, params) => inst.check(_multipleOf(value, params));
  inst.finite = () => inst;
  const bag = inst._zod.bag;
  inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
  inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
  inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? 0.5);
  inst.isFinite = true;
  inst.format = bag.format ?? null;
});
function number2(params) {
  return _number(ZodNumber2, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber2.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean2 = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType2.init(inst, def);
});
function boolean2(params) {
  return _boolean(ZodBoolean2, params);
}
var ZodNull2 = /* @__PURE__ */ $constructor("ZodNull", (inst, def) => {
  $ZodNull.init(inst, def);
  ZodType2.init(inst, def);
});
function _null3(params) {
  return _null2(ZodNull2, params);
}
var ZodUnknown2 = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType2.init(inst, def);
});
function unknown() {
  return _unknown(ZodUnknown2);
}
var ZodNever2 = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType2.init(inst, def);
});
function never(params) {
  return _never(ZodNever2, params);
}
var ZodArray2 = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType2.init(inst, def);
  inst.element = def.element;
  inst.min = (minLength, params) => inst.check(_minLength(minLength, params));
  inst.nonempty = (params) => inst.check(_minLength(1, params));
  inst.max = (maxLength, params) => inst.check(_maxLength(maxLength, params));
  inst.length = (len, params) => inst.check(_length(len, params));
  inst.unwrap = () => inst.element;
});
function array(element, params) {
  return _array(ZodArray2, element, params);
}
var ZodObject2 = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  $ZodObject.init(inst, def);
  ZodType2.init(inst, def);
  util_exports.defineLazy(inst, "shape", () => def.shape);
  inst.keyof = () => _enum(Object.keys(inst._zod.def.shape));
  inst.catchall = (catchall) => inst.clone({ ...inst._zod.def, catchall });
  inst.passthrough = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
  inst.loose = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
  inst.strict = () => inst.clone({ ...inst._zod.def, catchall: never() });
  inst.strip = () => inst.clone({ ...inst._zod.def, catchall: void 0 });
  inst.extend = (incoming) => {
    return util_exports.extend(inst, incoming);
  };
  inst.merge = (other) => util_exports.merge(inst, other);
  inst.pick = (mask) => util_exports.pick(inst, mask);
  inst.omit = (mask) => util_exports.omit(inst, mask);
  inst.partial = (...args) => util_exports.partial(ZodOptional2, inst, args[0]);
  inst.required = (...args) => util_exports.required(ZodNonOptional, inst, args[0]);
});
function object2(shape, params) {
  const def = {
    type: "object",
    get shape() {
      util_exports.assignProp(this, "shape", { ...shape });
      return this.shape;
    },
    ...util_exports.normalizeParams(params)
  };
  return new ZodObject2(def);
}
function looseObject(shape, params) {
  return new ZodObject2({
    type: "object",
    get shape() {
      util_exports.assignProp(this, "shape", { ...shape });
      return this.shape;
    },
    catchall: unknown(),
    ...util_exports.normalizeParams(params)
  });
}
var ZodUnion2 = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType2.init(inst, def);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion2({
    type: "union",
    options,
    ...util_exports.normalizeParams(params)
  });
}
var ZodDiscriminatedUnion2 = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
  ZodUnion2.init(inst, def);
  $ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion2({
    type: "union",
    options,
    discriminator,
    ...util_exports.normalizeParams(params)
  });
}
var ZodIntersection2 = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType2.init(inst, def);
});
function intersection(left, right) {
  return new ZodIntersection2({
    type: "intersection",
    left,
    right
  });
}
var ZodRecord2 = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  $ZodRecord.init(inst, def);
  ZodType2.init(inst, def);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  return new ZodRecord2({
    type: "record",
    keyType,
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodEnum2 = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType2.init(inst, def);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum2({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum2({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum2({
    type: "enum",
    entries,
    ...util_exports.normalizeParams(params)
  });
}
var ZodLiteral2 = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType2.init(inst, def);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral2({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...util_exports.normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType2.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(util_exports.issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        _issue.continue ?? (_issue.continue = true);
        payload.issues.push(util_exports.issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional2 = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType2.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional2({
    type: "optional",
    innerType
  });
}
var ZodNullable2 = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType2.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable2({
    type: "nullable",
    innerType
  });
}
var ZodDefault2 = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType2.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault2({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : defaultValue;
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType2.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : defaultValue;
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType2.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodCatch2 = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType2.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch2({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType2.init(inst, def);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
    // ...util.normalizeParams(params),
  });
}
var ZodReadonly2 = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType2.init(inst, def);
});
function readonly(innerType) {
  return new ZodReadonly2({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType2.init(inst, def);
});
function check(fn) {
  const ch = new $ZodCheck({
    check: "custom"
    // ...util.normalizeParams(params),
  });
  ch._zod.check = fn;
  return ch;
}
function custom2(fn, _params) {
  return _custom(ZodCustom, fn ?? (() => true), _params);
}
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn) {
  const ch = check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(util_exports.issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(util_exports.issue(_issue));
      }
    };
    return fn(payload.value, payload);
  });
  return ch;
}
function preprocess(fn, schema) {
  return pipe(transform(fn), schema);
}

// node_modules/zod/v4/classic/external.js
config(en_default2());

// node_modules/@modelcontextprotocol/sdk/dist/esm/types.js
var LATEST_PROTOCOL_VERSION = "2025-11-25";
var SUPPORTED_PROTOCOL_VERSIONS = [LATEST_PROTOCOL_VERSION, "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];
var RELATED_TASK_META_KEY = "io.modelcontextprotocol/related-task";
var JSONRPC_VERSION = "2.0";
var AssertObjectSchema = custom2((v) => v !== null && (typeof v === "object" || typeof v === "function"));
var ProgressTokenSchema = union([string2(), number2().int()]);
var CursorSchema = string2();
var TaskCreationParamsSchema = looseObject({
  /**
   * Requested duration in milliseconds to retain task from creation.
   */
  ttl: number2().optional(),
  /**
   * Time in milliseconds to wait between task status requests.
   */
  pollInterval: number2().optional()
});
var TaskMetadataSchema = object2({
  ttl: number2().optional()
});
var RelatedTaskMetadataSchema = object2({
  taskId: string2()
});
var RequestMetaSchema = looseObject({
  /**
   * If specified, the caller is requesting out-of-band progress notifications for this request (as represented by notifications/progress). The value of this parameter is an opaque token that will be attached to any subsequent notifications. The receiver is not obligated to provide these notifications.
   */
  progressToken: ProgressTokenSchema.optional(),
  /**
   * If specified, this request is related to the provided task.
   */
  [RELATED_TASK_META_KEY]: RelatedTaskMetadataSchema.optional()
});
var BaseRequestParamsSchema = object2({
  /**
   * See [General fields: `_meta`](/specification/draft/basic/index#meta) for notes on `_meta` usage.
   */
  _meta: RequestMetaSchema.optional()
});
var TaskAugmentedRequestParamsSchema = BaseRequestParamsSchema.extend({
  /**
   * If specified, the caller is requesting task-augmented execution for this request.
   * The request will return a CreateTaskResult immediately, and the actual result can be
   * retrieved later via tasks/result.
   *
   * Task augmentation is subject to capability negotiation - receivers MUST declare support
   * for task augmentation of specific request types in their capabilities.
   */
  task: TaskMetadataSchema.optional()
});
var isTaskAugmentedRequestParams = (value) => TaskAugmentedRequestParamsSchema.safeParse(value).success;
var RequestSchema = object2({
  method: string2(),
  params: BaseRequestParamsSchema.loose().optional()
});
var NotificationsParamsSchema = object2({
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: RequestMetaSchema.optional()
});
var NotificationSchema = object2({
  method: string2(),
  params: NotificationsParamsSchema.loose().optional()
});
var ResultSchema = looseObject({
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: RequestMetaSchema.optional()
});
var RequestIdSchema = union([string2(), number2().int()]);
var JSONRPCRequestSchema = object2({
  jsonrpc: literal(JSONRPC_VERSION),
  id: RequestIdSchema,
  ...RequestSchema.shape
}).strict();
var isJSONRPCRequest = (value) => JSONRPCRequestSchema.safeParse(value).success;
var JSONRPCNotificationSchema = object2({
  jsonrpc: literal(JSONRPC_VERSION),
  ...NotificationSchema.shape
}).strict();
var isJSONRPCNotification = (value) => JSONRPCNotificationSchema.safeParse(value).success;
var JSONRPCResultResponseSchema = object2({
  jsonrpc: literal(JSONRPC_VERSION),
  id: RequestIdSchema,
  result: ResultSchema
}).strict();
var isJSONRPCResultResponse = (value) => JSONRPCResultResponseSchema.safeParse(value).success;
var ErrorCode;
(function(ErrorCode2) {
  ErrorCode2[ErrorCode2["ConnectionClosed"] = -32e3] = "ConnectionClosed";
  ErrorCode2[ErrorCode2["RequestTimeout"] = -32001] = "RequestTimeout";
  ErrorCode2[ErrorCode2["ParseError"] = -32700] = "ParseError";
  ErrorCode2[ErrorCode2["InvalidRequest"] = -32600] = "InvalidRequest";
  ErrorCode2[ErrorCode2["MethodNotFound"] = -32601] = "MethodNotFound";
  ErrorCode2[ErrorCode2["InvalidParams"] = -32602] = "InvalidParams";
  ErrorCode2[ErrorCode2["InternalError"] = -32603] = "InternalError";
  ErrorCode2[ErrorCode2["UrlElicitationRequired"] = -32042] = "UrlElicitationRequired";
})(ErrorCode || (ErrorCode = {}));
var JSONRPCErrorResponseSchema = object2({
  jsonrpc: literal(JSONRPC_VERSION),
  id: RequestIdSchema.optional(),
  error: object2({
    /**
     * The error type that occurred.
     */
    code: number2().int(),
    /**
     * A short description of the error. The message SHOULD be limited to a concise single sentence.
     */
    message: string2(),
    /**
     * Additional information about the error. The value of this member is defined by the sender (e.g. detailed error information, nested errors etc.).
     */
    data: unknown().optional()
  })
}).strict();
var isJSONRPCErrorResponse = (value) => JSONRPCErrorResponseSchema.safeParse(value).success;
var JSONRPCMessageSchema = union([
  JSONRPCRequestSchema,
  JSONRPCNotificationSchema,
  JSONRPCResultResponseSchema,
  JSONRPCErrorResponseSchema
]);
var JSONRPCResponseSchema = union([JSONRPCResultResponseSchema, JSONRPCErrorResponseSchema]);
var EmptyResultSchema = ResultSchema.strict();
var CancelledNotificationParamsSchema = NotificationsParamsSchema.extend({
  /**
   * The ID of the request to cancel.
   *
   * This MUST correspond to the ID of a request previously issued in the same direction.
   */
  requestId: RequestIdSchema.optional(),
  /**
   * An optional string describing the reason for the cancellation. This MAY be logged or presented to the user.
   */
  reason: string2().optional()
});
var CancelledNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/cancelled"),
  params: CancelledNotificationParamsSchema
});
var IconSchema = object2({
  /**
   * URL or data URI for the icon.
   */
  src: string2(),
  /**
   * Optional MIME type for the icon.
   */
  mimeType: string2().optional(),
  /**
   * Optional array of strings that specify sizes at which the icon can be used.
   * Each string should be in WxH format (e.g., `"48x48"`, `"96x96"`) or `"any"` for scalable formats like SVG.
   *
   * If not provided, the client should assume that the icon can be used at any size.
   */
  sizes: array(string2()).optional(),
  /**
   * Optional specifier for the theme this icon is designed for. `light` indicates
   * the icon is designed to be used with a light background, and `dark` indicates
   * the icon is designed to be used with a dark background.
   *
   * If not provided, the client should assume the icon can be used with any theme.
   */
  theme: _enum(["light", "dark"]).optional()
});
var IconsSchema = object2({
  /**
   * Optional set of sized icons that the client can display in a user interface.
   *
   * Clients that support rendering icons MUST support at least the following MIME types:
   * - `image/png` - PNG images (safe, universal compatibility)
   * - `image/jpeg` (and `image/jpg`) - JPEG images (safe, universal compatibility)
   *
   * Clients that support rendering icons SHOULD also support:
   * - `image/svg+xml` - SVG images (scalable but requires security precautions)
   * - `image/webp` - WebP images (modern, efficient format)
   */
  icons: array(IconSchema).optional()
});
var BaseMetadataSchema = object2({
  /** Intended for programmatic or logical use, but used as a display name in past specs or fallback */
  name: string2(),
  /**
   * Intended for UI and end-user contexts — optimized to be human-readable and easily understood,
   * even by those unfamiliar with domain-specific terminology.
   *
   * If not provided, the name should be used for display (except for Tool,
   * where `annotations.title` should be given precedence over using `name`,
   * if present).
   */
  title: string2().optional()
});
var ImplementationSchema = BaseMetadataSchema.extend({
  ...BaseMetadataSchema.shape,
  ...IconsSchema.shape,
  version: string2(),
  /**
   * An optional URL of the website for this implementation.
   */
  websiteUrl: string2().optional(),
  /**
   * An optional human-readable description of what this implementation does.
   *
   * This can be used by clients or servers to provide context about their purpose
   * and capabilities. For example, a server might describe the types of resources
   * or tools it provides, while a client might describe its intended use case.
   */
  description: string2().optional()
});
var FormElicitationCapabilitySchema = intersection(object2({
  applyDefaults: boolean2().optional()
}), record(string2(), unknown()));
var ElicitationCapabilitySchema = preprocess((value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (Object.keys(value).length === 0) {
      return { form: {} };
    }
  }
  return value;
}, intersection(object2({
  form: FormElicitationCapabilitySchema.optional(),
  url: AssertObjectSchema.optional()
}), record(string2(), unknown()).optional()));
var ClientTasksCapabilitySchema = looseObject({
  /**
   * Present if the client supports listing tasks.
   */
  list: AssertObjectSchema.optional(),
  /**
   * Present if the client supports cancelling tasks.
   */
  cancel: AssertObjectSchema.optional(),
  /**
   * Capabilities for task creation on specific request types.
   */
  requests: looseObject({
    /**
     * Task support for sampling requests.
     */
    sampling: looseObject({
      createMessage: AssertObjectSchema.optional()
    }).optional(),
    /**
     * Task support for elicitation requests.
     */
    elicitation: looseObject({
      create: AssertObjectSchema.optional()
    }).optional()
  }).optional()
});
var ServerTasksCapabilitySchema = looseObject({
  /**
   * Present if the server supports listing tasks.
   */
  list: AssertObjectSchema.optional(),
  /**
   * Present if the server supports cancelling tasks.
   */
  cancel: AssertObjectSchema.optional(),
  /**
   * Capabilities for task creation on specific request types.
   */
  requests: looseObject({
    /**
     * Task support for tool requests.
     */
    tools: looseObject({
      call: AssertObjectSchema.optional()
    }).optional()
  }).optional()
});
var ClientCapabilitiesSchema = object2({
  /**
   * Experimental, non-standard capabilities that the client supports.
   */
  experimental: record(string2(), AssertObjectSchema).optional(),
  /**
   * Present if the client supports sampling from an LLM.
   */
  sampling: object2({
    /**
     * Present if the client supports context inclusion via includeContext parameter.
     * If not declared, servers SHOULD only use `includeContext: "none"` (or omit it).
     */
    context: AssertObjectSchema.optional(),
    /**
     * Present if the client supports tool use via tools and toolChoice parameters.
     */
    tools: AssertObjectSchema.optional()
  }).optional(),
  /**
   * Present if the client supports eliciting user input.
   */
  elicitation: ElicitationCapabilitySchema.optional(),
  /**
   * Present if the client supports listing roots.
   */
  roots: object2({
    /**
     * Whether the client supports issuing notifications for changes to the roots list.
     */
    listChanged: boolean2().optional()
  }).optional(),
  /**
   * Present if the client supports task creation.
   */
  tasks: ClientTasksCapabilitySchema.optional(),
  /**
   * Extensions that the client supports. Keys are extension identifiers (vendor-prefix/extension-name).
   */
  extensions: record(string2(), AssertObjectSchema).optional()
});
var InitializeRequestParamsSchema = BaseRequestParamsSchema.extend({
  /**
   * The latest version of the Model Context Protocol that the client supports. The client MAY decide to support older versions as well.
   */
  protocolVersion: string2(),
  capabilities: ClientCapabilitiesSchema,
  clientInfo: ImplementationSchema
});
var InitializeRequestSchema = RequestSchema.extend({
  method: literal("initialize"),
  params: InitializeRequestParamsSchema
});
var ServerCapabilitiesSchema = object2({
  /**
   * Experimental, non-standard capabilities that the server supports.
   */
  experimental: record(string2(), AssertObjectSchema).optional(),
  /**
   * Present if the server supports sending log messages to the client.
   */
  logging: AssertObjectSchema.optional(),
  /**
   * Present if the server supports sending completions to the client.
   */
  completions: AssertObjectSchema.optional(),
  /**
   * Present if the server offers any prompt templates.
   */
  prompts: object2({
    /**
     * Whether this server supports issuing notifications for changes to the prompt list.
     */
    listChanged: boolean2().optional()
  }).optional(),
  /**
   * Present if the server offers any resources to read.
   */
  resources: object2({
    /**
     * Whether this server supports clients subscribing to resource updates.
     */
    subscribe: boolean2().optional(),
    /**
     * Whether this server supports issuing notifications for changes to the resource list.
     */
    listChanged: boolean2().optional()
  }).optional(),
  /**
   * Present if the server offers any tools to call.
   */
  tools: object2({
    /**
     * Whether this server supports issuing notifications for changes to the tool list.
     */
    listChanged: boolean2().optional()
  }).optional(),
  /**
   * Present if the server supports task creation.
   */
  tasks: ServerTasksCapabilitySchema.optional(),
  /**
   * Extensions that the server supports. Keys are extension identifiers (vendor-prefix/extension-name).
   */
  extensions: record(string2(), AssertObjectSchema).optional()
});
var InitializeResultSchema = ResultSchema.extend({
  /**
   * The version of the Model Context Protocol that the server wants to use. This may not match the version that the client requested. If the client cannot support this version, it MUST disconnect.
   */
  protocolVersion: string2(),
  capabilities: ServerCapabilitiesSchema,
  serverInfo: ImplementationSchema,
  /**
   * Instructions describing how to use the server and its features.
   *
   * This can be used by clients to improve the LLM's understanding of available tools, resources, etc. It can be thought of like a "hint" to the model. For example, this information MAY be added to the system prompt.
   */
  instructions: string2().optional()
});
var InitializedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/initialized"),
  params: NotificationsParamsSchema.optional()
});
var PingRequestSchema = RequestSchema.extend({
  method: literal("ping"),
  params: BaseRequestParamsSchema.optional()
});
var ProgressSchema = object2({
  /**
   * The progress thus far. This should increase every time progress is made, even if the total is unknown.
   */
  progress: number2(),
  /**
   * Total number of items to process (or total progress required), if known.
   */
  total: optional(number2()),
  /**
   * An optional message describing the current progress.
   */
  message: optional(string2())
});
var ProgressNotificationParamsSchema = object2({
  ...NotificationsParamsSchema.shape,
  ...ProgressSchema.shape,
  /**
   * The progress token which was given in the initial request, used to associate this notification with the request that is proceeding.
   */
  progressToken: ProgressTokenSchema
});
var ProgressNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/progress"),
  params: ProgressNotificationParamsSchema
});
var PaginatedRequestParamsSchema = BaseRequestParamsSchema.extend({
  /**
   * An opaque token representing the current pagination position.
   * If provided, the server should return results starting after this cursor.
   */
  cursor: CursorSchema.optional()
});
var PaginatedRequestSchema = RequestSchema.extend({
  params: PaginatedRequestParamsSchema.optional()
});
var PaginatedResultSchema = ResultSchema.extend({
  /**
   * An opaque token representing the pagination position after the last returned result.
   * If present, there may be more results available.
   */
  nextCursor: CursorSchema.optional()
});
var TaskStatusSchema = _enum(["working", "input_required", "completed", "failed", "cancelled"]);
var TaskSchema = object2({
  taskId: string2(),
  status: TaskStatusSchema,
  /**
   * Time in milliseconds to keep task results available after completion.
   * If null, the task has unlimited lifetime until manually cleaned up.
   */
  ttl: union([number2(), _null3()]),
  /**
   * ISO 8601 timestamp when the task was created.
   */
  createdAt: string2(),
  /**
   * ISO 8601 timestamp when the task was last updated.
   */
  lastUpdatedAt: string2(),
  pollInterval: optional(number2()),
  /**
   * Optional diagnostic message for failed tasks or other status information.
   */
  statusMessage: optional(string2())
});
var CreateTaskResultSchema = ResultSchema.extend({
  task: TaskSchema
});
var TaskStatusNotificationParamsSchema = NotificationsParamsSchema.merge(TaskSchema);
var TaskStatusNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/tasks/status"),
  params: TaskStatusNotificationParamsSchema
});
var GetTaskRequestSchema = RequestSchema.extend({
  method: literal("tasks/get"),
  params: BaseRequestParamsSchema.extend({
    taskId: string2()
  })
});
var GetTaskResultSchema = ResultSchema.merge(TaskSchema);
var GetTaskPayloadRequestSchema = RequestSchema.extend({
  method: literal("tasks/result"),
  params: BaseRequestParamsSchema.extend({
    taskId: string2()
  })
});
var GetTaskPayloadResultSchema = ResultSchema.loose();
var ListTasksRequestSchema = PaginatedRequestSchema.extend({
  method: literal("tasks/list")
});
var ListTasksResultSchema = PaginatedResultSchema.extend({
  tasks: array(TaskSchema)
});
var CancelTaskRequestSchema = RequestSchema.extend({
  method: literal("tasks/cancel"),
  params: BaseRequestParamsSchema.extend({
    taskId: string2()
  })
});
var CancelTaskResultSchema = ResultSchema.merge(TaskSchema);
var ResourceContentsSchema = object2({
  /**
   * The URI of this resource.
   */
  uri: string2(),
  /**
   * The MIME type of this resource, if known.
   */
  mimeType: optional(string2()),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var TextResourceContentsSchema = ResourceContentsSchema.extend({
  /**
   * The text of the item. This must only be set if the item can actually be represented as text (not binary data).
   */
  text: string2()
});
var Base64Schema = string2().refine((val) => {
  try {
    atob(val);
    return true;
  } catch {
    return false;
  }
}, { message: "Invalid Base64 string" });
var BlobResourceContentsSchema = ResourceContentsSchema.extend({
  /**
   * A base64-encoded string representing the binary data of the item.
   */
  blob: Base64Schema
});
var RoleSchema = _enum(["user", "assistant"]);
var AnnotationsSchema = object2({
  /**
   * Intended audience(s) for the resource.
   */
  audience: array(RoleSchema).optional(),
  /**
   * Importance hint for the resource, from 0 (least) to 1 (most).
   */
  priority: number2().min(0).max(1).optional(),
  /**
   * ISO 8601 timestamp for the most recent modification.
   */
  lastModified: iso_exports.datetime({ offset: true }).optional()
});
var ResourceSchema = object2({
  ...BaseMetadataSchema.shape,
  ...IconsSchema.shape,
  /**
   * The URI of this resource.
   */
  uri: string2(),
  /**
   * A description of what this resource represents.
   *
   * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
   */
  description: optional(string2()),
  /**
   * The MIME type of this resource, if known.
   */
  mimeType: optional(string2()),
  /**
   * The size of the raw resource content, in bytes (i.e., before base64 encoding or any tokenization), if known.
   *
   * This can be used by Hosts to display file sizes and estimate context window usage.
   */
  size: optional(number2()),
  /**
   * Optional annotations for the client.
   */
  annotations: AnnotationsSchema.optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: optional(looseObject({}))
});
var ResourceTemplateSchema = object2({
  ...BaseMetadataSchema.shape,
  ...IconsSchema.shape,
  /**
   * A URI template (according to RFC 6570) that can be used to construct resource URIs.
   */
  uriTemplate: string2(),
  /**
   * A description of what this template is for.
   *
   * This can be used by clients to improve the LLM's understanding of available resources. It can be thought of like a "hint" to the model.
   */
  description: optional(string2()),
  /**
   * The MIME type for all resources that match this template. This should only be included if all resources matching this template have the same type.
   */
  mimeType: optional(string2()),
  /**
   * Optional annotations for the client.
   */
  annotations: AnnotationsSchema.optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: optional(looseObject({}))
});
var ListResourcesRequestSchema = PaginatedRequestSchema.extend({
  method: literal("resources/list")
});
var ListResourcesResultSchema = PaginatedResultSchema.extend({
  resources: array(ResourceSchema)
});
var ListResourceTemplatesRequestSchema = PaginatedRequestSchema.extend({
  method: literal("resources/templates/list")
});
var ListResourceTemplatesResultSchema = PaginatedResultSchema.extend({
  resourceTemplates: array(ResourceTemplateSchema)
});
var ResourceRequestParamsSchema = BaseRequestParamsSchema.extend({
  /**
   * The URI of the resource to read. The URI can use any protocol; it is up to the server how to interpret it.
   *
   * @format uri
   */
  uri: string2()
});
var ReadResourceRequestParamsSchema = ResourceRequestParamsSchema;
var ReadResourceRequestSchema = RequestSchema.extend({
  method: literal("resources/read"),
  params: ReadResourceRequestParamsSchema
});
var ReadResourceResultSchema = ResultSchema.extend({
  contents: array(union([TextResourceContentsSchema, BlobResourceContentsSchema]))
});
var ResourceListChangedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/resources/list_changed"),
  params: NotificationsParamsSchema.optional()
});
var SubscribeRequestParamsSchema = ResourceRequestParamsSchema;
var SubscribeRequestSchema = RequestSchema.extend({
  method: literal("resources/subscribe"),
  params: SubscribeRequestParamsSchema
});
var UnsubscribeRequestParamsSchema = ResourceRequestParamsSchema;
var UnsubscribeRequestSchema = RequestSchema.extend({
  method: literal("resources/unsubscribe"),
  params: UnsubscribeRequestParamsSchema
});
var ResourceUpdatedNotificationParamsSchema = NotificationsParamsSchema.extend({
  /**
   * The URI of the resource that has been updated. This might be a sub-resource of the one that the client actually subscribed to.
   */
  uri: string2()
});
var ResourceUpdatedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/resources/updated"),
  params: ResourceUpdatedNotificationParamsSchema
});
var PromptArgumentSchema = object2({
  /**
   * The name of the argument.
   */
  name: string2(),
  /**
   * A human-readable description of the argument.
   */
  description: optional(string2()),
  /**
   * Whether this argument must be provided.
   */
  required: optional(boolean2())
});
var PromptSchema = object2({
  ...BaseMetadataSchema.shape,
  ...IconsSchema.shape,
  /**
   * An optional description of what this prompt provides
   */
  description: optional(string2()),
  /**
   * A list of arguments to use for templating the prompt.
   */
  arguments: optional(array(PromptArgumentSchema)),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: optional(looseObject({}))
});
var ListPromptsRequestSchema = PaginatedRequestSchema.extend({
  method: literal("prompts/list")
});
var ListPromptsResultSchema = PaginatedResultSchema.extend({
  prompts: array(PromptSchema)
});
var GetPromptRequestParamsSchema = BaseRequestParamsSchema.extend({
  /**
   * The name of the prompt or prompt template.
   */
  name: string2(),
  /**
   * Arguments to use for templating the prompt.
   */
  arguments: record(string2(), string2()).optional()
});
var GetPromptRequestSchema = RequestSchema.extend({
  method: literal("prompts/get"),
  params: GetPromptRequestParamsSchema
});
var TextContentSchema = object2({
  type: literal("text"),
  /**
   * The text content of the message.
   */
  text: string2(),
  /**
   * Optional annotations for the client.
   */
  annotations: AnnotationsSchema.optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var ImageContentSchema = object2({
  type: literal("image"),
  /**
   * The base64-encoded image data.
   */
  data: Base64Schema,
  /**
   * The MIME type of the image. Different providers may support different image types.
   */
  mimeType: string2(),
  /**
   * Optional annotations for the client.
   */
  annotations: AnnotationsSchema.optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var AudioContentSchema = object2({
  type: literal("audio"),
  /**
   * The base64-encoded audio data.
   */
  data: Base64Schema,
  /**
   * The MIME type of the audio. Different providers may support different audio types.
   */
  mimeType: string2(),
  /**
   * Optional annotations for the client.
   */
  annotations: AnnotationsSchema.optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var ToolUseContentSchema = object2({
  type: literal("tool_use"),
  /**
   * The name of the tool to invoke.
   * Must match a tool name from the request's tools array.
   */
  name: string2(),
  /**
   * Unique identifier for this tool call.
   * Used to correlate with ToolResultContent in subsequent messages.
   */
  id: string2(),
  /**
   * Arguments to pass to the tool.
   * Must conform to the tool's inputSchema.
   */
  input: record(string2(), unknown()),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var EmbeddedResourceSchema = object2({
  type: literal("resource"),
  resource: union([TextResourceContentsSchema, BlobResourceContentsSchema]),
  /**
   * Optional annotations for the client.
   */
  annotations: AnnotationsSchema.optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var ResourceLinkSchema = ResourceSchema.extend({
  type: literal("resource_link")
});
var ContentBlockSchema = union([
  TextContentSchema,
  ImageContentSchema,
  AudioContentSchema,
  ResourceLinkSchema,
  EmbeddedResourceSchema
]);
var PromptMessageSchema = object2({
  role: RoleSchema,
  content: ContentBlockSchema
});
var GetPromptResultSchema = ResultSchema.extend({
  /**
   * An optional description for the prompt.
   */
  description: string2().optional(),
  messages: array(PromptMessageSchema)
});
var PromptListChangedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/prompts/list_changed"),
  params: NotificationsParamsSchema.optional()
});
var ToolAnnotationsSchema = object2({
  /**
   * A human-readable title for the tool.
   */
  title: string2().optional(),
  /**
   * If true, the tool does not modify its environment.
   *
   * Default: false
   */
  readOnlyHint: boolean2().optional(),
  /**
   * If true, the tool may perform destructive updates to its environment.
   * If false, the tool performs only additive updates.
   *
   * (This property is meaningful only when `readOnlyHint == false`)
   *
   * Default: true
   */
  destructiveHint: boolean2().optional(),
  /**
   * If true, calling the tool repeatedly with the same arguments
   * will have no additional effect on the its environment.
   *
   * (This property is meaningful only when `readOnlyHint == false`)
   *
   * Default: false
   */
  idempotentHint: boolean2().optional(),
  /**
   * If true, this tool may interact with an "open world" of external
   * entities. If false, the tool's domain of interaction is closed.
   * For example, the world of a web search tool is open, whereas that
   * of a memory tool is not.
   *
   * Default: true
   */
  openWorldHint: boolean2().optional()
});
var ToolExecutionSchema = object2({
  /**
   * Indicates the tool's preference for task-augmented execution.
   * - "required": Clients MUST invoke the tool as a task
   * - "optional": Clients MAY invoke the tool as a task or normal request
   * - "forbidden": Clients MUST NOT attempt to invoke the tool as a task
   *
   * If not present, defaults to "forbidden".
   */
  taskSupport: _enum(["required", "optional", "forbidden"]).optional()
});
var ToolSchema = object2({
  ...BaseMetadataSchema.shape,
  ...IconsSchema.shape,
  /**
   * A human-readable description of the tool.
   */
  description: string2().optional(),
  /**
   * A JSON Schema 2020-12 object defining the expected parameters for the tool.
   * Must have type: 'object' at the root level per MCP spec.
   */
  inputSchema: object2({
    type: literal("object"),
    properties: record(string2(), AssertObjectSchema).optional(),
    required: array(string2()).optional()
  }).catchall(unknown()),
  /**
   * An optional JSON Schema 2020-12 object defining the structure of the tool's output
   * returned in the structuredContent field of a CallToolResult.
   * Must have type: 'object' at the root level per MCP spec.
   */
  outputSchema: object2({
    type: literal("object"),
    properties: record(string2(), AssertObjectSchema).optional(),
    required: array(string2()).optional()
  }).catchall(unknown()).optional(),
  /**
   * Optional additional tool information.
   */
  annotations: ToolAnnotationsSchema.optional(),
  /**
   * Execution-related properties for this tool.
   */
  execution: ToolExecutionSchema.optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var ListToolsRequestSchema = PaginatedRequestSchema.extend({
  method: literal("tools/list")
});
var ListToolsResultSchema = PaginatedResultSchema.extend({
  tools: array(ToolSchema)
});
var CallToolResultSchema = ResultSchema.extend({
  /**
   * A list of content objects that represent the result of the tool call.
   *
   * If the Tool does not define an outputSchema, this field MUST be present in the result.
   * For backwards compatibility, this field is always present, but it may be empty.
   */
  content: array(ContentBlockSchema).default([]),
  /**
   * An object containing structured tool output.
   *
   * If the Tool defines an outputSchema, this field MUST be present in the result, and contain a JSON object that matches the schema.
   */
  structuredContent: record(string2(), unknown()).optional(),
  /**
   * Whether the tool call ended in an error.
   *
   * If not set, this is assumed to be false (the call was successful).
   *
   * Any errors that originate from the tool SHOULD be reported inside the result
   * object, with `isError` set to true, _not_ as an MCP protocol-level error
   * response. Otherwise, the LLM would not be able to see that an error occurred
   * and self-correct.
   *
   * However, any errors in _finding_ the tool, an error indicating that the
   * server does not support tool calls, or any other exceptional conditions,
   * should be reported as an MCP error response.
   */
  isError: boolean2().optional()
});
var CompatibilityCallToolResultSchema = CallToolResultSchema.or(ResultSchema.extend({
  toolResult: unknown()
}));
var CallToolRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
  /**
   * The name of the tool to call.
   */
  name: string2(),
  /**
   * Arguments to pass to the tool.
   */
  arguments: record(string2(), unknown()).optional()
});
var CallToolRequestSchema = RequestSchema.extend({
  method: literal("tools/call"),
  params: CallToolRequestParamsSchema
});
var ToolListChangedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/tools/list_changed"),
  params: NotificationsParamsSchema.optional()
});
var ListChangedOptionsBaseSchema = object2({
  /**
   * If true, the list will be refreshed automatically when a list changed notification is received.
   * The callback will be called with the updated list.
   *
   * If false, the callback will be called with null items, allowing manual refresh.
   *
   * @default true
   */
  autoRefresh: boolean2().default(true),
  /**
   * Debounce time in milliseconds for list changed notification processing.
   *
   * Multiple notifications received within this timeframe will only trigger one refresh.
   * Set to 0 to disable debouncing.
   *
   * @default 300
   */
  debounceMs: number2().int().nonnegative().default(300)
});
var LoggingLevelSchema = _enum(["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"]);
var SetLevelRequestParamsSchema = BaseRequestParamsSchema.extend({
  /**
   * The level of logging that the client wants to receive from the server. The server should send all logs at this level and higher (i.e., more severe) to the client as notifications/logging/message.
   */
  level: LoggingLevelSchema
});
var SetLevelRequestSchema = RequestSchema.extend({
  method: literal("logging/setLevel"),
  params: SetLevelRequestParamsSchema
});
var LoggingMessageNotificationParamsSchema = NotificationsParamsSchema.extend({
  /**
   * The severity of this log message.
   */
  level: LoggingLevelSchema,
  /**
   * An optional name of the logger issuing this message.
   */
  logger: string2().optional(),
  /**
   * The data to be logged, such as a string message or an object. Any JSON serializable type is allowed here.
   */
  data: unknown()
});
var LoggingMessageNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/message"),
  params: LoggingMessageNotificationParamsSchema
});
var ModelHintSchema = object2({
  /**
   * A hint for a model name.
   */
  name: string2().optional()
});
var ModelPreferencesSchema = object2({
  /**
   * Optional hints to use for model selection.
   */
  hints: array(ModelHintSchema).optional(),
  /**
   * How much to prioritize cost when selecting a model.
   */
  costPriority: number2().min(0).max(1).optional(),
  /**
   * How much to prioritize sampling speed (latency) when selecting a model.
   */
  speedPriority: number2().min(0).max(1).optional(),
  /**
   * How much to prioritize intelligence and capabilities when selecting a model.
   */
  intelligencePriority: number2().min(0).max(1).optional()
});
var ToolChoiceSchema = object2({
  /**
   * Controls when tools are used:
   * - "auto": Model decides whether to use tools (default)
   * - "required": Model MUST use at least one tool before completing
   * - "none": Model MUST NOT use any tools
   */
  mode: _enum(["auto", "required", "none"]).optional()
});
var ToolResultContentSchema = object2({
  type: literal("tool_result"),
  toolUseId: string2().describe("The unique identifier for the corresponding tool call."),
  content: array(ContentBlockSchema).default([]),
  structuredContent: object2({}).loose().optional(),
  isError: boolean2().optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var SamplingContentSchema = discriminatedUnion("type", [TextContentSchema, ImageContentSchema, AudioContentSchema]);
var SamplingMessageContentBlockSchema = discriminatedUnion("type", [
  TextContentSchema,
  ImageContentSchema,
  AudioContentSchema,
  ToolUseContentSchema,
  ToolResultContentSchema
]);
var SamplingMessageSchema = object2({
  role: RoleSchema,
  content: union([SamplingMessageContentBlockSchema, array(SamplingMessageContentBlockSchema)]),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var CreateMessageRequestParamsSchema = TaskAugmentedRequestParamsSchema.extend({
  messages: array(SamplingMessageSchema),
  /**
   * The server's preferences for which model to select. The client MAY modify or omit this request.
   */
  modelPreferences: ModelPreferencesSchema.optional(),
  /**
   * An optional system prompt the server wants to use for sampling. The client MAY modify or omit this prompt.
   */
  systemPrompt: string2().optional(),
  /**
   * A request to include context from one or more MCP servers (including the caller), to be attached to the prompt.
   * The client MAY ignore this request.
   *
   * Default is "none". Values "thisServer" and "allServers" are soft-deprecated. Servers SHOULD only use these values if the client
   * declares ClientCapabilities.sampling.context. These values may be removed in future spec releases.
   */
  includeContext: _enum(["none", "thisServer", "allServers"]).optional(),
  temperature: number2().optional(),
  /**
   * The requested maximum number of tokens to sample (to prevent runaway completions).
   *
   * The client MAY choose to sample fewer tokens than the requested maximum.
   */
  maxTokens: number2().int(),
  stopSequences: array(string2()).optional(),
  /**
   * Optional metadata to pass through to the LLM provider. The format of this metadata is provider-specific.
   */
  metadata: AssertObjectSchema.optional(),
  /**
   * Tools that the model may use during generation.
   * The client MUST return an error if this field is provided but ClientCapabilities.sampling.tools is not declared.
   */
  tools: array(ToolSchema).optional(),
  /**
   * Controls how the model uses tools.
   * The client MUST return an error if this field is provided but ClientCapabilities.sampling.tools is not declared.
   * Default is `{ mode: "auto" }`.
   */
  toolChoice: ToolChoiceSchema.optional()
});
var CreateMessageRequestSchema = RequestSchema.extend({
  method: literal("sampling/createMessage"),
  params: CreateMessageRequestParamsSchema
});
var CreateMessageResultSchema = ResultSchema.extend({
  /**
   * The name of the model that generated the message.
   */
  model: string2(),
  /**
   * The reason why sampling stopped, if known.
   *
   * Standard values:
   * - "endTurn": Natural end of the assistant's turn
   * - "stopSequence": A stop sequence was encountered
   * - "maxTokens": Maximum token limit was reached
   *
   * This field is an open string to allow for provider-specific stop reasons.
   */
  stopReason: optional(_enum(["endTurn", "stopSequence", "maxTokens"]).or(string2())),
  role: RoleSchema,
  /**
   * Response content. Single content block (text, image, or audio).
   */
  content: SamplingContentSchema
});
var CreateMessageResultWithToolsSchema = ResultSchema.extend({
  /**
   * The name of the model that generated the message.
   */
  model: string2(),
  /**
   * The reason why sampling stopped, if known.
   *
   * Standard values:
   * - "endTurn": Natural end of the assistant's turn
   * - "stopSequence": A stop sequence was encountered
   * - "maxTokens": Maximum token limit was reached
   * - "toolUse": The model wants to use one or more tools
   *
   * This field is an open string to allow for provider-specific stop reasons.
   */
  stopReason: optional(_enum(["endTurn", "stopSequence", "maxTokens", "toolUse"]).or(string2())),
  role: RoleSchema,
  /**
   * Response content. May be a single block or array. May include ToolUseContent if stopReason is "toolUse".
   */
  content: union([SamplingMessageContentBlockSchema, array(SamplingMessageContentBlockSchema)])
});
var BooleanSchemaSchema = object2({
  type: literal("boolean"),
  title: string2().optional(),
  description: string2().optional(),
  default: boolean2().optional()
});
var StringSchemaSchema = object2({
  type: literal("string"),
  title: string2().optional(),
  description: string2().optional(),
  minLength: number2().optional(),
  maxLength: number2().optional(),
  format: _enum(["email", "uri", "date", "date-time"]).optional(),
  default: string2().optional()
});
var NumberSchemaSchema = object2({
  type: _enum(["number", "integer"]),
  title: string2().optional(),
  description: string2().optional(),
  minimum: number2().optional(),
  maximum: number2().optional(),
  default: number2().optional()
});
var UntitledSingleSelectEnumSchemaSchema = object2({
  type: literal("string"),
  title: string2().optional(),
  description: string2().optional(),
  enum: array(string2()),
  default: string2().optional()
});
var TitledSingleSelectEnumSchemaSchema = object2({
  type: literal("string"),
  title: string2().optional(),
  description: string2().optional(),
  oneOf: array(object2({
    const: string2(),
    title: string2()
  })),
  default: string2().optional()
});
var LegacyTitledEnumSchemaSchema = object2({
  type: literal("string"),
  title: string2().optional(),
  description: string2().optional(),
  enum: array(string2()),
  enumNames: array(string2()).optional(),
  default: string2().optional()
});
var SingleSelectEnumSchemaSchema = union([UntitledSingleSelectEnumSchemaSchema, TitledSingleSelectEnumSchemaSchema]);
var UntitledMultiSelectEnumSchemaSchema = object2({
  type: literal("array"),
  title: string2().optional(),
  description: string2().optional(),
  minItems: number2().optional(),
  maxItems: number2().optional(),
  items: object2({
    type: literal("string"),
    enum: array(string2())
  }),
  default: array(string2()).optional()
});
var TitledMultiSelectEnumSchemaSchema = object2({
  type: literal("array"),
  title: string2().optional(),
  description: string2().optional(),
  minItems: number2().optional(),
  maxItems: number2().optional(),
  items: object2({
    anyOf: array(object2({
      const: string2(),
      title: string2()
    }))
  }),
  default: array(string2()).optional()
});
var MultiSelectEnumSchemaSchema = union([UntitledMultiSelectEnumSchemaSchema, TitledMultiSelectEnumSchemaSchema]);
var EnumSchemaSchema = union([LegacyTitledEnumSchemaSchema, SingleSelectEnumSchemaSchema, MultiSelectEnumSchemaSchema]);
var PrimitiveSchemaDefinitionSchema = union([EnumSchemaSchema, BooleanSchemaSchema, StringSchemaSchema, NumberSchemaSchema]);
var ElicitRequestFormParamsSchema = TaskAugmentedRequestParamsSchema.extend({
  /**
   * The elicitation mode.
   *
   * Optional for backward compatibility. Clients MUST treat missing mode as "form".
   */
  mode: literal("form").optional(),
  /**
   * The message to present to the user describing what information is being requested.
   */
  message: string2(),
  /**
   * A restricted subset of JSON Schema.
   * Only top-level properties are allowed, without nesting.
   */
  requestedSchema: object2({
    type: literal("object"),
    properties: record(string2(), PrimitiveSchemaDefinitionSchema),
    required: array(string2()).optional()
  })
});
var ElicitRequestURLParamsSchema = TaskAugmentedRequestParamsSchema.extend({
  /**
   * The elicitation mode.
   */
  mode: literal("url"),
  /**
   * The message to present to the user explaining why the interaction is needed.
   */
  message: string2(),
  /**
   * The ID of the elicitation, which must be unique within the context of the server.
   * The client MUST treat this ID as an opaque value.
   */
  elicitationId: string2(),
  /**
   * The URL that the user should navigate to.
   */
  url: string2().url()
});
var ElicitRequestParamsSchema = union([ElicitRequestFormParamsSchema, ElicitRequestURLParamsSchema]);
var ElicitRequestSchema = RequestSchema.extend({
  method: literal("elicitation/create"),
  params: ElicitRequestParamsSchema
});
var ElicitationCompleteNotificationParamsSchema = NotificationsParamsSchema.extend({
  /**
   * The ID of the elicitation that completed.
   */
  elicitationId: string2()
});
var ElicitationCompleteNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/elicitation/complete"),
  params: ElicitationCompleteNotificationParamsSchema
});
var ElicitResultSchema = ResultSchema.extend({
  /**
   * The user action in response to the elicitation.
   * - "accept": User submitted the form/confirmed the action
   * - "decline": User explicitly decline the action
   * - "cancel": User dismissed without making an explicit choice
   */
  action: _enum(["accept", "decline", "cancel"]),
  /**
   * The submitted form data, only present when action is "accept".
   * Contains values matching the requested schema.
   * Per MCP spec, content is "typically omitted" for decline/cancel actions.
   * We normalize null to undefined for leniency while maintaining type compatibility.
   */
  content: preprocess((val) => val === null ? void 0 : val, record(string2(), union([string2(), number2(), boolean2(), array(string2())])).optional())
});
var ResourceTemplateReferenceSchema = object2({
  type: literal("ref/resource"),
  /**
   * The URI or URI template of the resource.
   */
  uri: string2()
});
var PromptReferenceSchema = object2({
  type: literal("ref/prompt"),
  /**
   * The name of the prompt or prompt template
   */
  name: string2()
});
var CompleteRequestParamsSchema = BaseRequestParamsSchema.extend({
  ref: union([PromptReferenceSchema, ResourceTemplateReferenceSchema]),
  /**
   * The argument's information
   */
  argument: object2({
    /**
     * The name of the argument
     */
    name: string2(),
    /**
     * The value of the argument to use for completion matching.
     */
    value: string2()
  }),
  context: object2({
    /**
     * Previously-resolved variables in a URI template or prompt.
     */
    arguments: record(string2(), string2()).optional()
  }).optional()
});
var CompleteRequestSchema = RequestSchema.extend({
  method: literal("completion/complete"),
  params: CompleteRequestParamsSchema
});
var CompleteResultSchema = ResultSchema.extend({
  completion: looseObject({
    /**
     * An array of completion values. Must not exceed 100 items.
     */
    values: array(string2()).max(100),
    /**
     * The total number of completion options available. This can exceed the number of values actually sent in the response.
     */
    total: optional(number2().int()),
    /**
     * Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown.
     */
    hasMore: optional(boolean2())
  })
});
var RootSchema = object2({
  /**
   * The URI identifying the root. This *must* start with file:// for now.
   */
  uri: string2().startsWith("file://"),
  /**
   * An optional name for the root.
   */
  name: string2().optional(),
  /**
   * See [MCP specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/47339c03c143bb4ec01a26e721a1b8fe66634ebe/docs/specification/draft/basic/index.mdx#general-fields)
   * for notes on _meta usage.
   */
  _meta: record(string2(), unknown()).optional()
});
var ListRootsRequestSchema = RequestSchema.extend({
  method: literal("roots/list"),
  params: BaseRequestParamsSchema.optional()
});
var ListRootsResultSchema = ResultSchema.extend({
  roots: array(RootSchema)
});
var RootsListChangedNotificationSchema = NotificationSchema.extend({
  method: literal("notifications/roots/list_changed"),
  params: NotificationsParamsSchema.optional()
});
var ClientRequestSchema = union([
  PingRequestSchema,
  InitializeRequestSchema,
  CompleteRequestSchema,
  SetLevelRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  CallToolRequestSchema,
  ListToolsRequestSchema,
  GetTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  ListTasksRequestSchema,
  CancelTaskRequestSchema
]);
var ClientNotificationSchema = union([
  CancelledNotificationSchema,
  ProgressNotificationSchema,
  InitializedNotificationSchema,
  RootsListChangedNotificationSchema,
  TaskStatusNotificationSchema
]);
var ClientResultSchema = union([
  EmptyResultSchema,
  CreateMessageResultSchema,
  CreateMessageResultWithToolsSchema,
  ElicitResultSchema,
  ListRootsResultSchema,
  GetTaskResultSchema,
  ListTasksResultSchema,
  CreateTaskResultSchema
]);
var ServerRequestSchema = union([
  PingRequestSchema,
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
  GetTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  ListTasksRequestSchema,
  CancelTaskRequestSchema
]);
var ServerNotificationSchema = union([
  CancelledNotificationSchema,
  ProgressNotificationSchema,
  LoggingMessageNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  TaskStatusNotificationSchema,
  ElicitationCompleteNotificationSchema
]);
var ServerResultSchema = union([
  EmptyResultSchema,
  InitializeResultSchema,
  CompleteResultSchema,
  GetPromptResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ReadResourceResultSchema,
  CallToolResultSchema,
  ListToolsResultSchema,
  GetTaskResultSchema,
  ListTasksResultSchema,
  CreateTaskResultSchema
]);
var McpError = class _McpError extends Error {
  constructor(code, message, data) {
    super(`MCP error ${code}: ${message}`);
    this.code = code;
    this.data = data;
    this.name = "McpError";
  }
  /**
   * Factory method to create the appropriate error type based on the error code and data
   */
  static fromError(code, message, data) {
    if (code === ErrorCode.UrlElicitationRequired && data) {
      const errorData = data;
      if (errorData.elicitations) {
        return new UrlElicitationRequiredError(errorData.elicitations, message);
      }
    }
    return new _McpError(code, message, data);
  }
};
var UrlElicitationRequiredError = class extends McpError {
  constructor(elicitations, message = `URL elicitation${elicitations.length > 1 ? "s" : ""} required`) {
    super(ErrorCode.UrlElicitationRequired, message, {
      elicitations
    });
  }
  get elicitations() {
    return this.data?.elicitations ?? [];
  }
};

// node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/interfaces.js
function isTerminal(status) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

// node_modules/zod-to-json-schema/dist/esm/Options.js
var ignoreOverride = Symbol("Let zodToJsonSchema decide on which parser to use");

// node_modules/zod-to-json-schema/dist/esm/parsers/string.js
var ALPHA_NUMERIC = new Set("ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvxyz0123456789");

// node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-json-schema-compat.js
function getMethodLiteral(schema) {
  const shape = getObjectShape(schema);
  const methodSchema = shape?.method;
  if (!methodSchema) {
    throw new Error("Schema is missing a method literal");
  }
  const value = getLiteralValue(methodSchema);
  if (typeof value !== "string") {
    throw new Error("Schema method literal must be a string");
  }
  return value;
}
function parseWithCompat(schema, data) {
  const result = safeParse2(schema, data);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

// node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js
var DEFAULT_REQUEST_TIMEOUT_MSEC = 6e4;
var Protocol = class {
  constructor(_options) {
    this._options = _options;
    this._requestMessageId = 0;
    this._requestHandlers = /* @__PURE__ */ new Map();
    this._requestHandlerAbortControllers = /* @__PURE__ */ new Map();
    this._notificationHandlers = /* @__PURE__ */ new Map();
    this._responseHandlers = /* @__PURE__ */ new Map();
    this._progressHandlers = /* @__PURE__ */ new Map();
    this._timeoutInfo = /* @__PURE__ */ new Map();
    this._pendingDebouncedNotifications = /* @__PURE__ */ new Set();
    this._taskProgressTokens = /* @__PURE__ */ new Map();
    this._requestResolvers = /* @__PURE__ */ new Map();
    this.setNotificationHandler(CancelledNotificationSchema, (notification) => {
      this._oncancel(notification);
    });
    this.setNotificationHandler(ProgressNotificationSchema, (notification) => {
      this._onprogress(notification);
    });
    this.setRequestHandler(
      PingRequestSchema,
      // Automatic pong by default.
      (_request) => ({})
    );
    this._taskStore = _options?.taskStore;
    this._taskMessageQueue = _options?.taskMessageQueue;
    if (this._taskStore) {
      this.setRequestHandler(GetTaskRequestSchema, async (request, extra) => {
        const task = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
        if (!task) {
          throw new McpError(ErrorCode.InvalidParams, "Failed to retrieve task: Task not found");
        }
        return {
          ...task
        };
      });
      this.setRequestHandler(GetTaskPayloadRequestSchema, async (request, extra) => {
        const handleTaskResult = async () => {
          const taskId = request.params.taskId;
          if (!await this._taskStore.getTask(taskId, extra.sessionId)) {
            throw new McpError(ErrorCode.InvalidParams, `Task not found: ${taskId}`);
          }
          if (this._taskMessageQueue) {
            let queuedMessage;
            while (queuedMessage = await this._taskMessageQueue.dequeue(taskId, extra.sessionId)) {
              if (queuedMessage.type === "response" || queuedMessage.type === "error") {
                const message = queuedMessage.message;
                const requestId = message.id;
                const resolver = this._requestResolvers.get(requestId);
                if (resolver) {
                  this._requestResolvers.delete(requestId);
                  if (queuedMessage.type === "response") {
                    resolver(message);
                  } else {
                    const errorMessage2 = message;
                    const error2 = new McpError(errorMessage2.error.code, errorMessage2.error.message, errorMessage2.error.data);
                    resolver(error2);
                  }
                } else {
                  const messageType = queuedMessage.type === "response" ? "Response" : "Error";
                  this._onerror(new Error(`${messageType} handler missing for request ${requestId}`));
                }
                continue;
              }
              await this._transport?.send(queuedMessage.message, { relatedRequestId: extra.requestId });
            }
          }
          const task = await this._taskStore.getTask(taskId, extra.sessionId);
          if (!task) {
            throw new McpError(ErrorCode.InvalidParams, `Task not found: ${taskId}`);
          }
          if (!isTerminal(task.status)) {
            await this._waitForTaskUpdate(taskId, extra.signal, extra.sessionId);
            return await handleTaskResult();
          }
          if (isTerminal(task.status)) {
            const result = await this._taskStore.getTaskResult(taskId, extra.sessionId);
            this._clearTaskQueue(taskId, extra.sessionId);
            return {
              ...result,
              _meta: {
                ...result._meta,
                [RELATED_TASK_META_KEY]: {
                  taskId
                }
              }
            };
          }
          return await handleTaskResult();
        };
        return await handleTaskResult();
      });
      this.setRequestHandler(ListTasksRequestSchema, async (request, extra) => {
        try {
          const { tasks, nextCursor } = await this._taskStore.listTasks(request.params?.cursor, extra.sessionId);
          return {
            tasks,
            nextCursor,
            _meta: {}
          };
        } catch (error2) {
          throw new McpError(ErrorCode.InvalidParams, `Failed to list tasks: ${error2 instanceof Error ? error2.message : String(error2)}`);
        }
      });
      this.setRequestHandler(CancelTaskRequestSchema, async (request, extra) => {
        try {
          const task = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
          if (!task) {
            throw new McpError(ErrorCode.InvalidParams, `Task not found: ${request.params.taskId}`);
          }
          if (isTerminal(task.status)) {
            throw new McpError(ErrorCode.InvalidParams, `Cannot cancel task in terminal status: ${task.status}`);
          }
          await this._taskStore.updateTaskStatus(request.params.taskId, "cancelled", "Client cancelled task execution.", extra.sessionId);
          this._clearTaskQueue(request.params.taskId, extra.sessionId);
          const cancelledTask = await this._taskStore.getTask(request.params.taskId, extra.sessionId);
          if (!cancelledTask) {
            throw new McpError(ErrorCode.InvalidParams, `Task not found after cancellation: ${request.params.taskId}`);
          }
          return {
            _meta: {},
            ...cancelledTask
          };
        } catch (error2) {
          if (error2 instanceof McpError) {
            throw error2;
          }
          throw new McpError(ErrorCode.InvalidRequest, `Failed to cancel task: ${error2 instanceof Error ? error2.message : String(error2)}`);
        }
      });
    }
  }
  async _oncancel(notification) {
    if (!notification.params.requestId) {
      return;
    }
    const controller = this._requestHandlerAbortControllers.get(notification.params.requestId);
    controller?.abort(notification.params.reason);
  }
  _setupTimeout(messageId, timeout, maxTotalTimeout, onTimeout, resetTimeoutOnProgress = false) {
    this._timeoutInfo.set(messageId, {
      timeoutId: setTimeout(onTimeout, timeout),
      startTime: Date.now(),
      timeout,
      maxTotalTimeout,
      resetTimeoutOnProgress,
      onTimeout
    });
  }
  _resetTimeout(messageId) {
    const info = this._timeoutInfo.get(messageId);
    if (!info)
      return false;
    const totalElapsed = Date.now() - info.startTime;
    if (info.maxTotalTimeout && totalElapsed >= info.maxTotalTimeout) {
      this._timeoutInfo.delete(messageId);
      throw McpError.fromError(ErrorCode.RequestTimeout, "Maximum total timeout exceeded", {
        maxTotalTimeout: info.maxTotalTimeout,
        totalElapsed
      });
    }
    clearTimeout(info.timeoutId);
    info.timeoutId = setTimeout(info.onTimeout, info.timeout);
    return true;
  }
  _cleanupTimeout(messageId) {
    const info = this._timeoutInfo.get(messageId);
    if (info) {
      clearTimeout(info.timeoutId);
      this._timeoutInfo.delete(messageId);
    }
  }
  /**
   * Attaches to the given transport, starts it, and starts listening for messages.
   *
   * The Protocol object assumes ownership of the Transport, replacing any callbacks that have already been set, and expects that it is the only user of the Transport instance going forward.
   */
  async connect(transport2) {
    if (this._transport) {
      throw new Error("Already connected to a transport. Call close() before connecting to a new transport, or use a separate Protocol instance per connection.");
    }
    this._transport = transport2;
    const _onclose = this.transport?.onclose;
    this._transport.onclose = () => {
      _onclose?.();
      this._onclose();
    };
    const _onerror = this.transport?.onerror;
    this._transport.onerror = (error2) => {
      _onerror?.(error2);
      this._onerror(error2);
    };
    const _onmessage = this._transport?.onmessage;
    this._transport.onmessage = (message, extra) => {
      _onmessage?.(message, extra);
      if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
        this._onresponse(message);
      } else if (isJSONRPCRequest(message)) {
        this._onrequest(message, extra);
      } else if (isJSONRPCNotification(message)) {
        this._onnotification(message);
      } else {
        this._onerror(new Error(`Unknown message type: ${JSON.stringify(message)}`));
      }
    };
    await this._transport.start();
  }
  _onclose() {
    const responseHandlers = this._responseHandlers;
    this._responseHandlers = /* @__PURE__ */ new Map();
    this._progressHandlers.clear();
    this._taskProgressTokens.clear();
    this._pendingDebouncedNotifications.clear();
    for (const info of this._timeoutInfo.values()) {
      clearTimeout(info.timeoutId);
    }
    this._timeoutInfo.clear();
    for (const controller of this._requestHandlerAbortControllers.values()) {
      controller.abort();
    }
    this._requestHandlerAbortControllers.clear();
    const error2 = McpError.fromError(ErrorCode.ConnectionClosed, "Connection closed");
    this._transport = void 0;
    this.onclose?.();
    for (const handler of responseHandlers.values()) {
      handler(error2);
    }
  }
  _onerror(error2) {
    this.onerror?.(error2);
  }
  _onnotification(notification) {
    const handler = this._notificationHandlers.get(notification.method) ?? this.fallbackNotificationHandler;
    if (handler === void 0) {
      return;
    }
    Promise.resolve().then(() => handler(notification)).catch((error2) => this._onerror(new Error(`Uncaught error in notification handler: ${error2}`)));
  }
  _onrequest(request, extra) {
    const handler = this._requestHandlers.get(request.method) ?? this.fallbackRequestHandler;
    const capturedTransport = this._transport;
    const relatedTaskId = request.params?._meta?.[RELATED_TASK_META_KEY]?.taskId;
    const sessionId = capturedTransport?.sessionId;
    const store = this._taskStore;
    let relatedTaskFound = true;
    let relatedTaskLookup;
    if (relatedTaskId && store && this._taskMessageQueue && sessionId !== void 0) {
      relatedTaskFound = false;
      relatedTaskLookup = (async () => {
        if (!await store.getTask(relatedTaskId, sessionId)) {
          throw new McpError(ErrorCode.InvalidParams, `Task not found: ${relatedTaskId}`);
        }
        relatedTaskFound = true;
      })();
    }
    if (handler === void 0) {
      const errorResponse = {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: ErrorCode.MethodNotFound,
          message: "Method not found"
        }
      };
      if (relatedTaskId && relatedTaskLookup) {
        const queuedError = { type: "error", message: errorResponse, timestamp: Date.now() };
        relatedTaskLookup.then(() => this._enqueueTaskMessage(relatedTaskId, queuedError, sessionId), () => capturedTransport?.send(errorResponse)).catch((error2) => this._onerror(new Error(`Failed to send an error response: ${error2}`)));
      } else if (relatedTaskId && this._taskMessageQueue) {
        this._enqueueTaskMessage(relatedTaskId, {
          type: "error",
          message: errorResponse,
          timestamp: Date.now()
        }, capturedTransport?.sessionId).catch((error2) => this._onerror(new Error(`Failed to enqueue error response: ${error2}`)));
      } else {
        capturedTransport?.send(errorResponse).catch((error2) => this._onerror(new Error(`Failed to send an error response: ${error2}`)));
      }
      return;
    }
    const abortController = new AbortController();
    this._requestHandlerAbortControllers.set(request.id, abortController);
    const taskCreationParams = isTaskAugmentedRequestParams(request.params) ? request.params.task : void 0;
    const taskStore = this._taskStore ? this.requestTaskStore(request, capturedTransport?.sessionId) : void 0;
    const fullExtra = {
      signal: abortController.signal,
      sessionId: capturedTransport?.sessionId,
      _meta: request.params?._meta,
      sendNotification: async (notification) => {
        if (abortController.signal.aborted)
          return;
        const notificationOptions = { relatedRequestId: request.id };
        if (relatedTaskId) {
          notificationOptions.relatedTask = { taskId: relatedTaskId };
        }
        await this.notification(notification, notificationOptions);
      },
      sendRequest: async (r, resultSchema, options) => {
        if (abortController.signal.aborted) {
          throw new McpError(ErrorCode.ConnectionClosed, "Request was cancelled");
        }
        const requestOptions = { ...options, relatedRequestId: request.id };
        if (relatedTaskId && !requestOptions.relatedTask) {
          requestOptions.relatedTask = { taskId: relatedTaskId };
        }
        const effectiveTaskId = requestOptions.relatedTask?.taskId ?? relatedTaskId;
        if (effectiveTaskId && taskStore) {
          await taskStore.updateTaskStatus(effectiveTaskId, "input_required");
        }
        return await this.request(r, resultSchema, requestOptions);
      },
      authInfo: extra?.authInfo,
      requestId: request.id,
      requestInfo: extra?.requestInfo,
      taskId: relatedTaskId,
      taskStore,
      taskRequestedTtl: taskCreationParams?.ttl,
      closeSSEStream: extra?.closeSSEStream,
      closeStandaloneSSEStream: extra?.closeStandaloneSSEStream
    };
    (relatedTaskLookup ?? Promise.resolve()).then(() => {
      if (relatedTaskLookup && abortController.signal.aborted) {
        throw new McpError(ErrorCode.ConnectionClosed, "Request was cancelled");
      }
      if (taskCreationParams) {
        this.assertTaskHandlerCapability(request.method);
      }
    }).then(() => handler(request, fullExtra)).then(async (result) => {
      if (abortController.signal.aborted) {
        return;
      }
      const response = {
        result,
        jsonrpc: "2.0",
        id: request.id
      };
      if (relatedTaskId && this._taskMessageQueue) {
        await this._enqueueTaskMessage(relatedTaskId, {
          type: "response",
          message: response,
          timestamp: Date.now()
        }, capturedTransport?.sessionId);
      } else {
        await capturedTransport?.send(response);
      }
    }, async (error2) => {
      if (abortController.signal.aborted) {
        return;
      }
      const errorResponse = {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: Number.isSafeInteger(error2["code"]) ? error2["code"] : ErrorCode.InternalError,
          message: error2.message ?? "Internal error",
          ...error2["data"] !== void 0 && { data: error2["data"] }
        }
      };
      if (relatedTaskId && this._taskMessageQueue && relatedTaskFound) {
        await this._enqueueTaskMessage(relatedTaskId, {
          type: "error",
          message: errorResponse,
          timestamp: Date.now()
        }, capturedTransport?.sessionId);
      } else {
        await capturedTransport?.send(errorResponse);
      }
    }).catch((error2) => this._onerror(new Error(`Failed to send response: ${error2}`))).finally(() => {
      if (this._requestHandlerAbortControllers.get(request.id) === abortController) {
        this._requestHandlerAbortControllers.delete(request.id);
      }
    });
  }
  _onprogress(notification) {
    const { progressToken, ...params } = notification.params;
    const messageId = Number(progressToken);
    const handler = this._progressHandlers.get(messageId);
    if (!handler) {
      this._onerror(new Error(`Received a progress notification for an unknown token: ${JSON.stringify(notification)}`));
      return;
    }
    const responseHandler = this._responseHandlers.get(messageId);
    const timeoutInfo = this._timeoutInfo.get(messageId);
    if (timeoutInfo && responseHandler && timeoutInfo.resetTimeoutOnProgress) {
      try {
        this._resetTimeout(messageId);
      } catch (error2) {
        this._responseHandlers.delete(messageId);
        this._progressHandlers.delete(messageId);
        this._cleanupTimeout(messageId);
        responseHandler(error2);
        return;
      }
    }
    handler(params);
  }
  _onresponse(response) {
    const messageId = Number(response.id);
    const resolver = this._requestResolvers.get(messageId);
    if (resolver) {
      this._requestResolvers.delete(messageId);
      if (isJSONRPCResultResponse(response)) {
        resolver(response);
      } else {
        const error2 = new McpError(response.error.code, response.error.message, response.error.data);
        resolver(error2);
      }
      return;
    }
    const handler = this._responseHandlers.get(messageId);
    if (handler === void 0) {
      this._onerror(new Error(`Received a response for an unknown message ID: ${JSON.stringify(response)}`));
      return;
    }
    this._responseHandlers.delete(messageId);
    this._cleanupTimeout(messageId);
    let isTaskResponse = false;
    if (isJSONRPCResultResponse(response) && response.result && typeof response.result === "object") {
      const result = response.result;
      if (result.task && typeof result.task === "object") {
        const task = result.task;
        if (typeof task.taskId === "string") {
          isTaskResponse = true;
          this._taskProgressTokens.set(task.taskId, messageId);
        }
      }
    }
    if (!isTaskResponse) {
      this._progressHandlers.delete(messageId);
    }
    if (isJSONRPCResultResponse(response)) {
      handler(response);
    } else {
      const error2 = McpError.fromError(response.error.code, response.error.message, response.error.data);
      handler(error2);
    }
  }
  get transport() {
    return this._transport;
  }
  /**
   * Closes the connection.
   */
  async close() {
    await this._transport?.close();
  }
  /**
   * Sends a request and returns an AsyncGenerator that yields response messages.
   * The generator is guaranteed to end with either a 'result' or 'error' message.
   *
   * @example
   * ```typescript
   * const stream = protocol.requestStream(request, resultSchema, options);
   * for await (const message of stream) {
   *   switch (message.type) {
   *     case 'taskCreated':
   *       console.log('Task created:', message.task.taskId);
   *       break;
   *     case 'taskStatus':
   *       console.log('Task status:', message.task.status);
   *       break;
   *     case 'result':
   *       console.log('Final result:', message.result);
   *       break;
   *     case 'error':
   *       console.error('Error:', message.error);
   *       break;
   *   }
   * }
   * ```
   *
   * @experimental Use `client.experimental.tasks.requestStream()` to access this method.
   */
  async *requestStream(request, resultSchema, options) {
    const { task } = options ?? {};
    if (!task) {
      try {
        const result = await this.request(request, resultSchema, options);
        yield { type: "result", result };
      } catch (error2) {
        yield {
          type: "error",
          error: error2 instanceof McpError ? error2 : new McpError(ErrorCode.InternalError, String(error2))
        };
      }
      return;
    }
    let taskId;
    try {
      const createResult = await this.request(request, CreateTaskResultSchema, options);
      if (createResult.task) {
        taskId = createResult.task.taskId;
        yield { type: "taskCreated", task: createResult.task };
      } else {
        throw new McpError(ErrorCode.InternalError, "Task creation did not return a task");
      }
      while (true) {
        const task2 = await this.getTask({ taskId }, options);
        yield { type: "taskStatus", task: task2 };
        if (isTerminal(task2.status)) {
          if (task2.status === "completed") {
            const result = await this.getTaskResult({ taskId }, resultSchema, options);
            yield { type: "result", result };
          } else if (task2.status === "failed") {
            yield {
              type: "error",
              error: new McpError(ErrorCode.InternalError, `Task ${taskId} failed`)
            };
          } else if (task2.status === "cancelled") {
            yield {
              type: "error",
              error: new McpError(ErrorCode.InternalError, `Task ${taskId} was cancelled`)
            };
          }
          return;
        }
        if (task2.status === "input_required") {
          const result = await this.getTaskResult({ taskId }, resultSchema, options);
          yield { type: "result", result };
          return;
        }
        const pollInterval = task2.pollInterval ?? this._options?.defaultTaskPollInterval ?? 1e3;
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        options?.signal?.throwIfAborted();
      }
    } catch (error2) {
      yield {
        type: "error",
        error: error2 instanceof McpError ? error2 : new McpError(ErrorCode.InternalError, String(error2))
      };
    }
  }
  /**
   * Sends a request and waits for a response.
   *
   * Do not use this method to emit notifications! Use notification() instead.
   */
  request(request, resultSchema, options) {
    const { relatedRequestId, resumptionToken, onresumptiontoken, task, relatedTask } = options ?? {};
    return new Promise((resolve, reject) => {
      const earlyReject = (error2) => {
        reject(error2);
      };
      if (!this._transport) {
        earlyReject(new Error("Not connected"));
        return;
      }
      if (this._options?.enforceStrictCapabilities === true) {
        try {
          this.assertCapabilityForMethod(request.method);
          if (task) {
            this.assertTaskCapability(request.method);
          }
        } catch (e) {
          earlyReject(e);
          return;
        }
      }
      options?.signal?.throwIfAborted();
      const messageId = this._requestMessageId++;
      const jsonrpcRequest = {
        ...request,
        jsonrpc: "2.0",
        id: messageId
      };
      if (options?.onprogress) {
        this._progressHandlers.set(messageId, options.onprogress);
        jsonrpcRequest.params = {
          ...request.params,
          _meta: {
            ...request.params?._meta || {},
            progressToken: messageId
          }
        };
      }
      if (task) {
        jsonrpcRequest.params = {
          ...jsonrpcRequest.params,
          task
        };
      }
      if (relatedTask) {
        jsonrpcRequest.params = {
          ...jsonrpcRequest.params,
          _meta: {
            ...jsonrpcRequest.params?._meta || {},
            [RELATED_TASK_META_KEY]: relatedTask
          }
        };
      }
      const cancel = (reason) => {
        this._responseHandlers.delete(messageId);
        this._progressHandlers.delete(messageId);
        this._cleanupTimeout(messageId);
        this._transport?.send({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: {
            requestId: messageId,
            reason: String(reason)
          }
        }, { relatedRequestId, resumptionToken, onresumptiontoken }).catch((error3) => this._onerror(new Error(`Failed to send cancellation: ${error3}`)));
        const error2 = reason instanceof McpError ? reason : new McpError(ErrorCode.RequestTimeout, String(reason));
        reject(error2);
      };
      this._responseHandlers.set(messageId, (response) => {
        if (options?.signal?.aborted) {
          return;
        }
        if (response instanceof Error) {
          return reject(response);
        }
        try {
          const parseResult = safeParse2(resultSchema, response.result);
          if (!parseResult.success) {
            reject(parseResult.error);
          } else {
            resolve(parseResult.data);
          }
        } catch (error2) {
          reject(error2);
        }
      });
      options?.signal?.addEventListener("abort", () => {
        cancel(options?.signal?.reason);
      });
      const timeout = options?.timeout ?? DEFAULT_REQUEST_TIMEOUT_MSEC;
      const timeoutHandler = () => cancel(McpError.fromError(ErrorCode.RequestTimeout, "Request timed out", { timeout }));
      this._setupTimeout(messageId, timeout, options?.maxTotalTimeout, timeoutHandler, options?.resetTimeoutOnProgress ?? false);
      const relatedTaskId = relatedTask?.taskId;
      if (relatedTaskId) {
        const responseResolver = (response) => {
          const handler = this._responseHandlers.get(messageId);
          if (handler) {
            handler(response);
          } else {
            this._onerror(new Error(`Response handler missing for side-channeled request ${messageId}`));
          }
        };
        this._requestResolvers.set(messageId, responseResolver);
        this._enqueueTaskMessage(relatedTaskId, {
          type: "request",
          message: jsonrpcRequest,
          timestamp: Date.now()
        }).catch((error2) => {
          this._cleanupTimeout(messageId);
          reject(error2);
        });
      } else {
        this._transport.send(jsonrpcRequest, { relatedRequestId, resumptionToken, onresumptiontoken }).catch((error2) => {
          this._cleanupTimeout(messageId);
          reject(error2);
        });
      }
    });
  }
  /**
   * Gets the current status of a task.
   *
   * @experimental Use `client.experimental.tasks.getTask()` to access this method.
   */
  async getTask(params, options) {
    return this.request({ method: "tasks/get", params }, GetTaskResultSchema, options);
  }
  /**
   * Retrieves the result of a completed task.
   *
   * @experimental Use `client.experimental.tasks.getTaskResult()` to access this method.
   */
  async getTaskResult(params, resultSchema, options) {
    return this.request({ method: "tasks/result", params }, resultSchema, options);
  }
  /**
   * Lists tasks, optionally starting from a pagination cursor.
   *
   * @experimental Use `client.experimental.tasks.listTasks()` to access this method.
   */
  async listTasks(params, options) {
    return this.request({ method: "tasks/list", params }, ListTasksResultSchema, options);
  }
  /**
   * Cancels a specific task.
   *
   * @experimental Use `client.experimental.tasks.cancelTask()` to access this method.
   */
  async cancelTask(params, options) {
    return this.request({ method: "tasks/cancel", params }, CancelTaskResultSchema, options);
  }
  /**
   * Emits a notification, which is a one-way message that does not expect a response.
   */
  async notification(notification, options) {
    if (!this._transport) {
      throw new Error("Not connected");
    }
    this.assertNotificationCapability(notification.method);
    const relatedTaskId = options?.relatedTask?.taskId;
    if (relatedTaskId) {
      const jsonrpcNotification2 = {
        ...notification,
        jsonrpc: "2.0",
        params: {
          ...notification.params,
          _meta: {
            ...notification.params?._meta || {},
            [RELATED_TASK_META_KEY]: options.relatedTask
          }
        }
      };
      await this._enqueueTaskMessage(relatedTaskId, {
        type: "notification",
        message: jsonrpcNotification2,
        timestamp: Date.now()
      });
      return;
    }
    const debouncedMethods = this._options?.debouncedNotificationMethods ?? [];
    const canDebounce = debouncedMethods.includes(notification.method) && !notification.params && !options?.relatedRequestId && !options?.relatedTask;
    if (canDebounce) {
      if (this._pendingDebouncedNotifications.has(notification.method)) {
        return;
      }
      this._pendingDebouncedNotifications.add(notification.method);
      Promise.resolve().then(() => {
        this._pendingDebouncedNotifications.delete(notification.method);
        if (!this._transport) {
          return;
        }
        let jsonrpcNotification2 = {
          ...notification,
          jsonrpc: "2.0"
        };
        if (options?.relatedTask) {
          jsonrpcNotification2 = {
            ...jsonrpcNotification2,
            params: {
              ...jsonrpcNotification2.params,
              _meta: {
                ...jsonrpcNotification2.params?._meta || {},
                [RELATED_TASK_META_KEY]: options.relatedTask
              }
            }
          };
        }
        this._transport?.send(jsonrpcNotification2, options).catch((error2) => this._onerror(error2));
      });
      return;
    }
    let jsonrpcNotification = {
      ...notification,
      jsonrpc: "2.0"
    };
    if (options?.relatedTask) {
      jsonrpcNotification = {
        ...jsonrpcNotification,
        params: {
          ...jsonrpcNotification.params,
          _meta: {
            ...jsonrpcNotification.params?._meta || {},
            [RELATED_TASK_META_KEY]: options.relatedTask
          }
        }
      };
    }
    await this._transport.send(jsonrpcNotification, options);
  }
  /**
   * Registers a handler to invoke when this protocol object receives a request with the given method.
   *
   * Note that this will replace any previous request handler for the same method.
   */
  setRequestHandler(requestSchema, handler) {
    const method = getMethodLiteral(requestSchema);
    this.assertRequestHandlerCapability(method);
    this._requestHandlers.set(method, (request, extra) => {
      const parsed = parseWithCompat(requestSchema, request);
      return Promise.resolve(handler(parsed, extra));
    });
  }
  /**
   * Removes the request handler for the given method.
   */
  removeRequestHandler(method) {
    this._requestHandlers.delete(method);
  }
  /**
   * Asserts that a request handler has not already been set for the given method, in preparation for a new one being automatically installed.
   */
  assertCanSetRequestHandler(method) {
    if (this._requestHandlers.has(method)) {
      throw new Error(`A request handler for ${method} already exists, which would be overridden`);
    }
  }
  /**
   * Registers a handler to invoke when this protocol object receives a notification with the given method.
   *
   * Note that this will replace any previous notification handler for the same method.
   */
  setNotificationHandler(notificationSchema, handler) {
    const method = getMethodLiteral(notificationSchema);
    this._notificationHandlers.set(method, (notification) => {
      const parsed = parseWithCompat(notificationSchema, notification);
      return Promise.resolve(handler(parsed));
    });
  }
  /**
   * Removes the notification handler for the given method.
   */
  removeNotificationHandler(method) {
    this._notificationHandlers.delete(method);
  }
  /**
   * Cleans up the progress handler associated with a task.
   * This should be called when a task reaches a terminal status.
   */
  _cleanupTaskProgressHandler(taskId) {
    const progressToken = this._taskProgressTokens.get(taskId);
    if (progressToken !== void 0) {
      this._progressHandlers.delete(progressToken);
      this._taskProgressTokens.delete(taskId);
    }
  }
  /**
   * Enqueues a task-related message for side-channel delivery via tasks/result.
   * @param taskId The task ID to associate the message with
   * @param message The message to enqueue
   * @param sessionId Optional session ID for binding the operation to a specific session
   * @throws Error if taskStore is not configured or if enqueue fails (e.g., queue overflow)
   *
   * Note: If enqueue fails, it's the TaskMessageQueue implementation's responsibility to handle
   * the error appropriately (e.g., by failing the task, logging, etc.). The Protocol layer
   * simply propagates the error.
   */
  async _enqueueTaskMessage(taskId, message, sessionId) {
    if (!this._taskStore || !this._taskMessageQueue) {
      throw new Error("Cannot enqueue task message: taskStore and taskMessageQueue are not configured");
    }
    const maxQueueSize = this._options?.maxTaskQueueSize;
    await this._taskMessageQueue.enqueue(taskId, message, sessionId ?? this._transport?.sessionId, maxQueueSize);
  }
  /**
   * Clears the message queue for a task and rejects any pending request resolvers.
   * @param taskId The task ID whose queue should be cleared
   * @param sessionId Optional session ID for binding the operation to a specific session
   */
  async _clearTaskQueue(taskId, sessionId) {
    if (this._taskMessageQueue) {
      const messages = await this._taskMessageQueue.dequeueAll(taskId, sessionId);
      for (const message of messages) {
        if (message.type === "request" && isJSONRPCRequest(message.message)) {
          const requestId = message.message.id;
          const resolver = this._requestResolvers.get(requestId);
          if (resolver) {
            resolver(new McpError(ErrorCode.InternalError, "Task cancelled or completed"));
            this._requestResolvers.delete(requestId);
          } else {
            this._onerror(new Error(`Resolver missing for request ${requestId} during task ${taskId} cleanup`));
          }
        }
      }
    }
  }
  /**
   * Waits for a task update (new messages or status change) with abort signal support.
   * Uses polling to check for updates at the task's configured poll interval.
   * @param taskId The task ID to wait for
   * @param signal Abort signal to cancel the wait
   * @param sessionId Session of the request that waits, passed to the task store
   * @returns Promise that resolves when an update occurs or rejects if aborted
   */
  async _waitForTaskUpdate(taskId, signal, sessionId) {
    let interval = this._options?.defaultTaskPollInterval ?? 1e3;
    try {
      const task = await this._taskStore?.getTask(taskId, sessionId);
      if (task?.pollInterval) {
        interval = task.pollInterval;
      }
    } catch {
    }
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new McpError(ErrorCode.InvalidRequest, "Request cancelled"));
        return;
      }
      const timeoutId = setTimeout(resolve, interval);
      signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
        reject(new McpError(ErrorCode.InvalidRequest, "Request cancelled"));
      }, { once: true });
    });
  }
  requestTaskStore(request, sessionId) {
    const taskStore = this._taskStore;
    if (!taskStore) {
      throw new Error("No task store configured");
    }
    return {
      createTask: async (taskParams) => {
        if (!request) {
          throw new Error("No request provided");
        }
        return await taskStore.createTask(taskParams, request.id, {
          method: request.method,
          params: request.params
        }, sessionId);
      },
      getTask: async (taskId) => {
        const task = await taskStore.getTask(taskId, sessionId);
        if (!task) {
          throw new McpError(ErrorCode.InvalidParams, "Failed to retrieve task: Task not found");
        }
        return task;
      },
      storeTaskResult: async (taskId, status, result) => {
        await taskStore.storeTaskResult(taskId, status, result, sessionId);
        const task = await taskStore.getTask(taskId, sessionId);
        if (task) {
          const notification = TaskStatusNotificationSchema.parse({
            method: "notifications/tasks/status",
            params: task
          });
          await this.notification(notification);
          if (isTerminal(task.status)) {
            this._cleanupTaskProgressHandler(taskId);
          }
        }
      },
      getTaskResult: (taskId) => {
        return taskStore.getTaskResult(taskId, sessionId);
      },
      updateTaskStatus: async (taskId, status, statusMessage) => {
        const task = await taskStore.getTask(taskId, sessionId);
        if (!task) {
          throw new McpError(ErrorCode.InvalidParams, `Task "${taskId}" not found - it may have been cleaned up`);
        }
        if (isTerminal(task.status)) {
          throw new McpError(ErrorCode.InvalidParams, `Cannot update task "${taskId}" from terminal status "${task.status}" to "${status}". Terminal states (completed, failed, cancelled) cannot transition to other states.`);
        }
        await taskStore.updateTaskStatus(taskId, status, statusMessage, sessionId);
        const updatedTask = await taskStore.getTask(taskId, sessionId);
        if (updatedTask) {
          const notification = TaskStatusNotificationSchema.parse({
            method: "notifications/tasks/status",
            params: updatedTask
          });
          await this.notification(notification);
          if (isTerminal(updatedTask.status)) {
            this._cleanupTaskProgressHandler(taskId);
          }
        }
      },
      listTasks: (cursor) => {
        return taskStore.listTasks(cursor, sessionId);
      }
    };
  }
};
function isPlainObject2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function mergeCapabilities(base, additional) {
  const result = { ...base };
  for (const key in additional) {
    const k = key;
    const addValue = additional[k];
    if (addValue === void 0)
      continue;
    const baseValue = result[k];
    if (isPlainObject2(baseValue) && isPlainObject2(addValue)) {
      result[k] = { ...baseValue, ...addValue };
    } else {
      result[k] = addValue;
    }
  }
  return result;
}

// node_modules/@modelcontextprotocol/sdk/dist/esm/validation/ajv-provider.js
var import_ajv = __toESM(require_ajv(), 1);
var import_ajv_formats = __toESM(require_dist(), 1);
function createDefaultAjvInstance() {
  const ajv = new import_ajv.default({
    strict: false,
    validateFormats: true,
    validateSchema: false,
    allErrors: true
  });
  const addFormats = import_ajv_formats.default;
  addFormats(ajv);
  return ajv;
}
var AjvJsonSchemaValidator = class {
  /**
   * Create an AJV validator
   *
   * @param ajv - Optional pre-configured AJV instance. If not provided, a default instance will be created.
   *
   * @example
   * ```typescript
   * // Use default configuration (recommended for most cases)
   * import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
   * const validator = new AjvJsonSchemaValidator();
   *
   * // Or provide custom AJV instance for advanced configuration
   * import { Ajv } from 'ajv';
   * import addFormats from 'ajv-formats';
   *
   * const ajv = new Ajv({ validateFormats: true });
   * addFormats(ajv);
   * const validator = new AjvJsonSchemaValidator(ajv);
   * ```
   */
  constructor(ajv) {
    this._ajv = ajv ?? createDefaultAjvInstance();
  }
  /**
   * Create a validator for the given JSON Schema
   *
   * The validator is compiled once and can be reused multiple times.
   * If the schema has an $id, it will be cached by AJV automatically.
   *
   * @param schema - Standard JSON Schema object
   * @returns A validator function that validates input data
   */
  getValidator(schema) {
    const ajvValidator = "$id" in schema && typeof schema.$id === "string" ? this._ajv.getSchema(schema.$id) ?? this._ajv.compile(schema) : this._ajv.compile(schema);
    return (input) => {
      const valid = ajvValidator(input);
      if (valid) {
        return {
          valid: true,
          data: input,
          errorMessage: void 0
        };
      } else {
        return {
          valid: false,
          data: void 0,
          errorMessage: this._ajv.errorsText(ajvValidator.errors)
        };
      }
    };
  }
};

// node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/server.js
var ExperimentalServerTasks = class {
  constructor(_server) {
    this._server = _server;
  }
  /**
   * Sends a request and returns an AsyncGenerator that yields response messages.
   * The generator is guaranteed to end with either a 'result' or 'error' message.
   *
   * This method provides streaming access to request processing, allowing you to
   * observe intermediate task status updates for task-augmented requests.
   *
   * @param request - The request to send
   * @param resultSchema - Zod schema for validating the result
   * @param options - Optional request options (timeout, signal, task creation params, etc.)
   * @returns AsyncGenerator that yields ResponseMessage objects
   *
   * @experimental
   */
  requestStream(request, resultSchema, options) {
    return this._server.requestStream(request, resultSchema, options);
  }
  /**
   * Sends a sampling request and returns an AsyncGenerator that yields response messages.
   * The generator is guaranteed to end with either a 'result' or 'error' message.
   *
   * For task-augmented requests, yields 'taskCreated' and 'taskStatus' messages
   * before the final result.
   *
   * @example
   * ```typescript
   * const stream = server.experimental.tasks.createMessageStream({
   *     messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
   *     maxTokens: 100
   * }, {
   *     onprogress: (progress) => {
   *         // Handle streaming tokens via progress notifications
   *         console.log('Progress:', progress.message);
   *     }
   * });
   *
   * for await (const message of stream) {
   *     switch (message.type) {
   *         case 'taskCreated':
   *             console.log('Task created:', message.task.taskId);
   *             break;
   *         case 'taskStatus':
   *             console.log('Task status:', message.task.status);
   *             break;
   *         case 'result':
   *             console.log('Final result:', message.result);
   *             break;
   *         case 'error':
   *             console.error('Error:', message.error);
   *             break;
   *     }
   * }
   * ```
   *
   * @param params - The sampling request parameters
   * @param options - Optional request options (timeout, signal, task creation params, onprogress, etc.)
   * @returns AsyncGenerator that yields ResponseMessage objects
   *
   * @experimental
   */
  createMessageStream(params, options) {
    const clientCapabilities = this._server.getClientCapabilities();
    if ((params.tools || params.toolChoice) && !clientCapabilities?.sampling?.tools) {
      throw new Error("Client does not support sampling tools capability.");
    }
    if (params.messages.length > 0) {
      const lastMessage = params.messages[params.messages.length - 1];
      const lastContent = Array.isArray(lastMessage.content) ? lastMessage.content : [lastMessage.content];
      const hasToolResults = lastContent.some((c) => c.type === "tool_result");
      const previousMessage = params.messages.length > 1 ? params.messages[params.messages.length - 2] : void 0;
      const previousContent = previousMessage ? Array.isArray(previousMessage.content) ? previousMessage.content : [previousMessage.content] : [];
      const hasPreviousToolUse = previousContent.some((c) => c.type === "tool_use");
      if (hasToolResults) {
        if (lastContent.some((c) => c.type !== "tool_result")) {
          throw new Error("The last message must contain only tool_result content if any is present");
        }
        if (!hasPreviousToolUse) {
          throw new Error("tool_result blocks are not matching any tool_use from the previous message");
        }
      }
      if (hasPreviousToolUse) {
        const toolUseIds = new Set(previousContent.filter((c) => c.type === "tool_use").map((c) => c.id));
        const toolResultIds = new Set(lastContent.filter((c) => c.type === "tool_result").map((c) => c.toolUseId));
        if (toolUseIds.size !== toolResultIds.size || ![...toolUseIds].every((id) => toolResultIds.has(id))) {
          throw new Error("ids of tool_result blocks and tool_use blocks from previous message do not match");
        }
      }
    }
    return this.requestStream({
      method: "sampling/createMessage",
      params
    }, CreateMessageResultSchema, options);
  }
  /**
   * Sends an elicitation request and returns an AsyncGenerator that yields response messages.
   * The generator is guaranteed to end with either a 'result' or 'error' message.
   *
   * For task-augmented requests (especially URL-based elicitation), yields 'taskCreated'
   * and 'taskStatus' messages before the final result.
   *
   * @example
   * ```typescript
   * const stream = server.experimental.tasks.elicitInputStream({
   *     mode: 'url',
   *     message: 'Please authenticate',
   *     elicitationId: 'auth-123',
   *     url: 'https://example.com/auth'
   * }, {
   *     task: { ttl: 300000 } // Task-augmented for long-running auth flow
   * });
   *
   * for await (const message of stream) {
   *     switch (message.type) {
   *         case 'taskCreated':
   *             console.log('Task created:', message.task.taskId);
   *             break;
   *         case 'taskStatus':
   *             console.log('Task status:', message.task.status);
   *             break;
   *         case 'result':
   *             console.log('User action:', message.result.action);
   *             break;
   *         case 'error':
   *             console.error('Error:', message.error);
   *             break;
   *     }
   * }
   * ```
   *
   * @param params - The elicitation request parameters
   * @param options - Optional request options (timeout, signal, task creation params, etc.)
   * @returns AsyncGenerator that yields ResponseMessage objects
   *
   * @experimental
   */
  elicitInputStream(params, options) {
    const clientCapabilities = this._server.getClientCapabilities();
    const mode = params.mode ?? "form";
    switch (mode) {
      case "url": {
        if (!clientCapabilities?.elicitation?.url) {
          throw new Error("Client does not support url elicitation.");
        }
        break;
      }
      case "form": {
        if (!clientCapabilities?.elicitation?.form) {
          throw new Error("Client does not support form elicitation.");
        }
        break;
      }
    }
    const normalizedParams = mode === "form" && params.mode === void 0 ? { ...params, mode: "form" } : params;
    return this.requestStream({
      method: "elicitation/create",
      params: normalizedParams
    }, ElicitResultSchema, options);
  }
  /**
   * Gets the current status of a task.
   *
   * @param taskId - The task identifier
   * @param options - Optional request options
   * @returns The task status
   *
   * @experimental
   */
  async getTask(taskId, options) {
    return this._server.getTask({ taskId }, options);
  }
  /**
   * Retrieves the result of a completed task.
   *
   * @param taskId - The task identifier
   * @param resultSchema - Zod schema for validating the result
   * @param options - Optional request options
   * @returns The task result
   *
   * @experimental
   */
  async getTaskResult(taskId, resultSchema, options) {
    return this._server.getTaskResult({ taskId }, resultSchema, options);
  }
  /**
   * Lists tasks with optional pagination.
   *
   * @param cursor - Optional pagination cursor
   * @param options - Optional request options
   * @returns List of tasks with optional next cursor
   *
   * @experimental
   */
  async listTasks(cursor, options) {
    return this._server.listTasks(cursor ? { cursor } : void 0, options);
  }
  /**
   * Cancels a running task.
   *
   * @param taskId - The task identifier
   * @param options - Optional request options
   *
   * @experimental
   */
  async cancelTask(taskId, options) {
    return this._server.cancelTask({ taskId }, options);
  }
};

// node_modules/@modelcontextprotocol/sdk/dist/esm/experimental/tasks/helpers.js
function assertToolsCallTaskCapability(requests, method, entityName) {
  if (!requests) {
    throw new Error(`${entityName} does not support task creation (required for ${method})`);
  }
  switch (method) {
    case "tools/call":
      if (!requests.tools?.call) {
        throw new Error(`${entityName} does not support task creation for tools/call (required for ${method})`);
      }
      break;
    default:
      break;
  }
}
function assertClientRequestTaskCapability(requests, method, entityName) {
  if (!requests) {
    throw new Error(`${entityName} does not support task creation (required for ${method})`);
  }
  switch (method) {
    case "sampling/createMessage":
      if (!requests.sampling?.createMessage) {
        throw new Error(`${entityName} does not support task creation for sampling/createMessage (required for ${method})`);
      }
      break;
    case "elicitation/create":
      if (!requests.elicitation?.create) {
        throw new Error(`${entityName} does not support task creation for elicitation/create (required for ${method})`);
      }
      break;
    default:
      break;
  }
}

// node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js
var Server = class extends Protocol {
  /**
   * Initializes this server with the given name and version information.
   */
  constructor(_serverInfo, options) {
    super(options);
    this._serverInfo = _serverInfo;
    this._loggingLevels = /* @__PURE__ */ new Map();
    this.LOG_LEVEL_SEVERITY = new Map(LoggingLevelSchema.options.map((level, index) => [level, index]));
    this.isMessageIgnored = (level, sessionId) => {
      const currentLevel = this._loggingLevels.get(sessionId);
      return currentLevel ? this.LOG_LEVEL_SEVERITY.get(level) < this.LOG_LEVEL_SEVERITY.get(currentLevel) : false;
    };
    this._capabilities = options?.capabilities ?? {};
    this._instructions = options?.instructions;
    this._jsonSchemaValidator = options?.jsonSchemaValidator ?? new AjvJsonSchemaValidator();
    this.setRequestHandler(InitializeRequestSchema, (request) => this._oninitialize(request));
    this.setNotificationHandler(InitializedNotificationSchema, () => this.oninitialized?.());
    if (this._capabilities.logging) {
      this.setRequestHandler(SetLevelRequestSchema, async (request, extra) => {
        const transportSessionId = extra.sessionId || extra.requestInfo?.headers["mcp-session-id"] || void 0;
        const { level } = request.params;
        const parseResult = LoggingLevelSchema.safeParse(level);
        if (parseResult.success) {
          this._loggingLevels.set(transportSessionId, parseResult.data);
        }
        return {};
      });
    }
  }
  /**
   * Access experimental features.
   *
   * WARNING: These APIs are experimental and may change without notice.
   *
   * @experimental
   */
  get experimental() {
    if (!this._experimental) {
      this._experimental = {
        tasks: new ExperimentalServerTasks(this)
      };
    }
    return this._experimental;
  }
  /**
   * Registers new capabilities. This can only be called before connecting to a transport.
   *
   * The new capabilities will be merged with any existing capabilities previously given (e.g., at initialization).
   */
  registerCapabilities(capabilities) {
    if (this.transport) {
      throw new Error("Cannot register capabilities after connecting to transport");
    }
    this._capabilities = mergeCapabilities(this._capabilities, capabilities);
  }
  /**
   * Override request handler registration to enforce server-side validation for tools/call.
   */
  setRequestHandler(requestSchema, handler) {
    const shape = getObjectShape(requestSchema);
    const methodSchema = shape?.method;
    if (!methodSchema) {
      throw new Error("Schema is missing a method literal");
    }
    const methodValue = getLiteralValue(methodSchema);
    if (typeof methodValue !== "string") {
      throw new Error("Schema method literal must be a string");
    }
    const method = methodValue;
    if (method === "tools/call") {
      const wrappedHandler = async (request, extra) => {
        const validatedRequest = safeParse2(CallToolRequestSchema, request);
        if (!validatedRequest.success) {
          const errorMessage2 = validatedRequest.error instanceof Error ? validatedRequest.error.message : String(validatedRequest.error);
          throw new McpError(ErrorCode.InvalidParams, `Invalid tools/call request: ${errorMessage2}`);
        }
        const { params } = validatedRequest.data;
        const result = await Promise.resolve(handler(request, extra));
        if (params.task) {
          const taskValidationResult = safeParse2(CreateTaskResultSchema, result);
          if (!taskValidationResult.success) {
            const errorMessage2 = taskValidationResult.error instanceof Error ? taskValidationResult.error.message : String(taskValidationResult.error);
            throw new McpError(ErrorCode.InvalidParams, `Invalid task creation result: ${errorMessage2}`);
          }
          return taskValidationResult.data;
        }
        const validationResult = safeParse2(CallToolResultSchema, result);
        if (!validationResult.success) {
          const errorMessage2 = validationResult.error instanceof Error ? validationResult.error.message : String(validationResult.error);
          throw new McpError(ErrorCode.InvalidParams, `Invalid tools/call result: ${errorMessage2}`);
        }
        return validationResult.data;
      };
      return super.setRequestHandler(requestSchema, wrappedHandler);
    }
    return super.setRequestHandler(requestSchema, handler);
  }
  assertCapabilityForMethod(method) {
    switch (method) {
      case "sampling/createMessage":
        if (!this._clientCapabilities?.sampling) {
          throw new Error(`Client does not support sampling (required for ${method})`);
        }
        break;
      case "elicitation/create":
        if (!this._clientCapabilities?.elicitation) {
          throw new Error(`Client does not support elicitation (required for ${method})`);
        }
        break;
      case "roots/list":
        if (!this._clientCapabilities?.roots) {
          throw new Error(`Client does not support listing roots (required for ${method})`);
        }
        break;
      case "ping":
        break;
    }
  }
  assertNotificationCapability(method) {
    switch (method) {
      case "notifications/message":
        if (!this._capabilities.logging) {
          throw new Error(`Server does not support logging (required for ${method})`);
        }
        break;
      case "notifications/resources/updated":
      case "notifications/resources/list_changed":
        if (!this._capabilities.resources) {
          throw new Error(`Server does not support notifying about resources (required for ${method})`);
        }
        break;
      case "notifications/tools/list_changed":
        if (!this._capabilities.tools) {
          throw new Error(`Server does not support notifying of tool list changes (required for ${method})`);
        }
        break;
      case "notifications/prompts/list_changed":
        if (!this._capabilities.prompts) {
          throw new Error(`Server does not support notifying of prompt list changes (required for ${method})`);
        }
        break;
      case "notifications/elicitation/complete":
        if (!this._clientCapabilities?.elicitation?.url) {
          throw new Error(`Client does not support URL elicitation (required for ${method})`);
        }
        break;
      case "notifications/cancelled":
        break;
      case "notifications/progress":
        break;
    }
  }
  assertRequestHandlerCapability(method) {
    if (!this._capabilities) {
      return;
    }
    switch (method) {
      case "completion/complete":
        if (!this._capabilities.completions) {
          throw new Error(`Server does not support completions (required for ${method})`);
        }
        break;
      case "logging/setLevel":
        if (!this._capabilities.logging) {
          throw new Error(`Server does not support logging (required for ${method})`);
        }
        break;
      case "prompts/get":
      case "prompts/list":
        if (!this._capabilities.prompts) {
          throw new Error(`Server does not support prompts (required for ${method})`);
        }
        break;
      case "resources/list":
      case "resources/templates/list":
      case "resources/read":
        if (!this._capabilities.resources) {
          throw new Error(`Server does not support resources (required for ${method})`);
        }
        break;
      case "tools/call":
      case "tools/list":
        if (!this._capabilities.tools) {
          throw new Error(`Server does not support tools (required for ${method})`);
        }
        break;
      case "tasks/get":
      case "tasks/list":
      case "tasks/result":
      case "tasks/cancel":
        if (!this._capabilities.tasks) {
          throw new Error(`Server does not support tasks capability (required for ${method})`);
        }
        break;
      case "ping":
      case "initialize":
        break;
    }
  }
  assertTaskCapability(method) {
    assertClientRequestTaskCapability(this._clientCapabilities?.tasks?.requests, method, "Client");
  }
  assertTaskHandlerCapability(method) {
    if (!this._capabilities) {
      return;
    }
    assertToolsCallTaskCapability(this._capabilities.tasks?.requests, method, "Server");
  }
  async _oninitialize(request) {
    const requestedVersion = request.params.protocolVersion;
    this._clientCapabilities = request.params.capabilities;
    this._clientVersion = request.params.clientInfo;
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion) ? requestedVersion : LATEST_PROTOCOL_VERSION;
    return {
      protocolVersion,
      capabilities: this.getCapabilities(),
      serverInfo: this._serverInfo,
      ...this._instructions && { instructions: this._instructions }
    };
  }
  /**
   * After initialization has completed, this will be populated with the client's reported capabilities.
   */
  getClientCapabilities() {
    return this._clientCapabilities;
  }
  /**
   * After initialization has completed, this will be populated with information about the client's name and version.
   */
  getClientVersion() {
    return this._clientVersion;
  }
  getCapabilities() {
    return this._capabilities;
  }
  async ping() {
    return this.request({ method: "ping" }, EmptyResultSchema);
  }
  // Implementation
  async createMessage(params, options) {
    if (params.tools || params.toolChoice) {
      if (!this._clientCapabilities?.sampling?.tools) {
        throw new Error("Client does not support sampling tools capability.");
      }
    }
    if (params.messages.length > 0) {
      const lastMessage = params.messages[params.messages.length - 1];
      const lastContent = Array.isArray(lastMessage.content) ? lastMessage.content : [lastMessage.content];
      const hasToolResults = lastContent.some((c) => c.type === "tool_result");
      const previousMessage = params.messages.length > 1 ? params.messages[params.messages.length - 2] : void 0;
      const previousContent = previousMessage ? Array.isArray(previousMessage.content) ? previousMessage.content : [previousMessage.content] : [];
      const hasPreviousToolUse = previousContent.some((c) => c.type === "tool_use");
      if (hasToolResults) {
        if (lastContent.some((c) => c.type !== "tool_result")) {
          throw new Error("The last message must contain only tool_result content if any is present");
        }
        if (!hasPreviousToolUse) {
          throw new Error("tool_result blocks are not matching any tool_use from the previous message");
        }
      }
      if (hasPreviousToolUse) {
        const toolUseIds = new Set(previousContent.filter((c) => c.type === "tool_use").map((c) => c.id));
        const toolResultIds = new Set(lastContent.filter((c) => c.type === "tool_result").map((c) => c.toolUseId));
        if (toolUseIds.size !== toolResultIds.size || ![...toolUseIds].every((id) => toolResultIds.has(id))) {
          throw new Error("ids of tool_result blocks and tool_use blocks from previous message do not match");
        }
      }
    }
    if (params.tools) {
      return this.request({ method: "sampling/createMessage", params }, CreateMessageResultWithToolsSchema, options);
    }
    return this.request({ method: "sampling/createMessage", params }, CreateMessageResultSchema, options);
  }
  /**
   * Creates an elicitation request for the given parameters.
   * For backwards compatibility, `mode` may be omitted for form requests and will default to `'form'`.
   * @param params The parameters for the elicitation request.
   * @param options Optional request options.
   * @returns The result of the elicitation request.
   */
  async elicitInput(params, options) {
    const mode = params.mode ?? "form";
    switch (mode) {
      case "url": {
        if (!this._clientCapabilities?.elicitation?.url) {
          throw new Error("Client does not support url elicitation.");
        }
        const urlParams = params;
        return this.request({ method: "elicitation/create", params: urlParams }, ElicitResultSchema, options);
      }
      case "form": {
        if (!this._clientCapabilities?.elicitation?.form) {
          throw new Error("Client does not support form elicitation.");
        }
        const formParams = params.mode === "form" ? params : { ...params, mode: "form" };
        const result = await this.request({ method: "elicitation/create", params: formParams }, ElicitResultSchema, options);
        if (result.action === "accept" && result.content && formParams.requestedSchema) {
          try {
            const validator = this._jsonSchemaValidator.getValidator(formParams.requestedSchema);
            const validationResult = validator(result.content);
            if (!validationResult.valid) {
              throw new McpError(ErrorCode.InvalidParams, `Elicitation response content does not match requested schema: ${validationResult.errorMessage}`);
            }
          } catch (error2) {
            if (error2 instanceof McpError) {
              throw error2;
            }
            throw new McpError(ErrorCode.InternalError, `Error validating elicitation response: ${error2 instanceof Error ? error2.message : String(error2)}`);
          }
        }
        return result;
      }
    }
  }
  /**
   * Creates a reusable callback that, when invoked, will send a `notifications/elicitation/complete`
   * notification for the specified elicitation ID.
   *
   * @param elicitationId The ID of the elicitation to mark as complete.
   * @param options Optional notification options. Useful when the completion notification should be related to a prior request.
   * @returns A function that emits the completion notification when awaited.
   */
  createElicitationCompletionNotifier(elicitationId, options) {
    if (!this._clientCapabilities?.elicitation?.url) {
      throw new Error("Client does not support URL elicitation (required for notifications/elicitation/complete)");
    }
    return () => this.notification({
      method: "notifications/elicitation/complete",
      params: {
        elicitationId
      }
    }, options);
  }
  async listRoots(params, options) {
    return this.request({ method: "roots/list", params }, ListRootsResultSchema, options);
  }
  /**
   * Sends a logging message to the client, if connected.
   * Note: You only need to send the parameters object, not the entire JSON RPC message
   * @see LoggingMessageNotification
   * @param params
   * @param sessionId optional for stateless and backward compatibility
   */
  async sendLoggingMessage(params, sessionId) {
    if (this._capabilities.logging) {
      if (!this.isMessageIgnored(params.level, sessionId)) {
        return this.notification({ method: "notifications/message", params });
      }
    }
  }
  async sendResourceUpdated(params) {
    return this.notification({
      method: "notifications/resources/updated",
      params
    });
  }
  async sendResourceListChanged() {
    return this.notification({
      method: "notifications/resources/list_changed"
    });
  }
  async sendToolListChanged() {
    return this.notification({ method: "notifications/tools/list_changed" });
  }
  async sendPromptListChanged() {
    return this.notification({ method: "notifications/prompts/list_changed" });
  }
};

// node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js
import process2 from "node:process";

// node_modules/@modelcontextprotocol/sdk/dist/esm/shared/stdio.js
var STDIO_DEFAULT_MAX_BUFFER_SIZE = 10 * 1024 * 1024;
var ReadBuffer = class {
  constructor(options) {
    this._maxBufferSize = options?.maxBufferSize ?? STDIO_DEFAULT_MAX_BUFFER_SIZE;
  }
  append(chunk) {
    const newSize = (this._buffer?.length ?? 0) + chunk.length;
    if (newSize > this._maxBufferSize) {
      this.clear();
      throw new Error(`ReadBuffer exceeded maximum size of ${this._maxBufferSize} bytes`);
    }
    this._buffer = this._buffer ? Buffer.concat([this._buffer, chunk]) : chunk;
  }
  readMessage() {
    if (!this._buffer) {
      return null;
    }
    const index = this._buffer.indexOf("\n");
    if (index === -1) {
      return null;
    }
    const line = this._buffer.toString("utf8", 0, index).replace(/\r$/, "");
    this._buffer = this._buffer.subarray(index + 1);
    return deserializeMessage(line);
  }
  clear() {
    this._buffer = void 0;
  }
};
function deserializeMessage(line) {
  return JSONRPCMessageSchema.parse(JSON.parse(line));
}
function serializeMessage(message) {
  return JSON.stringify(message) + "\n";
}

// node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js
var StdioServerTransport = class {
  constructor(_stdin = process2.stdin, _stdout = process2.stdout, options) {
    this._stdin = _stdin;
    this._stdout = _stdout;
    this._started = false;
    this._ondata = (chunk) => {
      try {
        this._readBuffer.append(chunk);
        this.processReadBuffer();
      } catch (error2) {
        this.onerror?.(error2);
        this.close().catch(() => {
        });
      }
    };
    this._onerror = (error2) => {
      this.onerror?.(error2);
    };
    this._readBuffer = new ReadBuffer({ maxBufferSize: options?.maxBufferSize });
  }
  /**
   * Starts listening for messages on stdin.
   */
  async start() {
    if (this._started) {
      throw new Error("StdioServerTransport already started! If using Server class, note that connect() calls start() automatically.");
    }
    this._started = true;
    this._stdin.on("data", this._ondata);
    this._stdin.on("error", this._onerror);
  }
  processReadBuffer() {
    while (true) {
      try {
        const message = this._readBuffer.readMessage();
        if (message === null) {
          break;
        }
        this.onmessage?.(message);
      } catch (error2) {
        this.onerror?.(error2);
      }
    }
  }
  async close() {
    this._stdin.off("data", this._ondata);
    this._stdin.off("error", this._onerror);
    const remainingDataListeners = this._stdin.listenerCount("data");
    if (remainingDataListeners === 0) {
      this._stdin.pause();
    }
    this._readBuffer.clear();
    this.onclose?.();
  }
  send(message) {
    return new Promise((resolve) => {
      const json = serializeMessage(message);
      if (this._stdout.write(json)) {
        resolve();
      } else {
        this._stdout.once("drain", resolve);
      }
    });
  }
};

// src/shared.ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
function isTeamError(x) {
  return x instanceof TeamError;
}

// src/domain/config.ts
var TEAM_LIMIT_KEYS = [
  "maxMembers",
  "maxTasks",
  "maxMessageBytes",
  "disposalTimeoutMs"
];
function validateTeamLimits(input) {
  const out = {};
  for (const key of TEAM_LIMIT_KEYS) {
    const raw = input[key];
    const n = coerceInteger(raw);
    if (n === void 0 || !Number.isSafeInteger(n) || n < 1) {
      throw new TeamError("TEAM_INVALID_CONFIG", `${key} must be a positive safe integer`, {
        cause: { key, value: raw }
      });
    }
    out[key] = n;
  }
  return out;
}
function coerceInteger(raw) {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) return Number(raw.trim());
  return void 0;
}
function validateLeadMode(raw) {
  return raw === "collaborator" ? "collaborator" : "orchestrator";
}

// src/shared.ts
function dataDir() {
  const candidates = [
    process.env.TEAM_PLUGIN_DATA,
    process.env.ZCODE_PLUGIN_DATA,
    process.env.CLAUDE_PLUGIN_DATA
  ];
  for (const c of candidates) if (c && c.trim()) return c;
  return path.join(os.homedir(), ".zcode", "agent-team-dev-data");
}
function ensurePrivateDir(p) {
  fs.mkdirSync(p, { recursive: true, mode: 448 });
  try {
    fs.chmodSync(p, 448);
  } catch {
  }
  return p;
}
function runtimeConfigPath() {
  return path.join(dataDir(), "meta", "runtime-config.json");
}
function writeRuntimeConfig(input) {
  const file = runtimeConfigPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  const doc = {
    version: 1,
    interrupt: input.interrupt,
    leadMode: input.leadMode,
    limits: input.limits,
    updatedAt: ts()
  };
  const fd = fs.openSync(tmp, "w", 384);
  try {
    fs.writeFileSync(fd, JSON.stringify(doc, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}
function appendJsonl(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", { mode: 384 });
  chmodPrivateOnce(file);
}
function ts() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
var SENSITIVE_ENV_KEY = /(?:^|_)(?:KEY|KEYS|APIKEY|TOKEN|TOKENS|SECRET|SECRETS|PASSWORD|PASSWORDS|PASSWD|PASSPHRASE|AUTH|AUTHORIZATION|COOKIE|CREDENTIAL|CREDENTIALS|PRIVATE|URL|URI|DSN|CONNECTION)(?:$|_)/i;
function isSensitiveEnvKey(key) {
  return SENSITIVE_ENV_KEY.test(key);
}
function sanitizeToolName(name) {
  return typeof name === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(name) ? name : "unknown-tool";
}
function metaFilePath(dataRoot, toolName, now2 = Date.now()) {
  const safe = sanitizeToolName(toolName);
  if (safe === "unknown-tool") return null;
  const metaDir = path.resolve(dataRoot, "meta");
  const target = path.resolve(metaDir, `${safe}-${now2}-${Math.random().toString(36).slice(2, 8)}.json`);
  if (!target.startsWith(`${metaDir}${path.sep}`)) return null;
  return target;
}
function redactToolArguments(args) {
  const redactValue = (value, depth = 0) => {
    if (depth > 6) return "<truncated>";
    if (typeof value === "string") {
      return value.length > 256 ? `${value.slice(0, 256)}\u2026(${value.length} chars)` : value;
    }
    if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
    if (typeof value === "object" && value !== null) {
      const out = {};
      for (const [key, child] of Object.entries(value)) {
        if (isSensitiveEnvKey(key)) {
          out[key] = "<redacted>";
          continue;
        }
        if (key === "message" || key === "prompt" || key === "description" || key === "content") {
          const length = typeof child === "string" ? child.length : Array.isArray(child) ? child.length : 0;
          out[key] = { redacted: true, chars: length };
          continue;
        }
        out[key] = redactValue(child, depth + 1);
      }
      return out;
    }
    return value;
  };
  return redactValue(args);
}
function cleanupStaleSpecs(dataRoot, maxAgeMs = 5 * 6e4) {
  const teamsRoot = path.join(dataRoot, "teams");
  let removed = 0;
  let teams;
  try {
    teams = fs.readdirSync(teamsRoot);
  } catch {
    return 0;
  }
  const now2 = Date.now();
  for (const team of teams) {
    const membersRoot = path.join(teamsRoot, team, "members");
    let members;
    try {
      members = fs.readdirSync(membersRoot);
    } catch {
      continue;
    }
    for (const member of members) {
      const runDir = path.join(membersRoot, member, "run");
      let files;
      try {
        files = fs.readdirSync(runDir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".spec.json")) continue;
        const full = path.join(runDir, file);
        try {
          if (now2 - fs.statSync(full).mtimeMs > maxAgeMs) {
            fs.unlinkSync(full);
            removed += 1;
          }
        } catch {
        }
      }
    }
  }
  return removed;
}
function pruneMetaFiles(dataRoot, maxFiles = 500, maxAgeMs = 7 * 24 * 36e5) {
  const dir = path.join(dataRoot, "meta");
  let entries;
  try {
    entries = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => {
      const full = path.join(dir, name);
      return { name, mtimeMs: fs.statSync(full).mtimeMs };
    });
  } catch {
    return 0;
  }
  const now2 = Date.now();
  let removed = 0;
  const stale = entries.filter((e) => now2 - e.mtimeMs > maxAgeMs);
  const remaining = entries.filter((e) => now2 - e.mtimeMs <= maxAgeMs).sort((a, b) => a.mtimeMs - b.mtimeMs);
  const excess = Math.max(0, remaining.length - maxFiles);
  for (const entry of [...stale, ...remaining.slice(0, excess)]) {
    try {
      fs.unlinkSync(path.join(dir, entry.name));
      removed += 1;
    } catch {
    }
  }
  return removed;
}
var chmodded = /* @__PURE__ */ new Set();
function chmodPrivateOnce(file) {
  if (chmodded.has(file)) return;
  chmodded.add(file);
  try {
    fs.chmodSync(file, 384);
  } catch {
  }
}
var LIMIT_KEYS = [
  ["maxMembers", "TEAM_MAX_MEMBERS", 8],
  ["maxTasks", "TEAM_MAX_TASKS", 256],
  ["maxMessageBytes", "TEAM_MAX_MESSAGE_BYTES", 65536],
  ["disposalTimeoutMs", "TEAM_DISPOSAL_TIMEOUT_MS", 5e3]
];
function loadConfig() {
  const input = {};
  for (const [key, envName, def] of LIMIT_KEYS) {
    const raw = process.env[envName];
    input[key] = raw === void 0 || raw === "" ? def : raw;
  }
  try {
    return { ok: true, values: validateTeamLimits(input) };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `TEAM_INVALID_CONFIG: ${detail}\uFF08\u8BF7\u5728 Settings \u2192 Plugins \u2192 agent-team \u7684\u7528\u6237\u914D\u7F6E\u4E2D\u6539\u56DE\u6B63\u6574\u6570\uFF09\u3002`
    };
  }
}
function logErr(scope, msg, extra) {
  try {
    process.stderr.write(
      JSON.stringify({ ts: ts(), scope, msg, extra }) + "\n"
    );
  } catch {
  }
}

// src/coord/lock.ts
import crypto from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";

// src/coord/identity.ts
import { randomUUID } from "node:crypto";
var cachedBootId;
function bootId() {
  cachedBootId ??= randomUUID();
  return cachedBootId;
}
function writerId() {
  return `${bootId()}:${process.pid}`;
}
function parseWriterId(writer) {
  const sep = writer.lastIndexOf(":");
  if (sep <= 0) return void 0;
  const pid = Number(writer.slice(sep + 1));
  const id = writer.slice(0, sep);
  if (!Number.isInteger(pid) || id.length === 0) return void 0;
  return { bootId: id, pid };
}

// src/coord/lock.ts
var DEFAULT_LOCK_TUNING = {
  heartbeatMs: 1e3,
  expiryMs: 4500,
  pollMs: 200
};
var exitReleases = /* @__PURE__ */ new Set();
var exitHookInstalled = false;
function registerExitRelease(release) {
  exitReleases.add(release);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.once("exit", () => {
      for (const fn of [...exitReleases]) {
        try {
          fn();
        } catch {
        }
      }
      exitReleases.clear();
    });
  }
  return () => exitReleases.delete(release);
}
var AcquireTimeout = class extends Error {
  constructor(message) {
    super(message);
    this.name = "AcquireTimeout";
  }
};
function heartbeatFileFor(lockFile, token) {
  return `${lockFile}.hb-${token}`;
}
var CoordinatorLock = class {
  lockFile;
  auditFile;
  tuning;
  ownerBootId;
  onLost;
  held = null;
  heartbeatTimer = null;
  exitUnregister = null;
  constructor(lockFile, auditFile, opts = {}) {
    this.lockFile = lockFile;
    this.auditFile = auditFile;
    const { ownerBootId, onLost, ...tuning } = opts;
    this.tuning = { ...DEFAULT_LOCK_TUNING, ...tuning };
    this.ownerBootId = ownerBootId ?? bootId();
    this.onLost = onLost;
  }
  get info() {
    return this.held?.info ?? null;
  }
  get isHeld() {
    return this.held !== null;
  }
  get tuningOptions() {
    return { ...this.tuning };
  }
  /**
   * 抢锁（原子）：O_EXCL 创建 owner 文件即持有。已存在时——新鲜则等待重试，过期
   * （心跳龄 > expiryMs；不可解析按 mtime）则经 guard 复核后 quarantine 再重抢。
   * waitMs 内未获得 → AcquireTimeout（所有分支都受 deadline 约束）。
   */
  async acquire(opts = {}) {
    const waitMs = opts.waitMs ?? 0;
    const deadline = Date.now() + waitMs;
    const timeout = () => {
      throw new AcquireTimeout(`coordinator lock not acquired within ${waitMs}ms (holder alive)`);
    };
    for (; ; ) {
      const claimed = await this.tryClaim();
      if (claimed !== null) return claimed;
      const observed = this.observe();
      if (!observed.exists) {
        if (Date.now() >= deadline) timeout();
        await sleep(1);
        continue;
      }
      if (observed.ageMs > this.tuning.expiryMs) {
        this.steal(observed);
        continue;
      }
      if (Date.now() >= deadline) timeout();
      await sleep(Math.min(this.tuning.pollMs, Math.max(deadline - Date.now(), 1)));
    }
  }
  /** 续持：owner inode + token 双 CAS 通过后写心跳；被抢/丢失 → false（onLost 恰一次）。 */
  async renew() {
    const held = this.held;
    if (held === null) return false;
    const owner = this.readOwner();
    if (owner === null || owner.info.token !== held.token || owner.ino !== held.ino || owner.info.pid !== process.pid || owner.info.bootId !== this.ownerBootId) {
      this.markLost(owner?.info ?? held.info);
      return false;
    }
    const now2 = Date.now();
    try {
      this.writeHeartbeat(held.token, now2);
    } catch (err) {
      this.audit("renew-failed", { error: String(err) });
      this.markLost(owner.info);
      return false;
    }
    this.held = { ...held, info: { ...held.info, heartbeatAt: now2 } };
    return true;
  }
  /** 同步释放（exit handler 用；预算 ≤200ms）。只删 inode+token 均为自己的 owner 文件。 */
  releaseSync() {
    this.stopHeartbeat();
    if (this.exitUnregister !== null) {
      this.exitUnregister();
      this.exitUnregister = null;
    }
    const held = this.held;
    this.held = null;
    if (held === null) return;
    try {
      const fd = fs2.openSync(this.lockFile, "r");
      try {
        const stat = fs2.fstatSync(fd);
        if (stat.ino !== held.ino) {
          this.audit("release-skip", { reason: "inode-changed", expected: held.ino, actual: stat.ino });
          return;
        }
        const info = JSON.parse(fs2.readFileSync(fd, "utf8"));
        if (info.token !== held.token || info.pid !== process.pid || info.bootId !== this.ownerBootId) {
          this.audit("release-skip", { reason: "owner-changed", previous: info });
          return;
        }
      } finally {
        fs2.closeSync(fd);
      }
      if (fs2.statSync(this.lockFile).ino !== held.ino) {
        this.audit("release-skip", { reason: "inode-changed-before-unlink" });
        return;
      }
      fs2.unlinkSync(this.lockFile);
      this.audit("release", { via: "exit-handler" });
    } catch (err) {
      if (err.code === "ENOENT") return;
      this.audit("release-failed", { error: String(err) });
    } finally {
      this.removeHeartbeat(held.token);
    }
  }
  async release() {
    this.releaseSync();
  }
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.renew().catch(() => {
      });
    }, this.tuning.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }
  stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  /** 注册 exit handler（幂等）：进程退出时 best-effort 释放（单例监听器注册表）。 */
  installExitHandlers() {
    if (this.exitUnregister !== null) return;
    this.exitUnregister = registerExitRelease(() => this.releaseSync());
  }
  /** 观察锁文件（不抢）。ageMs：可解析 = now-heartbeatAt（优先 token 心跳）；否则 now-mtime。 */
  observe() {
    let raw;
    let stat;
    try {
      stat = fs2.statSync(this.lockFile);
      raw = fs2.readFileSync(this.lockFile, "utf8");
    } catch {
      return { exists: false, ageMs: Number.POSITIVE_INFINITY, parseable: false };
    }
    try {
      const info = JSON.parse(raw);
      if (typeof info.pid === "number" && typeof info.bootId === "string" && typeof info.heartbeatAt === "number") {
        let heartbeatAt = info.heartbeatAt;
        if (typeof info.token === "string") {
          const hb = this.readHeartbeat(info.token);
          if (hb !== void 0) heartbeatAt = hb;
        }
        return {
          exists: true,
          info,
          ageMs: Date.now() - heartbeatAt,
          parseable: true,
          ino: stat.ino
        };
      }
    } catch {
    }
    return { exists: true, ageMs: Date.now() - stat.mtimeMs, parseable: false, ino: stat.ino };
  }
  /** 审计痕迹（获取/释放/抢占/丢失；best-effort，无 fsync）。 */
  audit(event, detail) {
    if (this.auditFile === void 0) return;
    try {
      fs2.mkdirSync(path2.dirname(this.auditFile), { recursive: true });
      fs2.appendFileSync(
        this.auditFile,
        JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), event, pid: process.pid, bootId: this.ownerBootId, detail }) + "\n",
        { mode: 384 }
      );
    } catch {
    }
  }
  async tryClaim() {
    const now2 = Date.now();
    const token = crypto.randomBytes(12).toString("hex");
    const info = {
      pid: process.pid,
      bootId: this.ownerBootId,
      heartbeatAt: now2,
      acquiredAt: now2,
      token
    };
    let fd;
    try {
      fd = fs2.openSync(this.lockFile, "wx", 384);
    } catch (err) {
      if (err.code === "EEXIST") return null;
      throw err;
    }
    let ino;
    try {
      fs2.writeFileSync(fd, JSON.stringify(info));
      fs2.fsyncSync(fd);
      ino = fs2.fstatSync(fd).ino;
    } catch (err) {
      try {
        const stat = fs2.fstatSync(fd);
        if (stat.ino === fs2.statSync(this.lockFile).ino) fs2.unlinkSync(this.lockFile);
      } catch {
      }
      throw err;
    } finally {
      fs2.closeSync(fd);
    }
    this.held = { info, token, ino };
    try {
      this.writeHeartbeat(token, now2);
      this.cleanupForeignHeartbeats(token);
    } catch {
    }
    this.audit("acquire", { token: token.slice(0, 8), ino });
    return info;
  }
  readOwner() {
    try {
      const fd = fs2.openSync(this.lockFile, "r");
      try {
        const stat = fs2.fstatSync(fd);
        const info = JSON.parse(fs2.readFileSync(fd, "utf8"));
        return { info, ino: stat.ino };
      } finally {
        fs2.closeSync(fd);
      }
    } catch {
      return null;
    }
  }
  readHeartbeat(token) {
    try {
      const parsed = JSON.parse(fs2.readFileSync(heartbeatFileFor(this.lockFile, token), "utf8"));
      if (parsed.token === token && typeof parsed.heartbeatAt === "number") return parsed.heartbeatAt;
    } catch {
    }
    return void 0;
  }
  writeHeartbeat(token, at) {
    const file = heartbeatFileFor(this.lockFile, token);
    const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    try {
      fs2.writeFileSync(tmp, JSON.stringify({ token, heartbeatAt: at }), { mode: 384 });
      fs2.renameSync(tmp, file);
    } catch (err) {
      try {
        fs2.unlinkSync(tmp);
      } catch {
      }
      throw err;
    }
  }
  removeHeartbeat(token) {
    try {
      fs2.unlinkSync(heartbeatFileFor(this.lockFile, token));
    } catch {
    }
  }
  cleanupForeignHeartbeats(ownToken) {
    let names;
    try {
      names = fs2.readdirSync(path2.dirname(this.lockFile));
    } catch {
      return;
    }
    const prefix = `${path2.basename(this.lockFile)}.hb-`;
    for (const name of names) {
      if (!name.startsWith(prefix) || name === `${prefix}${ownToken}`) continue;
      try {
        fs2.unlinkSync(path2.join(path2.dirname(this.lockFile), name));
      } catch {
      }
    }
  }
  /**
   * 过期抢占：guard 单飞 → 重读复核 → rename 到 quarantine → 校验 inode。
   * 若 rename 到的不是观察到的 inode（竞争者刚换了新锁）→ 尝试归还并回滚。
   */
  steal(observed) {
    const guard = `${this.lockFile}.guard-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
    let guardFd;
    try {
      guardFd = fs2.openSync(guard, "wx", 384);
    } catch (err) {
      if (err.code === "EEXIST") return;
      throw err;
    }
    try {
      const current = this.observe();
      if (!current.exists || current.ageMs <= this.tuning.expiryMs) return;
      if (observed.ino === void 0 || current.ino !== observed.ino || current.info?.token !== observed.info?.token) {
        return;
      }
      const quarantine = `${this.lockFile}.stale-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      try {
        fs2.renameSync(this.lockFile, quarantine);
      } catch (err) {
        if (err.code === "ENOENT") return;
        throw err;
      }
      let quarantinedIno = null;
      try {
        quarantinedIno = fs2.statSync(quarantine).ino;
      } catch {
        quarantinedIno = null;
      }
      if (quarantinedIno !== current.ino) {
        try {
          fs2.linkSync(quarantine, this.lockFile);
          fs2.unlinkSync(quarantine);
          this.audit("steal-rollback", { reason: "inode-mismatch", quarantinedIno, expected: current.ino });
        } catch (rollbackErr) {
          this.audit("steal-rollback-failed", {
            reason: "inode-mismatch",
            quarantinedIno,
            expected: current.ino,
            error: String(rollbackErr),
            quarantine
          });
        }
        return;
      }
      this.audit("steal", {
        reason: current.parseable ? "heartbeat-expired" : "unparseable-and-aged",
        previous: current.info ?? { mtimeAgeMs: Math.round(current.ageMs) },
        quarantine
      });
      if (typeof current.info?.token === "string") this.removeHeartbeat(current.info.token);
    } finally {
      try {
        fs2.closeSync(guardFd);
      } catch {
      }
      try {
        fs2.unlinkSync(guard);
      } catch {
      }
    }
  }
  markLost(previous) {
    if (this.held === null) return;
    this.audit("lost", { previous });
    this.held = null;
    this.stopHeartbeat();
    this.onLost?.({ previous });
  }
};
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/coord/journal.ts
import fs5 from "node:fs";
import path4 from "node:path";

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
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const live = tasks.filter((t) => t.status !== "deleted");
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
function assertTaskGraphCandidate(existing, candidate) {
  const tasks = existing.some((t) => t.id === candidate.id) ? existing.map((t) => t.id === candidate.id ? candidate : t) : [...existing, candidate];
  try {
    validateTaskGraph(tasks);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("cannot block itself") || message.includes("task dependency cycle")) {
      throw new TeamError("TEAM_TASK_DEPENDENCY_CYCLE", message);
    }
    if (message.includes("repeats blocker")) {
      throw new TeamError("TEAM_INVALID_ARGUMENT", message);
    }
    if (message.includes("missing or deleted")) {
      throw new TeamError("TEAM_TASK_NOT_FOUND", message);
    }
    throw err;
  }
}
function dependencies(existingTasks, taskId, blockedBy) {
  const seen = /* @__PURE__ */ new Set();
  for (const bid of blockedBy) {
    if (bid === taskId) {
      throw new TeamError("TEAM_TASK_DEPENDENCY_CYCLE", "a team task cannot block itself", {
        cause: { taskId, blocker: bid }
      });
    }
    if (seen.has(bid)) {
      throw new TeamError("TEAM_INVALID_ARGUMENT", `duplicate blocker "${bid}"`, {
        cause: { taskId, blocker: bid }
      });
    }
    seen.add(bid);
    const blocker = existingTasks.find((t) => t.id === bid);
    if (blocker === void 0 || blocker.status === "deleted") {
      throw new TeamError("TEAM_TASK_NOT_FOUND", `blocker task "${bid}" not found`, {
        cause: { taskId, blocker: bid }
      });
    }
  }
}

// src/domain/task-view.ts
function taskReady(state, task) {
  return task.blockedBy.every((bid) => {
    const blocker = state.tasks.find((t) => t.id === bid);
    return blocker !== void 0 && blocker.status === "completed";
  });
}
function projectTaskView(state, task) {
  const view2 = {
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
    if (ownerName !== void 0) view2.ownerName = ownerName;
  }
  return view2;
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
  const prior = state.tasks.find((t) => t.id === task.id);
  const expectedRevision = prior === void 0 ? 1 : prior.revision + 1;
  if (task.revision !== expectedRevision) {
    return failed(
      state,
      prior === void 0 ? `team task "${task.id}" must begin at revision 1` : `team task "${task.id}" revision is not contiguous`
    );
  }
  const tasks = prior === void 0 ? [...state.tasks, task] : state.tasks.map((t) => t.id === task.id ? task : t);
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
    const tasks = state.tasks.filter((t) => t.status !== "deleted").map((t) => projectTaskView(state, t));
    entry = { healthy: { members, tasks } };
    byTasks.set(state.tasks, entry);
  }
  if (state.failure === void 0) return entry.healthy;
  if (entry.failed === void 0) {
    entry.failed = { ...entry.healthy, failure: state.failure };
  }
  return entry.failed;
}
function tryMembership(loadState, agentId) {
  let state;
  try {
    state = loadState();
  } catch {
    return void 0;
  }
  if (agentId === state.id) {
    return { rootId: state.id, role: "lead", name: "lead" };
  }
  const member = state.members.find((m) => m.id === agentId);
  if (member !== void 0 && (member.phase === "active" || member.phase === "provisioning")) {
    return { rootId: state.id, role: "teammate", name: member.name };
  }
  return void 0;
}
function requireMembership(loadState, agentId) {
  const membership = tryMembership(loadState, agentId);
  if (membership === void 0) {
    throw new TeamError(
      "TEAM_NOT_MEMBER",
      `agent "${agentId}" is not a member of an active Agent Team`
    );
  }
  return membership;
}
function projectionFailureError(failure) {
  return new Error(failure);
}

// src/domain/invariant.ts
function assertAppendable(teamId, committed, candidate) {
  let state = emptyTeamState(teamId);
  for (let i = 0; i < committed.length; i++) {
    const next = applyProjectionEvent(state, committed[i]);
    if (next.failure !== void 0) {
      throw new Error(
        `session event ${i + 1} violates the Agent Teams stream: ${next.failure}`
      );
    }
    state = next;
  }
  const withCandidate = applyProjectionEvent(state, candidate);
  if (withCandidate.failure !== void 0) {
    throw new Error(
      `session event ${committed.length + 1} violates the Agent Teams stream: ${withCandidate.failure}`
    );
  }
}

// src/coord/lockfile.ts
import fs3 from "node:fs";
function observeLockFileFor(lockFile, writer) {
  const identity = parseWriterId(writer);
  if (identity === void 0) {
    return { ok: false, reason: `writer id "${writer}" is malformed` };
  }
  let raw;
  try {
    raw = fs3.readFileSync(lockFile, "utf8");
  } catch (err) {
    return { ok: false, reason: `lock unreadable: ${err.code ?? String(err)}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "lock file is not valid JSON" };
  }
  if (parsed.pid !== identity.pid || parsed.bootId !== identity.bootId) {
    return {
      ok: false,
      reason: `lock held by pid=${String(parsed.pid)} bootId=${String(parsed.bootId)}`
    };
  }
  return { ok: true, reason: "owned" };
}

// src/coord/replay.ts
import fs4 from "node:fs";
import path3 from "node:path";
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
  return path3.join(teamDir, "checkpoint.json");
}
async function load(teamDir, teamId) {
  const startedAt = Date.now();
  const eventsFile = path3.join(teamDir, "events.jsonl");
  const raw = readBufferOrEmpty(eventsFile);
  let checkpointIgnored;
  let doc;
  try {
    const rawDoc = fs4.readFileSync(checkpointPath(teamDir), "utf8");
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
async function writeCheckpoint(teamDir, input) {
  const eventsFile = path3.join(teamDir, "events.jsonl");
  const byteOffset = input.byteOffset ?? countBytesOfLines(eventsFile, input.seq);
  const doc = {
    kind: "agent-team-checkpoint",
    stateVersion: TEAM_PROJECTION_STATE_VERSION,
    lastSeq: input.seq,
    lastOffset: byteOffset,
    savedAt: (/* @__PURE__ */ new Date()).toISOString(),
    state: input.state,
    view: input.view
  };
  fs4.mkdirSync(teamDir, { recursive: true, mode: 448 });
  const target = checkpointPath(teamDir);
  const tmp = `${target}.tmp-${process.pid}`;
  const fd = fs4.openSync(tmp, "w", 384);
  try {
    fs4.writeFileSync(fd, JSON.stringify(doc));
    fs4.fsyncSync(fd);
  } finally {
    fs4.closeSync(fd);
  }
  fs4.renameSync(tmp, target);
}
function readBufferOrEmpty(file) {
  try {
    return fs4.readFileSync(file);
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
function countBytesOfLines(eventsFile, seq) {
  const raw = readBufferOrEmpty(eventsFile);
  let offset = 0;
  for (let i = 0; i < seq; i++) {
    const nl = raw.indexOf(10, offset);
    if (nl === -1) return raw.length;
    offset = nl + 1;
  }
  return offset;
}

// src/coord/journal.ts
var TeamJournal = class _TeamJournal {
  teamDir;
  teamId;
  eventsFile;
  lockFile;
  opts;
  writer = null;
  appendFd = null;
  cache = null;
  committedCount = 0;
  bytesCommitted = 0;
  txTail = Promise.resolve();
  txDepth = 0;
  listeners = /* @__PURE__ */ new Set();
  static instances = /* @__PURE__ */ new Map();
  /** 进程内单例（同 teamDir+teamId 只允许一个实例，防同进程双写）。 */
  static open(teamDir, teamId, opts) {
    const key = `${teamDir}\0${teamId}`;
    const existing = _TeamJournal.instances.get(key);
    if (existing) return existing;
    const journal = new _TeamJournal(teamDir, teamId, opts);
    _TeamJournal.instances.set(key, journal);
    return journal;
  }
  constructor(teamDir, teamId, opts = {}) {
    this.teamDir = teamDir;
    this.teamId = teamId;
    this.eventsFile = path4.join(teamDir, "events.jsonl");
    this.lockFile = path4.join(teamDir, "coordinator.lock");
    this.opts = { maxLineBytes: 65536, checkpointEvery: 256, enforceLock: true, ...opts };
  }
  /**
   * 取得写权（协调者专用）：校验锁归属 + 冷启动全量/增量重放缓存状态 + 打开 O_APPEND 句柄。
   * 返回冷启动加载结果（含 checkpoint 命中信息）。
   */
  async openWriter(writer = writerId()) {
    if (this.opts.enforceLock) {
      const verdict = observeLockFileFor(this.lockFile, writer);
      if (!verdict.ok) {
        throw new Error(
          `journal writer requires the coordinator lock (${verdict.reason}; writer=${writer})`
        );
      }
    }
    const loaded = await load(this.teamDir, this.teamId);
    this.writer = writer;
    this.cache = loaded.state;
    this.committedCount = loaded.seq;
    fs5.mkdirSync(this.teamDir, { recursive: true, mode: 448 });
    this.appendFd = fs5.openSync(this.eventsFile, "a", 384);
    this.bytesCommitted = fs5.statSync(this.eventsFile).size;
    return loaded;
  }
  /** 追加前不变量 + 落盘 + fsync + 内存态推进 + 通知 + 应答。非法事件绝不落盘（硬断言）。 */
  appendAndFlush(candidate) {
    return this.enqueue(async () => {
      const seq = this.committedCount + 1;
      if (this.opts.enforceLock && this.writer !== null) {
        const verdict = observeLockFileFor(this.lockFile, this.writer);
        if (!verdict.ok) {
          throw new Error(`coordinator lock lost before append (${verdict.reason}; writer=${this.writer})`);
        }
      }
      if (this.cache === null) {
        const committed = (await readAllLines(this.eventsFile)).map((l) => l.event);
        assertAppendable(this.teamId, committed, candidate);
      }
      const prior = this.cache ?? emptyTeamState(this.teamId);
      const next = applyProjectionEvent(prior, candidate);
      if (next.failure !== void 0) {
        throw new Error(
          `session event ${seq} violates the Agent Teams stream: ${next.failure}`
        );
      }
      this.opts.crashHook?.("append:before", { seq });
      const ts2 = (/* @__PURE__ */ new Date()).toISOString();
      const line = { seq, ts: ts2, writer: this.writer ?? writerId(), event: candidate };
      const raw = JSON.stringify(line) + "\n";
      if (Buffer.byteLength(raw) > this.opts.maxLineBytes) {
        throw new Error(
          `journal line exceeds ${this.opts.maxLineBytes} bytes (seq ${seq})`
        );
      }
      if (this.appendFd === null) throw new Error("journal writer not open (call openWriter first)");
      const lineBytes = Buffer.byteLength(raw);
      fs5.writeSync(this.appendFd, raw);
      this.opts.crashHook?.("append:after", { seq });
      this.opts.crashHook?.("fsync:before", { seq });
      fs5.fsyncSync(this.appendFd);
      this.opts.crashHook?.("fsync:after", { seq });
      this.cache = next;
      this.committedCount = seq;
      this.bytesCommitted += lineBytes;
      this.opts.crashHook?.("ack:before", { seq });
      for (const listener of this.listeners) listener(line, next);
      void this.maybeCheckpoint(seq);
      return { seq, ts: ts2, state: next };
    });
  }
  /** 同 teamId 尾链串行（本实例事务队列；不同 team = 不同实例 = 可并发）。应答序 = 提交序。 */
  transact(op) {
    return this.enqueue(() => Promise.resolve(op()));
  }
  /** 只读读取器：全量读行（不持写句柄；非协调者可用）。 */
  async readAll() {
    return readAllLines(this.eventsFile);
  }
  onCommit(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  get committedSeq() {
    return this.committedCount;
  }
  get cachedState() {
    return this.cache;
  }
  async writeCheckpointNow() {
    if (this.cache === null) return;
    await writeCheckpoint(this.teamDir, {
      state: this.cache,
      view: teamProjectionView(this.cache),
      seq: this.committedCount,
      byteOffset: this.bytesCommitted
    });
  }
  async close() {
    if (this.appendFd !== null) {
      fs5.closeSync(this.appendFd);
      this.appendFd = null;
    }
    await this.writeCheckpointNow();
    _TeamJournal.instances.delete(`${this.teamDir}\0${this.teamId}`);
  }
  async maybeCheckpoint(seq) {
    if (this.opts.checkpointEvery <= 0) return;
    if (seq % this.opts.checkpointEvery !== 0) return;
    try {
      await this.writeCheckpointNow();
    } catch {
    }
  }
  /** 尾链入队：op 严格在前一事务完成后才开始；拒绝结果向调用方透传，不阻断后续事务。
   *  重入安全：当前已处于本实例事务的串行区内（txDepth>0）时直接执行（同 MemoryTeamStore 口径）。 */
  enqueue(op) {
    if (this.txDepth > 0) return this.runGuarded(op);
    const run = this.txTail.then(
      () => this.runGuarded(op),
      () => this.runGuarded(op)
    );
    this.txTail = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  async runGuarded(op) {
    this.txDepth += 1;
    try {
      return await op();
    } finally {
      this.txDepth -= 1;
    }
  }
};
async function readAllLines(eventsFile) {
  let raw;
  try {
    raw = fs5.readFileSync(eventsFile, "utf8");
  } catch {
    return [];
  }
  const lines = [];
  for (const chunk of raw.split("\n")) {
    if (chunk.length === 0) break;
    lines.push(JSON.parse(chunk));
  }
  return lines;
}

// src/coord/paths.ts
import { createHash } from "node:crypto";
import fs6 from "node:fs";
import path5 from "node:path";
import os2 from "node:os";
var MAX_SOCKET_PATH = 96;
function teamPaths(dataRoot, teamId) {
  const teamsRoot = path5.join(dataRoot, "teams");
  const teamDir = path5.join(teamsRoot, safeTeamId(teamId));
  return {
    dataRoot,
    teamId,
    teamDir,
    eventsFile: path5.join(teamDir, "events.jsonl"),
    checkpointFile: path5.join(teamDir, "checkpoint.json"),
    lockFile: path5.join(teamDir, "coordinator.lock"),
    auditFile: path5.join(teamDir, "coordinator.audit.jsonl"),
    socketCandidate: path5.join(teamDir, "coordinator.sock")
  };
}
function ensureTeamDir(paths) {
  fs6.mkdirSync(paths.teamDir, { recursive: true, mode: 448 });
  try {
    fs6.chmodSync(paths.teamDir, 448);
  } catch {
  }
  return paths.teamDir;
}
function safeTeamId(teamId) {
  const escaped = teamId.replace(/[^A-Za-z0-9._-]/g, (c) => "~" + c.codePointAt(0).toString(16));
  if (escaped === ".") return "~2e";
  if (escaped === "..") return "~2e2e";
  return escaped;
}
function resolveSocketPath(teamDir) {
  const candidate = path5.join(teamDir, "coordinator.sock");
  if (candidate.length <= MAX_SOCKET_PATH) {
    return { socketPath: candidate, fallback: false, registryFile: path5.join(teamDir, "socket.path") };
  }
  const hash = createHash("sha256").update(candidate).digest("hex").slice(0, 16);
  const tmpRoot = fs6.realpathSync(os2.tmpdir());
  const fallbackDir = path5.join(tmpRoot, "agent-team-sockets");
  fs6.mkdirSync(fallbackDir, { recursive: true, mode: 448 });
  try {
    fs6.chmodSync(fallbackDir, 448);
  } catch {
  }
  const fallbackPath = path5.join(fallbackDir, `at-${hash}.sock`);
  return { socketPath: fallbackPath, fallback: true, registryFile: path5.join(teamDir, "socket.path") };
}
function discoverSocketPath(teamDir) {
  const registryFile = path5.join(teamDir, "socket.path");
  try {
    const registered = fs6.readFileSync(registryFile, "utf8").trim();
    if (registered.length > 0) return registered;
  } catch {
  }
  return resolveSocketPath(teamDir).socketPath;
}
function writeSocketRegistry(teamDir, socketPath) {
  fs6.mkdirSync(teamDir, { recursive: true, mode: 448 });
  fs6.writeFileSync(path5.join(teamDir, "socket.path"), socketPath + "\n", { mode: 384 });
}
function removeSocketRegistryIf(teamDir, socketPath) {
  const file = path5.join(teamDir, "socket.path");
  try {
    const current = fs6.readFileSync(file, "utf8").trim();
    if (current !== socketPath) return;
  } catch {
    return;
  }
  try {
    fs6.unlinkSync(file);
  } catch {
  }
}

// src/coord/store-adapter.ts
var JournalTeamStore = class _JournalTeamStore {
  constructor(journalInstance, ownedLock) {
    this.journalInstance = journalInstance;
    this.ownedLock = ownedLock;
    this.journal = journalInstance;
  }
  journal;
  cached;
  unsubs = [];
  /** 冷启动加载信息（host readyInfo 用；open 时捕获）。 */
  lastLoad = null;
  /** 打开（含抢锁 + 冷启动重放 + O_APPEND 句柄）。 */
  static async open(dataRoot, teamId, opts = {}) {
    const paths = teamPaths(dataRoot, teamId);
    ensureTeamDir(paths);
    let lock = opts.lock;
    let owned = false;
    if (lock === void 0) {
      lock = new CoordinatorLock(paths.lockFile, paths.auditFile);
      await lock.acquire({ waitMs: opts.lockWaitMs ?? 3e4 });
      owned = true;
    }
    const journal = TeamJournal.open(paths.teamDir, teamId, opts.journal);
    const loaded = await journal.openWriter(writerId());
    const store = new _JournalTeamStore(journal, owned ? lock : void 0);
    store.lastLoad = { seq: loaded.seq, fromCheckpoint: loaded.fromCheckpoint };
    return store;
  }
  async append(event) {
    const result = await this.journal.appendAndFlush(event);
    this.cached = result.state;
    return result;
  }
  state() {
    if (this.cached === void 0) {
      const cached2 = this.journal.cachedState;
      if (cached2 === null) throw new Error("journal store not opened");
      this.cached = cached2;
    }
    return this.cached;
  }
  /** 已提交行号（= hello.stateRevision 的冻结语义：journal seq）。 */
  get committedSeq() {
    return this.journal.committedSeq;
  }
  transact(op) {
    return this.journal.transact(op);
  }
  onCommit(listener) {
    const adapted = (_entry, state) => {
      this.cached = state;
      listener(0, state);
    };
    const off = this.journal.onCommit(adapted);
    this.unsubs.push(off);
    return off;
  }
  /** 释放（自有锁则释放；journal close 落 checkpoint）。 */
  async close() {
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    await this.journal.close();
    await this.ownedLock?.release();
  }
};

// src/coord/rpc.ts
import net from "node:net";
import fs7 from "node:fs";
import path6 from "node:path";
import crypto2 from "node:crypto";
var COORDINATOR_UNAVAILABLE_MESSAGE = "Agent Teams coordinator is unavailable (between coordinators); retry the request shortly";
var SUN_PATH_LIMIT = 104;
var MAX_RPC_BUFFER_BYTES = 1 << 20;
function frameBudgetFor(maxMessageBytes) {
  return Math.max(MAX_RPC_BUFFER_BYTES, maxMessageBytes * 4);
}
var RpcServer = class {
  socketPath;
  server = null;
  socketIno = null;
  /** 活连接（close 时主动断开，防幽灵客户端阻塞关停）。 */
  clients = /* @__PURE__ */ new Set();
  handlers = /* @__PURE__ */ new Map();
  maxFrameBytes;
  token;
  nextId = 0;
  constructor(socketPath, opts = {}) {
    if (socketPath.length > SUN_PATH_LIMIT) {
      throw new Error(
        `unix socket path too long for macOS (sun_path \u2248${SUN_PATH_LIMIT}B, got ${socketPath.length}B): ${socketPath} \u2014 use resolveSocketPath() to fall back to a short /tmp path`
      );
    }
    this.socketPath = socketPath;
    this.maxFrameBytes = opts.maxFrameBytes ?? MAX_RPC_BUFFER_BYTES;
    this.token = opts.token;
  }
  register(method, handler, opts = {}) {
    this.handlers.set(method, { handler, timeoutMs: opts.timeoutMs });
    return this;
  }
  has(method) {
    return this.handlers.has(method);
  }
  async listen(opts = {}) {
    const callTimeoutMs = opts.callTimeoutMs ?? 1e4;
    if (fs7.existsSync(this.socketPath)) {
      const active = await probeActiveSocket(this.socketPath);
      if (active) {
        throw new Error(
          `rpc socket already in use by an active coordinator: ${this.socketPath} (refusing to replace it)`
        );
      }
      try {
        fs7.unlinkSync(this.socketPath);
      } catch {
      }
    }
    await new Promise((resolve, reject) => {
      const server2 = net.createServer((socket) => {
        this.clients.add(socket);
        const inflight = /* @__PURE__ */ new Set();
        socket.once("close", () => {
          this.clients.delete(socket);
          for (const controller of inflight) controller.abort();
          inflight.clear();
        });
        socket.setEncoding("utf8");
        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk;
          if (Buffer.byteLength(buffer, "utf8") > this.maxFrameBytes) {
            socket.destroy();
            return;
          }
          let nl;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 1);
            if (line.trim().length === 0) continue;
            let parsed;
            try {
              parsed = JSON.parse(line);
            } catch {
              socket.write(JSON.stringify({ id: -1, ok: false, error: { message: "invalid rpc frame" } }) + "\n");
              continue;
            }
            if (!this.authorized(parsed)) {
              const id = typeof parsed?.id === "number" ? parsed.id : -1;
              socket.write(JSON.stringify({ id, ok: false, error: { message: "unauthorized rpc frame" } }) + "\n");
              continue;
            }
            void this.dispatch(parsed, socket, callTimeoutMs, inflight);
          }
        });
        socket.on("error", () => socket.destroy());
      });
      server2.on("error", (err) => reject(err));
      server2.listen(this.socketPath, () => {
        this.server = server2;
        try {
          fs7.chmodSync(this.socketPath, 384);
          this.socketIno = fs7.statSync(this.socketPath).ino;
        } catch (err) {
          this.server = null;
          try {
            server2.close();
          } catch {
          }
          reject(
            new Error(
              `rpc socket hardening failed for ${this.socketPath}: ${err instanceof Error ? err.message : String(err)}`
            )
          );
          return;
        }
        resolve();
      });
    });
  }
  async close() {
    const server2 = this.server;
    if (server2 === null) return;
    this.server = null;
    const ino = this.socketIno;
    this.socketIno = null;
    for (const client of this.clients) {
      try {
        client.destroy();
      } catch {
      }
    }
    this.clients.clear();
    let preserve = null;
    if (ino !== null) {
      try {
        if (fs7.statSync(this.socketPath).ino !== ino) {
          const quarantine = `${this.socketPath}.preserve-${process.pid}-${crypto2.randomBytes(4).toString("hex")}`;
          fs7.renameSync(this.socketPath, quarantine);
          preserve = { quarantine };
        }
      } catch {
      }
    }
    await new Promise((resolve) => server2.close(() => resolve()));
    if (preserve !== null) {
      try {
        fs7.renameSync(preserve.quarantine, this.socketPath);
      } catch (err) {
        process.stderr.write(
          JSON.stringify({
            ts: (/* @__PURE__ */ new Date()).toISOString(),
            scope: "rpc",
            msg: "failed to restore preserved socket path",
            socketPath: this.socketPath,
            quarantine: preserve.quarantine,
            error: err instanceof Error ? err.message : String(err)
          }) + "\n"
        );
      }
    }
  }
  authorized(req) {
    if (this.token === void 0) return true;
    const provided = typeof req?.token === "string" ? req.token : "";
    const a = Buffer.from(provided);
    const b = Buffer.from(this.token);
    return a.length === b.length && crypto2.timingSafeEqual(a, b);
  }
  async dispatch(req, socket, callTimeoutMs, inflight) {
    const respond = (res) => {
      if (!socket.destroyed) socket.write(JSON.stringify(res) + "\n");
    };
    const id = typeof req?.id === "number" ? req.id : -1;
    const registered = this.handlers.get(req?.method);
    if (registered === void 0) {
      respond({ id, ok: false, error: { message: `unknown rpc method: ${String(req?.method)}` } });
      return;
    }
    const timeoutMs = registered.timeoutMs ?? callTimeoutMs;
    const abort = new AbortController();
    inflight.add(abort);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      respond({ id, ok: false, error: { message: `rpc method ${req.method} timed out after ${timeoutMs}ms` } });
      abort.abort();
    }, timeoutMs);
    try {
      const result = await registered.handler(req.params, {
        socketPath: this.socketPath,
        signal: abort.signal
      });
      if (!settled) {
        settled = true;
        respond({ id, ok: true, result });
      }
    } catch (err) {
      if (settled) return;
      if (isTeamError(err)) {
        respond({
          id,
          ok: false,
          error: { message: err.message, code: err.code, serialized: serializeTeamError(err) }
        });
      } else {
        respond({
          id,
          ok: false,
          error: { message: err instanceof Error ? err.message : String(err), name: err instanceof Error ? err.name : void 0 }
        });
      }
    } finally {
      clearTimeout(timer);
      inflight.delete(abort);
    }
  }
};
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
function probeActiveSocket(socketPath, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    let settled = false;
    const finish = (active) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(active);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    socket.once("connect", () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}
function rpcTokenPath(teamDir) {
  return path6.join(teamDir, "rpc.token");
}
function readRpcToken(teamDir) {
  try {
    const token = fs7.readFileSync(rpcTokenPath(teamDir), "utf8").trim();
    return token.length > 0 ? token : void 0;
  } catch {
    return void 0;
  }
}
function writeRpcToken(teamDir, token) {
  fs7.mkdirSync(teamDir, { recursive: true, mode: 448 });
  fs7.writeFileSync(rpcTokenPath(teamDir), token + "\n", { mode: 384 });
}
function newRpcToken() {
  return crypto2.randomBytes(24).toString("hex");
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

// src/provider/model-selection.ts
var DEFAULT_REASONING_LEVEL = "max";
function parseModelSelection(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return void 0;
  const record2 = value;
  const providerId = nonEmptyString(record2.providerId);
  const modelId = nonEmptyString(record2.modelId);
  if (providerId === void 0 || modelId === void 0) return void 0;
  const options = record2.options;
  if (options !== void 0 && (typeof options !== "object" || options === null || Array.isArray(options))) {
    return void 0;
  }
  let reasoningLevel;
  const rawLevel = options !== void 0 ? options.reasoningLevel : record2.reasoningLevel;
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

// src/coord/methods.ts
var TASK_ACTIONS = [
  "claim",
  "release",
  "edit",
  "set_dependencies",
  "complete",
  "reopen",
  "reassign",
  "delete"
];
var WAIT_AGENT_GRACE_MS = 5e3;
var METHOD_TIMEOUT_OVERRIDES = {
  "member.spawn": 18e4,
  "message.send": 3e4
};
function methodTimeoutMs(method) {
  return METHOD_TIMEOUT_OVERRIDES[method];
}
function buildTeamMethodTable(deps) {
  const { runtime, store } = deps;
  const table = /* @__PURE__ */ new Map();
  table.set("coordinator.hello", (raw) => {
    const p = asParams(raw, "coordinator.hello");
    assertTeamTarget(p, "coordinator.hello", deps);
    return {
      coordinatorBootId: deps.coordinatorBootId,
      stateRevision: store.committedSeq
    };
  });
  table.set("member.claim", (raw) => {
    const p = asParams(raw, "member.claim");
    assertTeamTarget(p, "member.claim", deps);
    const sessionId = requireSessionId(p, "member.claim");
    const membership = requireMembership(membershipStateLoader(store), sessionId);
    return { role: membership.role };
  });
  const memberSpawn = async (raw) => {
    const p = asParams(raw, "member.spawn");
    assertTeamTarget(p, "member.spawn", deps);
    const sessionId = requireSessionId(p, "member.spawn");
    const context = optionalString(p, "context", "member.spawn", { enum: ["fresh", "fork"] });
    return runtime.roster.spawnTeammate(sessionId, {
      // 空串下沉到域层：name → TEAM_INVALID_MEMBER_NAME；description → <field> must be non-empty。
      name: requireString(p, "name", "member.spawn", { allowEmpty: true }),
      description: requireString(p, "description", "member.spawn", { allowEmpty: true }),
      prompt: requireString(p, "prompt", "member.spawn", { allowEmpty: true }),
      ...context !== void 0 ? { context } : {}
    });
  };
  memberSpawn.timeoutMs = 18e4;
  table.set("member.spawn", memberSpawn);
  table.set("member.interrupt", async (raw) => {
    const p = asParams(raw, "member.interrupt");
    assertTeamTarget(p, "member.interrupt", deps);
    const sessionId = requireSessionId(p, "member.interrupt");
    const name = requireString(p, "name", "member.interrupt", { allowEmpty: true });
    return runtime.roster.interrupt(sessionId, name);
  });
  const messageSend = async (raw) => {
    const p = asParams(raw, "message.send");
    assertTeamTarget(p, "message.send", deps);
    const sessionId = requireSessionId(p, "message.send");
    const targetName = requireString(p, "targetName", "message.send", { allowEmpty: true });
    if (!Array.isArray(p.content)) {
      throw new TeamError("TEAM_INVALID_ARGUMENT", 'message.send param "content" must be an array of content blocks');
    }
    return runtime.mailbox.send(sessionId, { target: targetName, content: p.content });
  };
  messageSend.timeoutMs = 3e4;
  table.set("message.send", messageSend);
  table.set("mailbox.ack", async (raw) => {
    const p = asParams(raw, "mailbox.ack");
    assertTeamTarget(p, "mailbox.ack", deps);
    const sessionId = requireSessionId(p, "mailbox.ack");
    if (!Array.isArray(p.messageIds) || p.messageIds.some((id) => typeof id !== "string")) {
      throw new TeamError("TEAM_INVALID_ARGUMENT", 'mailbox.ack param "messageIds" must be an array of strings');
    }
    const messageIds = p.messageIds;
    const targetId = typeof p.targetId === "string" && p.targetId.length > 0 ? p.targetId : sessionId;
    for (const messageId of messageIds) {
      await runtime.mailbox.observeDelivery(targetId, messageId);
    }
    return { acknowledged: messageIds.length };
  });
  table.set("task.create", async (raw) => {
    const p = asParams(raw, "task.create");
    assertTeamTarget(p, "task.create", deps);
    const sessionId = requireSessionId(p, "task.create");
    const blockedBy = optionalStringArray(p, "blockedBy", "task.create");
    const writeScopes2 = optionalStringArray(p, "writeScopes", "task.create");
    return runtime.taskboard.create(sessionId, {
      subject: requireString(p, "subject", "task.create", { allowEmpty: true }),
      description: requireString(p, "description", "task.create", { allowEmpty: true }),
      ...blockedBy !== void 0 ? { blockedBy } : {},
      ...writeScopes2 !== void 0 ? { writeScopes: writeScopes2 } : {}
    });
  });
  table.set("task.update", async (raw) => {
    const p = asParams(raw, "task.update");
    assertTeamTarget(p, "task.update", deps);
    const sessionId = requireSessionId(p, "task.update");
    const action = requireString(p, "action", "task.update");
    if (!TASK_ACTIONS.includes(action)) {
      throw new TeamError(
        "TEAM_INVALID_ARGUMENT",
        `task.update param "action" must be one of ${TASK_ACTIONS.join(", ")}`
      );
    }
    const expectedRevision = p.expectedRevision;
    if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision)) {
      throw new TeamError("TEAM_INVALID_ARGUMENT", 'task.update param "expectedRevision" must be a safe integer');
    }
    const subject = optionalString(p, "subject", "task.update", { allowEmpty: true });
    const description = optionalString(p, "description", "task.update", { allowEmpty: true });
    const blockedBy = optionalStringArray(p, "blockedBy", "task.update");
    const writeScopes2 = optionalStringArray(p, "writeScopes", "task.update");
    const owner = optionalString(p, "owner", "task.update", { allowEmpty: true });
    return runtime.taskboard.update(sessionId, {
      taskId: requireString(p, "taskId", "task.update", { allowEmpty: true }),
      expectedRevision,
      action,
      ...subject !== void 0 ? { subject } : {},
      ...description !== void 0 ? { description } : {},
      ...blockedBy !== void 0 ? { blockedBy } : {},
      ...writeScopes2 !== void 0 ? { writeScopes: writeScopes2 } : {},
      ...owner !== void 0 ? { owner } : {}
    });
  });
  table.set("task.list", (raw) => {
    const p = asParams(raw, "task.list");
    assertTeamTarget(p, "task.list", deps);
    const sessionId = requireSessionId(p, "task.list");
    const status = optionalString(p, "status", "task.list");
    const owner = optionalString(p, "owner", "task.list");
    return runtime.taskboard.list(sessionId, {
      ...status !== void 0 ? { status } : {},
      ...owner !== void 0 ? { owner } : {},
      ...typeof p.ready === "boolean" ? { ready: p.ready } : {},
      ...typeof p.cursor === "number" ? { cursor: p.cursor } : {},
      ...typeof p.limit === "number" ? { limit: p.limit } : {}
    });
  });
  table.set("task.get", (raw) => {
    const p = asParams(raw, "task.get");
    assertTeamTarget(p, "task.get", deps);
    const sessionId = requireSessionId(p, "task.get");
    return runtime.taskboard.get(sessionId, requireString(p, "taskId", "task.get", { allowEmpty: true }));
  });
  table.set("board.read", (raw) => {
    const p = asParams(raw, "board.read");
    assertTeamTarget(p, "board.read", deps);
    const sessionId = typeof p.session_id === "string" ? p.session_id : void 0;
    if (sessionId !== void 0) {
      requireMembership(membershipStateLoader(store), sessionId);
    }
    return { revision: store.committedSeq, view: teamProjectionView(store.state()) };
  });
  const waitAgent = async (raw, ctx) => {
    const p = asParams(raw, "wait.agent");
    assertTeamTarget(p, "wait.agent", deps);
    const sessionId = requireSessionId(p, "wait.agent");
    const timeoutMs = typeof p.timeoutMs === "number" ? p.timeoutMs : 3e4;
    return runtime.activity.waitForChange(sessionId, timeoutMs, ctx?.signal);
  };
  waitAgent.timeoutMs = 36e5 + WAIT_AGENT_GRACE_MS;
  table.set("wait.agent", waitAgent);
  table.set("admin.reconcile", (raw) => {
    const p = asParams(raw, "admin.reconcile");
    assertTeamTarget(p, "admin.reconcile", deps);
    return runtime.roster.reconcileProvisioning();
  });
  return table;
}
function registerTeamMethods(server2, table) {
  for (const [method, handler] of table) {
    server2.register(
      method,
      (params, ctx) => handler(params, ctx),
      handler.timeoutMs !== void 0 ? { timeoutMs: handler.timeoutMs } : {}
    );
  }
  return server2;
}
async function invokeTeamMethod(table, method, params, ctx) {
  const handler = table.get(method);
  if (handler === void 0) {
    throw new Error(`unknown rpc method: ${method}`);
  }
  return handler(params, ctx);
}
function membershipStateLoader(store) {
  return () => {
    const state = store.state();
    if (state.failure !== void 0) throw projectionFailureError(state.failure);
    return state;
  };
}
function asParams(raw, method) {
  if (raw === void 0 || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new TeamError("TEAM_INVALID_ARGUMENT", `${method} params must be an object`);
  }
  return raw;
}
function assertTeamTarget(p, method, deps) {
  if (p.teamId !== void 0 && p.teamId !== deps.teamId) {
    throw new Error(
      `rpc method ${method} targets team ${JSON.stringify(p.teamId)} but this coordinator serves ${JSON.stringify(deps.teamId)}`
    );
  }
}
function requireSessionId(p, method) {
  const v = p.session_id;
  if (typeof v !== "string" || v.length === 0) {
    throw new TeamError("TEAM_INVALID_ARGUMENT", `${method} param "session_id" is required`);
  }
  return v;
}
function requireString(p, key, method, opts = {}) {
  const v = p[key];
  if (typeof v !== "string" || !opts.allowEmpty && v.length === 0) {
    throw new TeamError(
      "TEAM_INVALID_ARGUMENT",
      `${method} param "${key}" must be a${opts.allowEmpty ? " string" : " non-empty string"}`
    );
  }
  return v;
}
function optionalString(p, key, method, opts = {}) {
  const v = p[key];
  if (v === void 0) return void 0;
  if (typeof v !== "string" || !opts.allowEmpty && v.length === 0) {
    throw new TeamError(
      "TEAM_INVALID_ARGUMENT",
      `${method} param "${key}" must be a${opts.allowEmpty ? " string" : " non-empty string"}`
    );
  }
  if (opts.enum !== void 0 && !opts.enum.includes(v)) {
    throw new TeamError("TEAM_INVALID_ARGUMENT", `${method} param "${key}" must be one of ${opts.enum.join(", ")}`);
  }
  return v;
}
function optionalStringArray(p, key, method) {
  const v = p[key];
  if (v === void 0) return void 0;
  if (!Array.isArray(v) || v.some((item) => typeof item !== "string")) {
    throw new TeamError("TEAM_INVALID_ARGUMENT", `${method} param "${key}" must be an array of strings`);
  }
  return v;
}

// src/domain/lifecycle.ts
var TeamLifecycle = class {
  constructor(deps) {
    this.deps = deps;
  }
  phase = "open";
  abort = new AbortController();
  inflight = /* @__PURE__ */ new Set();
  disposeRun;
  get status() {
    return this.phase;
  }
  requireOpen() {
    if (this.phase !== "open") {
      throw new TeamError("TEAM_DISPOSED", "Agent Teams service is disposing");
    }
  }
  runtimeSignal() {
    return this.abort.signal;
  }
  track(p) {
    this.inflight.add(p);
    void p.finally(() => {
      this.inflight.delete(p);
    }).catch(() => void 0);
    return p;
  }
  /** dispose(reason)：D9 抽象触发；幂等（重复调用等首次结果）。 */
  dispose(reason) {
    this.disposeRun ??= this.runDispose();
    return this.disposeRun;
  }
  async runDispose() {
    const failures = [];
    this.phase = "disposing";
    this.abort.abort(new TeamError("TEAM_DISPOSED", "Agent Teams service disposed"));
    this.deps.closeWaiters?.();
    const clock = this.deps.clock ?? defaultClock;
    const settle = Promise.allSettled([...this.inflight]);
    let settled = [];
    const timedOut = await Promise.race([
      settle.then((results) => {
        settled = results;
        return false;
      }),
      clock.sleep(this.deps.disposalTimeoutMs).then(() => true)
    ]);
    for (const entry of settled) {
      if (entry.status === "rejected" && !isCancellation(entry.reason)) failures.push(entry.reason);
    }
    if (timedOut) {
      failures.push(
        new TeamError(
          "TEAM_DISPOSAL_TIMEOUT",
          `Agent Teams runtime disposal exceeded ${this.deps.disposalTimeoutMs}ms`
        )
      );
    }
    try {
      await this.deps.drainer({ timeoutMs: this.deps.disposalTimeoutMs });
    } catch (err) {
      if (!isCancellation(err)) failures.push(err);
    }
    this.phase = "closed";
    if (failures.length > 0) {
      throw new AggregateError(failures, "Agent Teams runtime disposal failed");
    }
  }
};
var defaultClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};
function isCancellation(err) {
  let current = err;
  for (let depth = 0; depth < 8 && current !== void 0 && current !== null; depth++) {
    if (isTeamError(current) && current.code === "TEAM_DISPOSED") return true;
    if (current instanceof AggregateError && current.errors.length > 0) {
      if (current.errors.every((e) => isCancellation(e))) return true;
    }
    current = current.cause;
  }
  return false;
}

// src/domain/ports.ts
var realClock = {
  now: () => Date.now(),
  sleep: (ms, signal) => new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  })
};
function errorMessage(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0] ?? message;
}

// src/domain/activity.ts
var TeamActivity = class {
  constructor(deps) {
    this.deps = deps;
    this.clock = deps.clock ?? realClock;
  }
  waiters = /* @__PURE__ */ new Set();
  closed = false;
  clock;
  unsubscribeCommit;
  /** 接线：Team 日志提交边（由 runtime/装配调用；每提交唤醒全部已注册等待者一次）。 */
  bindCommitEdge() {
    this.unsubscribeCommit?.();
    this.unsubscribeCommit = this.deps.store.onCommit(() => this.wakeAll());
    return () => this.unsubscribeCommit?.();
  }
  /** 接线：成员状态变化边（roster.onMemberStatus → 此处）。 */
  notifyMemberStatus() {
    this.wakeAll();
  }
  /** 处置：唤醒全部等待者并关闭准入（新等待立即返回 { timedOut:false }）。 */
  closeAll() {
    this.closed = true;
    this.wakeAll();
  }
  /** §8 waitForChange。 */
  async waitForChange(callerId, timeoutMs = 3e4, signal) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1e4 || timeoutMs > 36e5) {
      throw new TeamError(
        "TEAM_INVALID_TIMEOUT",
        "timeoutMs must be an integer from 10000 through 3600000"
      );
    }
    signal?.throwIfAborted();
    if (this.closed) return { timedOut: false };
    requireMembership(() => this.loadState(), callerId);
    return new Promise((resolve, reject) => {
      const sleepAbort = new AbortController();
      const waiter = {
        wake: () => {
          cleanup();
          resolve({ timedOut: false });
        }
      };
      const onAbort = () => {
        cleanup();
        const reason = signal?.reason;
        if (reason instanceof Error) reject(reason);
        else
          reject(
            new TeamError("TEAM_WAIT_ABORTED", `wait_agent aborted: ${errorMessage(reason)}`)
          );
      };
      const cleanup = () => {
        if (settled) return;
        this.waiters.delete(waiter);
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        sleepAbort.abort();
      };
      let settled = false;
      this.waiters.add(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
      void this.clock.sleep(timeoutMs, sleepAbort.signal).then(() => {
        if (settled) return;
        cleanup();
        resolve({ timedOut: true });
      });
    });
  }
  wakeAll() {
    const current = [...this.waiters];
    this.waiters.clear();
    for (const waiter of current) waiter.wake();
  }
  loadState() {
    const state = this.deps.store.state();
    if (state.failure !== void 0) throw new Error(state.failure);
    return state;
  }
};

// src/domain/validation.ts
function requiredText(field, value, maxLen) {
  if (typeof value !== "string") {
    throw new TeamError("TEAM_INVALID_ARGUMENT", `${field} must be non-empty`, { cause: { field } });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TeamError("TEAM_INVALID_ARGUMENT", `${field} must be non-empty`, { cause: { field } });
  }
  if (trimmed.length > maxLen) {
    throw new TeamError("TEAM_INVALID_ARGUMENT", `${field} exceeds ${maxLen} characters`, {
      cause: { field, length: trimmed.length }
    });
  }
  return trimmed;
}
function writeScope(scope) {
  if (typeof scope !== "string") {
    throw invalidWriteScope(scope);
  }
  let s = scope.replace(/\\/g, "/");
  while (s.startsWith("./")) s = s.slice(2);
  while (s.endsWith("/")) s = s.slice(0, -1);
  if (s.length === 0) throw invalidWriteScope(scope);
  if (s.startsWith("/")) throw invalidWriteScope(scope);
  if (/^[a-z]:/i.test(s)) throw invalidWriteScope(scope);
  for (const segment of s.split("/")) {
    if (segment.length === 0 || segment === "." || segment === "..") throw invalidWriteScope(scope);
  }
  return s;
}
function writeScopes(list) {
  if (!Array.isArray(list)) {
    throw new TeamError("TEAM_INVALID_ARGUMENT", "write_scopes must be an array");
  }
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const scope of list) {
    const normalized = writeScope(scope);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}
function invalidWriteScope(scope) {
  return new TeamError(
    "TEAM_INVALID_WRITE_SCOPE",
    `invalid workspace-relative write scope ${JSON.stringify(scope)}`,
    { cause: { scope } }
  );
}

// src/provider/model-inheritance.ts
var ModelInheritanceError = class extends Error {
  constructor(message, selection) {
    super(message);
    this.selection = selection;
    this.name = "ModelInheritanceError";
  }
};
var ModelSyncSuppressedError = class extends ModelInheritanceError {
  constructor(message, selection) {
    super(message, selection);
    this.name = "ModelSyncSuppressedError";
  }
};
function providerHasModelPreflight(provider) {
  return typeof provider.preflightMemberModel === "function";
}
function selectionSignature(selection) {
  return `${selection.providerId}$${selection.modelId}$${selection.reasoningLevel ?? ""}`;
}
function classifyApplyFailure(reason) {
  return /^Command failed:|timeout|did not become ready|timed out|spawn|exited|ENOENT|EACCES|ECONNREFUSED|EPIPE|socket hang up|client (is )?closed/i.test(
    reason
  ) ? "transient" : "deterministic";
}
function classifySelectionFailure(message) {
  return /无法确定 Lead 当前模型/.test(message) ? "transient" : "deterministic";
}

// src/domain/roster.ts
var NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var TeamRoster = class {
  constructor(deps) {
    this.deps = deps;
    this.recoveryDone = this.reconcileProvisioning().then(
      () => void 0,
      () => void 0
    );
  }
  statusListeners = /* @__PURE__ */ new Set();
  recoveryDone;
  /** 成员状态变化边（Activity 唤醒源之二；settle/interrupt 后触发）。 */
  onMemberStatus(listener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }
  /** 外部状态变化通知（stage-4：provider 轮次边界 → Activity 唤醒；F13 ≤1s 路径）。 */
  notifyStatusChanged() {
    this.notifyStatus();
  }
  /** C5 服务层落点：投影 failure → 一切调用 TEAM_NOT_MEMBER。 */
  loadState() {
    const state = this.deps.store.state();
    if (state.failure !== void 0) throw new Error(state.failure);
    return state;
  }
  requireMember(callerId) {
    const membership = requireMembership(() => {
      const state = this.loadState();
      if (state.failure !== void 0) throw new Error(state.failure);
      return state;
    }, callerId);
    return { state: this.loadState(), name: membership.name };
  }
  // ---------------------------------------------------------------- spawn（§5.3）
  async spawnTeammate(callerId, args) {
    return this.deps.lifecycle.track(this.spawnInner(callerId, args));
  }
  async spawnInner(callerId, args) {
    const { state } = this.requireMember(callerId);
    this.deps.lifecycle.requireOpen();
    if (callerId !== state.id) {
      throw new TeamError("TEAM_LEAD_REQUIRED", "only the Team Lead can create teammates");
    }
    const name = args.name;
    if (typeof name !== "string" || name.length > 64 || name === "lead" || !NAME_PATTERN.test(name)) {
      throw new TeamError(
        "TEAM_INVALID_MEMBER_NAME",
        'teammate name must be lower-kebab-case, at most 64 characters, and not "lead"'
      );
    }
    const description = requiredText("description", args.description, 200);
    const providers = this.deps.providers ?? { fresh: "spawn", fork: "fork" };
    const context = args.context ?? "fresh";
    const providerName = requiredText("provider", context === "fork" ? providers.fork : providers.fresh, 200);
    const childId = (this.deps.newId ?? defaultNewId)();
    await this.deps.store.transact(async () => {
      const fresh = this.loadState();
      if (fresh.members.some((m) => m.name === name)) {
        throw new TeamError("TEAM_MEMBER_NAME_TAKEN", `teammate name "${name}" was already used in this Team`);
      }
      if (fresh.members.length >= this.deps.limits.maxMembers) {
        throw new TeamError("TEAM_MEMBER_LIMIT", `Team member limit ${this.deps.limits.maxMembers} reached`);
      }
      if (providerHasModelPreflight(this.deps.provider)) {
        this.deps.provider.preflightMemberModel();
      }
      await this.deps.store.append({
        type: "team/member",
        version: 2,
        teamId: this.deps.teamId,
        member: memberSnapshotOf(childId, name, description, providerName, context, "provisioning")
      });
    });
    const run = (async () => {
      const signal = combineSignals(args.signal, this.deps.lifecycle.runtimeSignal());
      try {
        return await this.deps.provider.startContinuable({
          teamId: this.deps.teamId,
          memberId: childId,
          name,
          description,
          firstPrompt: args.prompt,
          // 对齐轮：0.2.1 初始任务不含身份前缀
          context,
          signal
        });
      } catch (err) {
        throw this.mapAbortToDisposed(err);
      }
    })();
    try {
      const started = await run;
      if (started.memberId !== childId) {
        throw new Error(`provider returned memberId ${started.memberId} != provisioned ${childId}`);
      }
      if (!started.accepted) {
        throw new TeamError(
          "TEAM_PROVISIONING_CONFLICT",
          `teammate "${childId}" initial prompt was not durably accepted`
        );
      }
      const settled = await this.settleProvisioning(childId, "active");
      if (settled === "failed") {
        const conflict = new TeamError(
          "TEAM_PROVISIONING_CONFLICT",
          `teammate "${name}" was reconciled as failed while creation was in progress`
        );
        try {
          await this.deps.provider.interrupt({ memberId: childId });
        } catch (cleanupError) {
          throw new AggregateError([conflict, cleanupError], "provisioning conflict cleanup failed");
        }
        throw conflict;
      }
      this.notifyStatus();
      return { member: this.rowOf(childId) };
    } catch (originalError) {
      let becameActiveConflict;
      let recordError;
      let recordErrorSet = false;
      try {
        const settled = await this.settleProvisioning(childId, "failed", errorMessage(originalError));
        if (settled === "active") {
          becameActiveConflict = new TeamError(
            "TEAM_PROVISIONING_CONFLICT",
            `teammate "${name}" became active while its creator reported failure`
          );
        }
      } catch (err) {
        recordError = err;
        recordErrorSet = true;
      }
      if (becameActiveConflict !== void 0) {
        this.notifyStatus();
        throw becameActiveConflict;
      }
      if (recordErrorSet) {
        throw new AggregateError(
          [originalError, recordError],
          "teammate creation and durable failure recording both failed"
        );
      }
      try {
        await this.deps.provider.interrupt({ memberId: childId });
      } catch (cleanupError) {
        throw new AggregateError(
          [originalError, cleanupError],
          "teammate creation and durable failure recording both failed"
        );
      }
      this.notifyStatus();
      throw originalError;
    }
  }
  /** settleProvisioning（幂等）：已非 provisioning → 返回现有相位不追加；成员消失 → C1 冲突。 */
  settleProvisioning(memberId, phase, error2) {
    return this.deps.store.transact(async () => {
      const state = this.loadState();
      const member = state.members.find((m) => m.id === memberId);
      if (member === void 0) {
        throw new TeamError("TEAM_PROVISIONING_CONFLICT", `provisioned teammate "${memberId}" disappeared`);
      }
      if (member.phase !== "provisioning") return member.phase;
      const next = error2 !== void 0 ? { ...member, phase, error: error2 } : { ...member, phase };
      await this.deps.store.append({
        type: "team/member",
        version: 2,
        teamId: this.deps.teamId,
        member: next
      });
      return phase;
    });
  }
  // ---------------------------------------------------------------- 恢复对账（§5.4）
  /** 对每个 provisioning 且不存活的成员执行四条件对账；C3：恢复自身抛错仅警告。
   *  返回摘要（第四轮最小扩展）：orphans = 本轮识别的失联成员；settled = 本轮定案者
   *  （active/failed 任一去向；幂等竞态下相位已被他方定案也计入——结局已持久）。 */
  async reconcileProvisioning() {
    const state = this.loadState();
    const pending = state.members.filter(
      (m) => m.phase === "provisioning" && !this.deps.inspector.isAlive(m.id)
    );
    const orphans = pending.map((m) => m.id);
    const settled = [];
    for (const member of pending) {
      try {
        let failure;
        let active = false;
        try {
          const record2 = this.deps.recon.readProvisioningRecord(member.id);
          if (record2 === void 0) {
            failure = "provisioning did not leave a resumable child Session";
          } else if (record2.rootSessionId === this.deps.teamId && record2.descriptor !== void 0 && record2.descriptor.mode === "continuable" && record2.descriptor.provider === member.provider && record2.initialUserMessageAccepted) {
            active = true;
          } else {
            failure = "persisted child Session does not match the provisioned continuation";
          }
        } catch (err) {
          failure = `child Session recovery failed: ${errorMessage(err)}`;
        }
        await this.settleProvisioning(member.id, active ? "active" : "failed", failure);
        settled.push(member.id);
        this.notifyStatus();
      } catch (err) {
        this.deps.warn?.(
          `Agent Teams recovery for "${member.id}" failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    return { orphans, settled };
  }
  // ---------------------------------------------------------------- listMembers（§5.5）
  listMembers(callerId) {
    this.requireMember(callerId);
    const state = this.loadState();
    const presentation = this.deps.presentation;
    const leadModel = presentation?.leadModelOf?.() ?? this.deps.leadModel;
    const rows = [
      {
        target: "lead",
        role: "lead",
        // availability(root)：Lead 调用方视角恒 running；teammate 视角无法观测宿主 Lead 回合，
        // 保守呈 inactive（D19 登记）。此前恒 running 会让 teammate 的 noProgress 捷径失效。
        status: callerId === state.id ? "running" : "inactive",
        ...leadModel !== void 0 ? { model: leadModel } : {},
        diagnostics: []
      }
    ];
    for (const member of state.members) {
      const status = member.phase === "failed" ? "failed" : member.phase === "provisioning" ? "provisioning" : presentation ? presentation.statusOf(member.id) : this.deps.inspector.isAlive(member.id) ? "running" : "inactive";
      const model = presentation?.modelOf(member.id) ?? this.deps.leadModel;
      const extraDiagnostics = presentation?.diagnosticsOf?.(member.id) ?? [];
      const diagnostics = [
        ...member.error !== void 0 ? [member.error] : [],
        ...extraDiagnostics
      ];
      rows.push({
        target: member.name,
        role: "teammate",
        status,
        description: member.description,
        provider: member.provider,
        context: member.context,
        ...model !== void 0 ? { model } : {},
        diagnostics
      });
    }
    return { members: rows };
  }
  // ---------------------------------------------------------------- interrupt（§5.6）
  async interrupt(callerId, rawName) {
    const { state } = this.requireMember(callerId);
    if (callerId !== state.id) {
      throw new TeamError("TEAM_LEAD_REQUIRED", "only the Team Lead can interrupt teammates");
    }
    const name = rawName.trim();
    if (name === "lead") {
      throw new TeamError("TEAM_INVALID_TARGET", "the Team Lead cannot interrupt itself");
    }
    const target = state.members.find((m) => m.name === name && m.phase === "active");
    if (target === void 0) {
      throw new TeamError("TEAM_MEMBER_NOT_FOUND", `active teammate "${name}" not found`);
    }
    if (!this.deps.inspector.isAlive(target.id)) {
      return { previousStatus: "inactive" };
    }
    const result = await this.deps.provider.interrupt({ memberId: target.id });
    this.notifyStatus();
    return result;
  }
  // ---------------------------------------------------------------- 内部
  /** C2③：checkpoint 等待被非 Error reason 中止 → TEAM_DISPOSED `teammate creation aborted: <msg>`。 */
  mapAbortToDisposed(err) {
    if (err instanceof Error) return err;
    return new TeamError("TEAM_DISPOSED", `teammate creation aborted: ${errorMessage(err)}`);
  }
  rowOf(memberId) {
    const rows = this.listMembers(this.deps.teamId).members;
    const row = rows.find((r) => r.target === this.nameOf(memberId));
    if (row === void 0) throw new Error(`member row missing for ${memberId}`);
    return row;
  }
  nameOf(memberId) {
    const member = this.loadState().members.find((m) => m.id === memberId);
    return member?.name ?? "";
  }
  notifyStatus() {
    for (const listener of this.statusListeners) listener();
  }
};
function memberSnapshotOf(id, name, description, provider, context, phase, error2) {
  return { id, name, description, provider, context, phase, ...error2 !== void 0 ? { error: error2 } : {} };
}
function defaultNewId() {
  return globalThis.crypto.randomUUID();
}
function combineSignals(a, b) {
  if (a === void 0) return b;
  return AbortSignal.any([a, b]);
}

// src/domain/mailbox.ts
function resolveActiveMember(state, teamId, rawName) {
  const name = rawName.trim();
  if (name === "lead") return { id: teamId, name: "lead" };
  const member = state.members.find((m) => m.name === name && m.phase === "active");
  if (member === void 0) {
    throw new TeamError("TEAM_MEMBER_NOT_FOUND", `active teammate "${name}" not found`);
  }
  return { id: member.id, name: member.name };
}
function frameMessage(message) {
  return [
    { type: "text", text: `Team message from ${message.senderName}:` },
    ...message.content
  ];
}
function utf8Bytes(text) {
  return new TextEncoder().encode(text).length;
}
var TeamMailbox = class {
  constructor(deps) {
    this.deps = deps;
  }
  targetChains = /* @__PURE__ */ new Map();
  inflight = /* @__PURE__ */ new Map();
  /** send（对齐轮修订）：校验 → pending 落盘 flush（先于任何投递尝试）→ tryDispatch 同步发起（B6）。 */
  async send(callerId, args) {
    return this.deps.lifecycle.track(this.sendInner(callerId, args));
  }
  async sendInner(callerId, args) {
    const membership = requireMembership(() => this.loadState(), callerId);
    this.deps.lifecycle.requireOpen();
    let messageId;
    let dispatch2;
    await this.deps.store.transact(async () => {
      const state = this.loadState();
      const target = resolveActiveMember(state, this.deps.teamId, args.target);
      if (target.id === callerId) {
        throw new TeamError("TEAM_SELF_MESSAGE", "a Team member cannot message itself");
      }
      const id = `team-message-${(this.deps.newId ?? defaultNewId2)()}`;
      const snapshot = {
        id,
        senderId: callerId,
        senderName: membership.name,
        targetId: target.id,
        content: structuredClone(args.content)
      };
      const framed = frameMessage(snapshot);
      const bytes = utf8Bytes(JSON.stringify(framed));
      if (bytes > this.deps.limits.maxMessageBytes) {
        throw new TeamError("TEAM_MESSAGE_TOO_LARGE", `team message exceeds ${this.deps.limits.maxMessageBytes} bytes`);
      }
      await this.deps.store.append({
        type: "team/message/queued",
        version: 2,
        teamId: this.deps.teamId,
        message: snapshot
      });
      messageId = id;
      dispatch2 = this.tryDispatch(snapshot);
    });
    const outcome = await dispatch2;
    if (outcome.status === "rejected") {
      throw new Error(
        `team message could not be delivered to "${args.target}": ${outcome.reason ?? "unknown delivery failure"}`
      );
    }
    return {
      messageId,
      status: outcome.status,
      ...outcome.reason !== void 0 ? { reason: outcome.reason } : {}
    };
  }
  /** C5 服务层落点。 */
  loadState() {
    const state = this.deps.store.state();
    if (state.failure !== void 0) throw new Error(state.failure);
    return state;
  }
  pendingCount(state, targetId) {
    const deliveredIds = new Set(state.delivered);
    return state.messages.filter((m) => m.targetId === targetId && !deliveredIds.has(m.id)).length;
  }
  /** 目标的全部 pending（队列序）。 */
  pendingFor(state, targetId) {
    const deliveredIds = new Set(state.delivered);
    return state.messages.filter((m) => m.targetId === targetId && !deliveredIds.has(m.id));
  }
  // ---------------------------------------------------------------- 投递（§6.3）
  /** 单消息入口：in-flight 去重 + C10 短路 + 按目标串行（dispatchThrough）。 */
  tryDispatch(message) {
    const state = this.loadState();
    if (!this.pendingFor(state, message.targetId).some((m) => m.id === message.id)) {
      return Promise.resolve({ status: "accepted" });
    }
    const existing = this.inflight.get(message.id);
    if (existing !== void 0) return existing;
    const prev = this.targetChains.get(message.targetId) ?? Promise.resolve();
    const attempt = prev.then(
      () => this.dispatchThrough(message),
      () => this.dispatchThrough(message)
    );
    this.inflight.set(
      message.id,
      attempt.finally(() => this.inflight.delete(message.id))
    );
    this.targetChains.set(
      message.targetId,
      attempt.then(
        () => void 0,
        () => void 0
      )
    );
    return this.inflight.get(message.id);
  }
  /** 取该目标全部 pending，按队列序投递直到本条；前序 pending/rejected 即整体返回该结果。 */
  async dispatchThrough(message) {
    const state = this.loadState();
    const queue = this.pendingFor(state, message.targetId);
    for (const candidate of queue) {
      const outcome = await this.dispatchOne(candidate);
      if (candidate.id === message.id) return outcome;
      if (outcome.status !== "accepted") return outcome;
    }
    return { status: "accepted" };
  }
  /** dispatchOnce 分支矩阵（§6.3）：accepted=确认送达；pending=适配层收件箱；rejected=硬失败。 */
  async dispatchOne(message) {
    try {
      const framed = frameMessage(message);
      const source = {
        kind: "agent-message",
        form: "relay",
        senderSessionId: message.senderId
      };
      if (message.targetId === this.deps.teamId) {
        const steered = this.deps.steerLead ? this.deps.steerLead(framed, source) : defaultSteerLead(framed, source);
        if (steered !== false) {
          return await this.tryMarkDelivered(message);
        }
        if (this.deps.inspector.containsMessage(message.targetId, message.id)) {
          return await this.tryMarkDelivered(message);
        }
        return { status: "pending", reason: "lead inbox has no receipt yet" };
      }
      if (this.deps.inspector.isAlive(message.targetId)) {
        if (this.deps.inspector.containsMessage(message.targetId, message.id)) {
          return await this.tryMarkDelivered(message);
        }
        const verdict2 = await this.deliverFramed(message, framed);
        if (verdict2 === "accepted") return await this.checkpointDelivered(message);
        return { status: "pending", reason: "target is running; delivery deferred to turn boundary" };
      }
      let record2;
      try {
        record2 = this.deps.inspector.readColdRecord(message.targetId, message.id);
      } catch (err) {
        this.deps.warn?.(
          `cannot read Team message target "${message.targetId}": ${errText(err)}`
        );
        return { status: "rejected", reason: errText(err) };
      }
      if (record2 !== void 0 && record2.recorded) {
        return await this.tryMarkDelivered(message);
      }
      const verdict = await this.deliverFramed(message, framed);
      if (verdict === "accepted") return await this.checkpointDelivered(message);
      return { status: "pending", reason: "cold target resume deferred" };
    } catch (err) {
      this.deps.warn?.(`team message "${message.id}" remains queued: ${errText(err)}`);
      return { status: "rejected", reason: errText(err) };
    }
  }
  /** provider.deliver（framedMessage 序列化为字符串——草案 §1 deliver 签名）。 */
  deliverFramed(message, framed) {
    return this.deps.provider.deliver({
      memberId: message.targetId,
      framedMessage: JSON.stringify(framed),
      messageId: message.id
    });
  }
  /** §6.3 checkpointDelivered：确认目标日志确已含该消息身份，再 markDelivered（幂等）。 */
  async checkpointDelivered(message) {
    const confirmed = message.targetId === this.deps.teamId || this.deps.inspector.containsMessage(message.targetId, message.id);
    if (!confirmed) {
      this.deps.warn?.(`team message "${message.id}" remains queued: target confirmation missing`);
      return { status: "pending", reason: "target confirmation missing" };
    }
    return await this.tryMarkDelivered(message);
  }
  /**
   * 投递已发生但 delivered 事件未落盘（如 journal 崩溃/确认缺失）：返回 pending，
   * 由恢复路径按 containsMessage 补记；不向调用方谎报 accepted，也不误报 rejected。
   */
  async tryMarkDelivered(message) {
    try {
      await this.markDelivered(message);
      return { status: "accepted" };
    } catch (err) {
      this.deps.warn?.(`team message "${message.id}" delivered confirmation not recorded: ${errText(err)}`);
      return { status: "pending", reason: "delivered confirmation not recorded" };
    }
  }
  /** markDelivered（幂等：已 delivered / 消息不存在 / targetId 不符 → 静默返回）。 */
  async markDelivered(message) {
    await this.deps.store.transact(async () => {
      const state = this.loadState();
      const existing = state.messages.find((m) => m.id === message.id);
      if (existing === void 0) return;
      if (existing.targetId !== message.targetId) return;
      if (state.delivered.includes(message.id)) return;
      await this.deps.store.append({
        type: "team/message/delivered",
        version: 2,
        teamId: this.deps.teamId,
        messageId: message.id,
        targetId: message.targetId
      });
    });
  }
  // ---------------------------------------------------------------- 回执观察与恢复重试（F20）
  /** §6.3 回执观察（全局 session/event 等价钩子）：目标已持久接收 → 补记 delivered。 */
  async observeDelivery(memberId, messageId) {
    try {
      const state = this.loadState();
      const message = state.messages.find((m) => m.id === messageId);
      if (message === void 0 || message.targetId !== memberId) return;
      if (state.delivered.includes(messageId)) return;
      if (this.deps.inspector.containsMessage(memberId, messageId)) {
        await this.markDelivered(message);
      }
    } catch (err) {
      this.deps.warn?.(`Team message "${messageId}" acknowledgement failed: ${errText(err)}`);
    }
  }
  /** §6.3 恢复重试：成员启动 → 其 pending 重投；Lead（"all"）→ 全量。 */
  async recoverFor(target) {
    const state = this.loadState();
    const targets = target === "all" ? [...new Set(state.messages.map((m) => m.targetId))] : [target];
    for (const targetId of targets) {
      const queue = this.pendingFor(this.loadState(), targetId);
      if (process.env.TEAM_DEBUG_DELIVERY === "1") {
        this.deps.warn?.(`delivery-recover target=${targetId} pending=${queue.length}`);
      }
      for (const message of queue) {
        const outcome = await this.tryDispatch(message);
        if (process.env.TEAM_DEBUG_DELIVERY === "1") {
          this.deps.warn?.(`delivery-recover target=${targetId} message=${message.id} status=${outcome.status} reason=${outcome.reason ?? ""}`);
        }
      }
    }
  }
};
function defaultSteerLead(framed, source) {
}
function defaultNewId2() {
  return globalThis.crypto.randomUUID();
}
function errText(err) {
  return err instanceof Error ? err.message : String(err);
}

// src/domain/taskboard.ts
var TeamTaskBoard = class {
  constructor(deps) {
    this.deps = deps;
  }
  // ---------------------------------------------------------------- create（§7.2）
  async create(callerId, args) {
    this.requireMember(callerId);
    this.deps.lifecycle.requireOpen();
    const subject = requiredText("subject", args.subject, 200);
    const description = requiredText("description", args.description, 16384);
    const scopes = writeScopes(args.writeScopes ?? []);
    return this.deps.store.transact(async () => {
      const state = this.loadState();
      const id = `task-${state.nextTaskNumber}`;
      if (state.nextTaskNumber > Number.MAX_SAFE_INTEGER || state.tasks.some((t) => t.id === id)) {
        throw new TeamError("TEAM_TASK_LIMIT", "Team task id space exhausted");
      }
      const liveCount = state.tasks.filter((t) => t.status !== "deleted").length;
      if (liveCount >= this.deps.limits.maxTasks) {
        throw new TeamError("TEAM_TASK_LIMIT", `Team task limit ${this.deps.limits.maxTasks} reached`);
      }
      dependencies(state.tasks, id, args.blockedBy ?? []);
      const task = {
        id,
        revision: 1,
        subject,
        description,
        status: "pending",
        blockedBy: [...args.blockedBy ?? []],
        writeScopes: scopes
      };
      assertTaskGraphCandidate(state.tasks, task);
      const { state: next } = await this.deps.store.append({
        type: "team/task",
        version: 2,
        teamId: this.deps.teamId,
        task
      });
      return { task: projectTaskView(next, next.tasks.find((t) => t.id === id)) };
    });
  }
  // ---------------------------------------------------------------- update（§7.3）
  async update(callerId, args) {
    this.requireMember(callerId);
    this.deps.lifecycle.requireOpen();
    return this.deps.store.transact(async () => {
      const state = this.loadState();
      const current = state.tasks.find((t) => t.id === args.taskId);
      if (current === void 0) {
        throw new TeamError("TEAM_TASK_NOT_FOUND", `team task "${args.taskId}" not found`);
      }
      if (current.revision !== args.expectedRevision) {
        throw new TeamError(
          "TEAM_TASK_STALE_REVISION",
          `stale team task "${args.taskId}" revision ${args.expectedRevision}; current revision is ${current.revision}`
        );
      }
      if (current.status === "deleted") {
        throw new TeamError("TEAM_TASK_DELETED", `team task "${args.taskId}" is deleted`);
      }
      const isLead = callerId === state.id;
      const isOwner = current.ownerId === callerId;
      const next = this.applyAction(state, current, callerId, isLead, isOwner, args);
      assertTaskGraphCandidate(state.tasks, next);
      const { state: nextState } = await this.deps.store.append({
        type: "team/task",
        version: 2,
        teamId: this.deps.teamId,
        task: next
      });
      return {
        task: projectTaskView(nextState, nextState.tasks.find((t) => t.id === args.taskId))
      };
    });
  }
  applyAction(state, current, callerId, isLead, isOwner, args) {
    const authorizeOwner = () => {
      if (!(isLead || isOwner)) {
        throw new TeamError("TEAM_TASK_UNAUTHORIZED", "task mutation requires its owner or Team Lead");
      }
    };
    const ready = projectTaskView(state, current).ready;
    const bump = (patch) => ({
      ...current,
      ...patch,
      revision: current.revision + 1
    });
    switch (args.action) {
      case "claim": {
        if (current.ownerId !== void 0 && current.ownerId !== callerId) {
          throw new TeamError(
            "TEAM_TASK_ALREADY_CLAIMED",
            `team task "${current.id}" is owned by another member`
          );
        }
        if (current.status !== "pending" || !ready) {
          throw new TeamError("TEAM_TASK_BLOCKED", `team task "${current.id}" is not ready to claim`);
        }
        return bump({ status: "in_progress", ownerId: callerId });
      }
      case "release": {
        authorizeOwner();
        if (current.status !== "in_progress") {
          throw new TeamError("TEAM_TASK_INVALID_TRANSITION", "only an in-progress task can be released");
        }
        return stripOwner(bump({ status: "pending" }));
      }
      case "edit": {
        authorizeOwner();
        const hasAny = args.subject !== void 0 || args.description !== void 0 || args.writeScopes !== void 0;
        if (!hasAny) {
          throw new TeamError(
            "TEAM_INVALID_ARGUMENT",
            "task edit requires subject, description, or write_scopes"
          );
        }
        return bump({
          ...args.subject !== void 0 ? { subject: requiredText("subject", args.subject, 200) } : {},
          ...args.description !== void 0 ? { description: requiredText("description", args.description, 16384) } : {},
          ...args.writeScopes !== void 0 ? { writeScopes: writeScopes(args.writeScopes) } : {}
        });
      }
      case "set_dependencies": {
        authorizeOwner();
        if (args.blockedBy === void 0) {
          throw new TeamError("TEAM_INVALID_ARGUMENT", "set_dependencies requires blocked_by");
        }
        dependencies(state.tasks, current.id, args.blockedBy);
        return bump({ blockedBy: [...args.blockedBy] });
      }
      case "complete": {
        authorizeOwner();
        if (current.status !== "in_progress") {
          throw new TeamError("TEAM_TASK_INVALID_TRANSITION", "only an in-progress task can complete");
        }
        return bump({ status: "completed" });
      }
      case "reopen": {
        authorizeOwner();
        if (current.status !== "completed") {
          throw new TeamError("TEAM_TASK_INVALID_TRANSITION", "only a completed task can reopen");
        }
        return stripOwner(
          bump({
            status: "pending",
            ...args.description !== void 0 ? { description: requiredText("description", args.description, 16384) } : {}
          })
        );
      }
      case "reassign": {
        if (!isLead) {
          throw new TeamError("TEAM_LEAD_REQUIRED", "only the Team Lead can reassign tasks");
        }
        if (current.status !== "pending" && current.status !== "in_progress") {
          throw new TeamError(
            "TEAM_TASK_INVALID_TRANSITION",
            "only a pending or in-progress task can be reassigned"
          );
        }
        const rawOwner = (args.owner ?? "").trim();
        if (rawOwner.length === 0) {
          return stripOwner(bump({ status: "pending" }));
        }
        if (!ready) {
          throw new TeamError("TEAM_TASK_BLOCKED", `team task "${current.id}" is blocked`);
        }
        const target = rawOwner === "lead" ? { id: state.id, name: "lead" } : state.members.find((m) => m.name === rawOwner && m.phase === "active");
        if (target === void 0) {
          throw new TeamError("TEAM_MEMBER_NOT_FOUND", `active teammate "${rawOwner}" not found`);
        }
        return bump({ status: "in_progress", ownerId: target.id });
      }
      case "delete": {
        authorizeOwner();
        const dependent = state.tasks.find(
          (t) => t.id !== current.id && t.status !== "deleted" && t.blockedBy.includes(current.id)
        );
        if (dependent !== void 0) {
          throw new TeamError(
            "TEAM_TASK_HAS_DEPENDENTS",
            `team task "${current.id}" still blocks "${dependent.id}"`
          );
        }
        return bump({ status: "deleted" });
      }
      default:
        throw new TeamError("TEAM_INVALID_ARGUMENT", `unsupported task action ${String(args.action)}`);
    }
  }
  // ---------------------------------------------------------------- list / get（§7.6）
  list(callerId, args = {}) {
    this.requireMember(callerId);
    const state = this.loadState();
    const cursor = args.cursor ?? 0;
    const limit = args.limit ?? 50;
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new TeamError("TEAM_INVALID_ARGUMENT", "cursor must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TeamError("TEAM_INVALID_ARGUMENT", "limit must be an integer from 1 through 100");
    }
    const views = state.tasks.filter((t) => t.status !== "deleted").map((t) => projectTaskView(state, t));
    const filtered = views.filter((view2) => {
      if (args.status !== void 0 && view2.status !== args.status) return false;
      if (args.owner !== void 0) {
        if (args.owner === "unowned" && view2.ownerName !== void 0) return false;
        if (args.owner !== "unowned" && view2.ownerName !== args.owner) return false;
      }
      if (args.ready !== void 0 && view2.ready !== args.ready) return false;
      return true;
    });
    const page = filtered.slice(cursor, cursor + limit);
    const hasNext = cursor + limit < filtered.length;
    return hasNext ? { tasks: page, nextCursor: cursor + limit } : { tasks: page };
  }
  get(callerId, taskId) {
    this.requireMember(callerId);
    const state = this.loadState();
    const task = state.tasks.find((t) => t.id === taskId);
    if (task === void 0) {
      throw new TeamError("TEAM_TASK_NOT_FOUND", `team task "${taskId}" not found`);
    }
    return { task: projectTaskView(state, task) };
  }
  // ---------------------------------------------------------------- 内部
  requireMember(callerId) {
    requireMembership(() => this.loadState(), callerId);
  }
  loadState() {
    const state = this.deps.store.state();
    if (state.failure !== void 0) throw new Error(state.failure);
    return state;
  }
};
function stripOwner(task) {
  if (task.ownerId === void 0) return task;
  const clone2 = { ...task };
  delete clone2.ownerId;
  return clone2;
}

// src/domain/runtime.ts
var TeamRuntime = class {
  lifecycle;
  activity;
  roster;
  mailbox;
  taskboard;
  unsubscribeCommit;
  unsubscribeStatus;
  constructor(deps) {
    this.lifecycle = new TeamLifecycle({
      teamId: deps.teamId,
      store: deps.store,
      disposalTimeoutMs: deps.limits.disposalTimeoutMs,
      drainer: (args) => deps.provider.drain({ teamId: deps.teamId, timeoutMs: args.timeoutMs }),
      closeWaiters: () => this.activity.closeAll(),
      clock: deps.clock
    });
    this.activity = new TeamActivity({ store: deps.store, clock: deps.clock });
    this.roster = new TeamRoster({
      teamId: deps.teamId,
      store: deps.store,
      provider: deps.provider,
      recon: deps.provider,
      inspector: deps.provider,
      limits: deps.limits,
      lifecycle: this.lifecycle,
      presentation: deps.presentation,
      providers: deps.providers,
      leadModel: deps.leadModel,
      warn: deps.warn,
      newId: deps.newId
    });
    this.mailbox = new TeamMailbox({
      teamId: deps.teamId,
      store: deps.store,
      provider: deps.provider,
      inspector: deps.provider,
      limits: deps.limits,
      lifecycle: this.lifecycle,
      steerLead: deps.steerLead,
      warn: deps.warn,
      newId: deps.newId
    });
    this.taskboard = new TeamTaskBoard({
      teamId: deps.teamId,
      store: deps.store,
      limits: deps.limits,
      lifecycle: this.lifecycle
    });
    this.unsubscribeCommit = this.activity.bindCommitEdge();
    this.unsubscribeStatus = this.roster.onMemberStatus(() => this.activity.notifyMemberStatus());
  }
  /** 冷启动恢复对账：roster 对账完成 + 全量邮箱续投。 */
  async recoverAll() {
    await this.roster.recoveryDone;
    await this.mailbox.recoverFor("all");
  }
  /** D9 抽象处置入口。 */
  dispose(reason) {
    return this.lifecycle.dispose(reason);
  }
  close() {
    this.unsubscribeCommit();
    this.unsubscribeStatus();
  }
};

// src/provider/mock-provider.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var MockProvider = class {
  teamChildren = /* @__PURE__ */ new Map();
  /** 非团队子进程（§12「非 Team 的 continuable 子代理不动」验证）。 */
  foreignChildren = /* @__PURE__ */ new Set();
  provisioningRecords = /* @__PURE__ */ new Map();
  drainedTeamIds = [];
  drainCalls = 0;
  startCalls = 0;
  deliverCalls = 0;
  program = {};
  deliverScript = [];
  programWith(program) {
    this.program = program;
    this.deliverScript = program.deliverResults ? [...program.deliverResults] : [];
    return this;
  }
  async startContinuable(args) {
    this.startCalls += 1;
    const outcome = this.program.startOutcome ?? { kind: "accept" };
    if (this.program.startDelayMs && this.program.startDelayMs > 0) {
      await sleep2(this.program.startDelayMs);
    }
    if (outcome.kind === "hang") {
      await new Promise((_, reject) => {
        const onAbort = () => reject(args.signal?.reason ?? new Error("aborted"));
        if (args.signal?.aborted) return onAbort();
        args.signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    if (outcome.kind === "throw") throw outcome.error;
    const child = {
      memberId: args.memberId,
      name: args.name,
      context: args.context,
      model: void 0,
      modelSelection: void 0,
      firstPrompt: args.firstPrompt,
      alive: true,
      received: /* @__PURE__ */ new Set(),
      deliverCount: /* @__PURE__ */ new Map(),
      interrupted: 0,
      drained: false,
      status: "running"
      // 首轮 prompt 已投递 → 存活即 running（availability 口径）
    };
    this.teamChildren.set(args.memberId, child);
    this.provisioningRecords.set(args.memberId, {
      rootSessionId: args.teamId,
      descriptor: { provider: args.context === "fork" ? "fork" : "spawn", mode: "continuable" },
      initialUserMessageAccepted: outcome.kind === "accept"
    });
    return { memberId: args.memberId, accepted: outcome.kind === "accept" };
  }
  async deliver(args) {
    this.deliverCalls += 1;
    if (this.program.deliverDelayMs && this.program.deliverDelayMs > 0) {
      await sleep2(this.program.deliverDelayMs);
    }
    const child = this.teamChildren.get(args.memberId);
    if (child === void 0 || !child.alive) {
      if (this.program.coldDeliverOutcome === "accepted") {
        const cold = child ?? {
          memberId: args.memberId,
          name: args.memberId,
          context: "fresh",
          model: void 0,
          modelSelection: void 0,
          firstPrompt: "",
          alive: false,
          received: /* @__PURE__ */ new Set(),
          deliverCount: /* @__PURE__ */ new Map(),
          interrupted: 0,
          drained: false,
          status: "idle"
        };
        if (!cold.received.has(args.messageId)) {
          cold.received.add(args.messageId);
          cold.deliverCount.set(args.messageId, (cold.deliverCount.get(args.messageId) ?? 0) + 1);
        }
        if (child === void 0) this.teamChildren.set(args.memberId, cold);
        return "accepted";
      }
      return "queued";
    }
    const verdict = this.deliverScript.length > 0 ? this.deliverScript.shift() : "accepted";
    if (verdict === "throw") throw new Error(`mock deliver failure for ${args.messageId}`);
    if (verdict === "lost") {
      return "accepted";
    }
    if (verdict === "queued") {
      return "queued";
    }
    if (child.received.has(args.messageId)) {
      return "accepted";
    }
    child.received.add(args.messageId);
    child.deliverCount.set(args.messageId, (child.deliverCount.get(args.messageId) ?? 0) + 1);
    return "accepted";
  }
  async interrupt(args) {
    if (this.program.interruptError !== void 0) throw this.program.interruptError;
    const child = this.teamChildren.get(args.memberId);
    if (child === void 0 || !child.alive) return { previousStatus: "inactive" };
    const previousStatus = child.status;
    child.interrupted += 1;
    child.status = "idle";
    return { previousStatus };
  }
  async drain(args) {
    this.drainCalls += 1;
    if (this.program.drainError !== void 0) throw this.program.drainError;
    await sleep2(Math.min(args.timeoutMs, 5));
    for (const child of this.teamChildren.values()) {
      if (child.alive) {
        child.alive = false;
        child.drained = true;
      }
    }
    this.drainedTeamIds.push(args.teamId);
  }
  // ------------------------------------------------ ReconciliationSource（§5.4 桩）
  readProvisioningRecord(memberId) {
    return this.provisioningRecords.get(memberId);
  }
  /** 测试直改桩（构造四条件缺失场景）。 */
  setProvisioningRecord(memberId, record2) {
    if (record2 === void 0) this.provisioningRecords.delete(memberId);
    else this.provisioningRecords.set(memberId, record2);
  }
  // ------------------------------------------------ TargetInspector（§5.5/§6.3）
  isAlive(memberId) {
    const child = this.teamChildren.get(memberId);
    return child !== void 0 && child.alive;
  }
  containsMessage(memberId, messageId) {
    const child = this.teamChildren.get(memberId);
    if (child === void 0) return this.readColdRecord(memberId, messageId)?.recorded ?? false;
    return child.received.has(messageId);
  }
  readColdRecord(memberId, messageId) {
    if (this.program.coldRead === "throw") {
      throw new Error(`mock cold read failure for ${memberId}`);
    }
    const child = this.teamChildren.get(memberId);
    if (child === void 0) return void 0;
    return { recorded: child.received.has(messageId) };
  }
  /** 测试辅助：外部把某消息标记为目标已持久接收（F20 回执观察等价钩子）。 */
  markReceived(memberId, messageId) {
    const child = this.teamChildren.get(memberId);
    if (child) child.received.add(messageId);
  }
  /** 测试辅助：非团队子进程登记（drain 不动它们）。 */
  addForeignChild(memberId) {
    this.foreignChildren.add(memberId);
  }
  /** 测试辅助：成员生死控制（成员启动/退出模拟）。 */
  killChild(memberId) {
    const child = this.teamChildren.get(memberId);
    if (child) child.alive = false;
  }
  reviveChild(memberId) {
    const child = this.teamChildren.get(memberId);
    if (child) child.alive = true;
  }
  // §5.5 呈现能力（listMembers 的 availability/model）
  statusOf(memberId) {
    return this.isAlive(memberId) ? "running" : "inactive";
  }
  modelOf(memberId) {
    const child = this.teamChildren.get(memberId);
    return child?.modelSelection?.modelId ?? child?.model;
  }
  /** Lead 行模型桩（可编程；缺省 undefined → roster 回落 deps.leadModel）。 */
  leadModelOf() {
    return this.program.leadModel;
  }
  /** 成员附加诊断桩（MemberPresentation.diagnosticsOf；缺省空）。 */
  diagnosticsOf(memberId) {
    return this.program.memberDiagnostics?.[memberId] ?? [];
  }
  /** spawn 预检桩（0.4.1 ModelPreflight；programWith({preflightError}) 注入失败）。 */
  preflightMemberModel() {
    if (this.program.preflightError !== void 0) throw this.program.preflightError;
  }
  newId() {
    return randomUUID2();
  }
};
function sleep2(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/coord/host.ts
var DEFAULT_HOST_LIMITS = {
  maxMembers: 8,
  maxTasks: 256,
  maxMessageBytes: 65536,
  disposalTimeoutMs: 5e3
};
var TeamCoordinatorHost = class _TeamCoordinatorHost {
  constructor(dataRoot, teamId, opts, lock, limits, provider) {
    this.dataRoot = dataRoot;
    this.teamId = teamId;
    this.opts = opts;
    this.lock = lock;
    this.limits = limits;
    this.provider = provider;
  }
  mode = "proxy";
  store = null;
  runtime = null;
  server = null;
  table = null;
  watcher = null;
  /** pending 补投扫描（崩溃/瞬时失败后不得永久滞留；边界之外的兜底）。 */
  deliveryTimer = null;
  promoting = null;
  closed = false;
  initialLoad = null;
  /** 投影 failure 终态 → 降级服务（见 serve()）。 */
  degradedReason;
  static async open(opts) {
    const paths = teamPaths(opts.dataRoot, opts.teamId);
    ensureTeamDir(paths);
    let host;
    const lock = new CoordinatorLock(paths.lockFile, paths.auditFile, {
      // 失锁 = 立即降级；不能继续以 coordinator 身份写 journal/占用 socket。
      onLost: () => {
        void host.demoteToProxy("coordinator lock lost");
      }
    });
    lock.installExitHandlers();
    const limits = validateTeamLimits({ ...DEFAULT_HOST_LIMITS, ...opts.limits });
    host = new _TeamCoordinatorHost(opts.dataRoot, opts.teamId, opts, lock, limits, opts.provider ?? new MockProvider());
    try {
      await lock.acquire({ waitMs: opts.lockWaitMs ?? 0 });
    } catch (err) {
      if (err instanceof AcquireTimeout) {
        host.startTakeoverWatcher();
        return host;
      }
      throw err;
    }
    await host.serve();
    return host;
  }
  get currentMode() {
    return this.mode;
  }
  get socketPath() {
    return this.server?.socketPath;
  }
  get committedSeq() {
    return this.store?.committedSeq ?? this.initialLoad?.seq ?? 0;
  }
  get coordinatorBootId() {
    return this.lock.info?.bootId ?? bootId();
  }
  /** 代理模式下的方法表（§2 一致性断言用；协调者模式为 null）。 */
  get methodTable() {
    return this.table;
  }
  /** 降级原因（投影 failure 终态）；未降级为 undefined。 */
  get degradedFailure() {
    return this.degradedReason;
  }
  /**
   * 协调者模式下的域运行时（stage-3 工具面接线用：list_agents 的 MEMBER_VIEW 全保真
   * 与 wait 捷径需要 roster 呈现；附加式小改，披露于 stage-3 开发记录）。
   * 代理模式为 null（本进程无 runtime）。
   */
  get teamRuntime() {
    return this.mode === "coordinator" ? this.runtime : null;
  }
  /** 协调者就绪信息（socketPath/seq；代理模式仅 seq 本地重放值）。 */
  async readyInfo() {
    if (this.mode === "coordinator") {
      return {
        mode: this.mode,
        socketPath: this.socketPath,
        seq: this.committedSeq,
        fromCheckpoint: this.initialLoad?.fromCheckpoint ?? false,
        lockInfo: this.lock.info ?? void 0,
        ...this.degradedReason !== void 0 ? { failure: this.degradedReason } : {}
      };
    }
    const loaded = await load(this.paths().teamDir, this.teamId);
    return {
      mode: this.mode,
      seq: loaded.seq,
      fromCheckpoint: loaded.fromCheckpoint,
      ...loaded.state.failure !== void 0 ? { failure: loaded.state.failure } : {}
    };
  }
  /**
   * 变更/查询分发：协调者模式 → 方法表直执行（与 socket 路径同一份处理器，语义等价）；
   * 代理模式 → 经 socket 调当前协调者（缺位窗口错误由调用方/TeamClient 决定重试策略）。
   */
  async dispatch(method, params, opts = {}) {
    if (this.mode === "coordinator" && this.table !== null) {
      return invokeTeamMethod(this.table, method, params, opts);
    }
    const { teamDir } = this.paths();
    return callCoordinator(teamDir, this.teamId, method, params, {
      // 慢方法（spawn/send）用 per-method 裕量；其余沿用 host 全局（缺省交给 RPC 层 15s）。
      timeoutMs: methodTimeoutMs(method) ?? this.opts.callTimeoutMs,
      ...opts.signal !== void 0 ? { signal: opts.signal } : {}
    });
  }
  /** 本地重放读（两模式皆可；协调者模式等价于内存态，代理模式为权威盘面）。 */
  async readBoard() {
    return load(this.paths().teamDir, this.teamId);
  }
  /** 手动触发一次接任尝试（观察者外的显式入口；测试/演练用）。 */
  tryPromote() {
    if (this.mode === "coordinator" || this.promoting !== null) {
      return this.promoting ?? Promise.resolve(true);
    }
    const run = this.promoteOnce().finally(() => {
      this.promoting = null;
    });
    this.promoting = run;
    return run;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.stopWatcher();
    this.stopDeliverySweep();
    const errors = [];
    if (this.server !== null) {
      try {
        await this.server.close();
      } catch (err) {
        errors.push(err);
      }
      this.server = null;
    }
    if (this.runtime !== null) {
      try {
        await this.runtime.dispose();
      } catch (err) {
        errors.push(err);
      }
      this.runtime.close();
      this.runtime = null;
    }
    if (this.store !== null) {
      try {
        await this.store.close();
      } catch (err) {
        errors.push(err);
      }
      this.store = null;
    }
    try {
      await this.lock.release();
    } catch (err) {
      errors.push(err);
    }
    if (providerHasBoundary(this.provider)) {
      try {
        this.provider.detach();
      } catch (err) {
        errors.push(err);
      }
    }
    this.table = null;
    if (errors.length > 0) throw new AggregateError(errors, "Agent Teams coordinator host close failed");
  }
  /**
   * 失锁降级：停止心跳/写路径，关闭 RPC 与 runtime，回到 proxy 并重新观察接任。
   * 与 close() 的区别：不置 closed，仍可再次晋升。
   */
  async demoteToProxy(reason) {
    if (this.closed || this.mode !== "coordinator") return;
    this.mode = "proxy";
    this.lock.stopHeartbeat();
    this.stopDeliverySweep();
    this.opts.warn?.(`agent-team coordinator demoted for team "${this.teamId}": ${reason}`);
    const server2 = this.server;
    this.server = null;
    this.table = null;
    if (server2 !== null) {
      try {
        await server2.close();
      } catch {
      }
      removeSocketRegistryIf(this.paths().teamDir, server2.socketPath);
    }
    const runtime = this.runtime;
    this.runtime = null;
    if (runtime !== null) {
      try {
        await runtime.dispose();
      } catch {
      }
      runtime.close();
    }
    const store = this.store;
    this.store = null;
    if (store !== null) {
      try {
        await store.close();
      } catch {
      }
    }
    this.startTakeoverWatcher();
  }
  // ---------------------------------------------------------------- 内部
  paths() {
    return teamPaths(this.dataRoot, this.teamId);
  }
  /** 轮次边界（stage-4）：landed → observeDelivery 折叠 delivered；teammate → pending 续投；状态边 → Activity 唤醒。 */
  async handleTurnBoundary(event) {
    if (this.mode !== "coordinator" || this.runtime === null || this.closed) return;
    try {
      for (const messageId of event.landedMessageIds) {
        await this.runtime.mailbox.observeDelivery(event.memberId, messageId);
      }
      if (event.memberId !== this.teamId) {
        await this.runtime.mailbox.recoverFor(event.memberId);
      }
      this.runtime.roster.notifyStatusChanged();
    } catch (err) {
      this.opts.warn?.(
        `agent-team turn boundary handling failed for "${event.memberId}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  /** 持锁后装配：journal(store) → runtime → 恢复对账 → RPC server + 方法表。 */
  async serve() {
    if (this.closed) throw new Error("host is closed");
    const paths = this.paths();
    this.lock.startHeartbeat();
    let store;
    try {
      const journal = {
        ...this.opts.journal,
        maxLineBytes: Math.max(
          this.opts.journal?.maxLineBytes ?? 65536,
          this.limits.maxMessageBytes + 4096
        )
      };
      store = await JournalTeamStore.open(this.dataRoot, this.teamId, {
        lock: this.lock,
        journal
      });
    } catch (err) {
      this.lock.stopHeartbeat();
      await this.lock.release();
      throw err;
    }
    const runtime = new TeamRuntime({
      teamId: this.teamId,
      store,
      provider: this.provider,
      limits: this.limits,
      presentation: providerIsPresentation(this.provider) ? this.provider : void 0,
      // stage-4：宿主内 Lead 无直达通道（D2）→ 投递走 hook 三通道 + 回执折叠。
      // 灰度唤醒：TEAM_WAKE_LEAD=1 且 Lead 空闲时拉起 --resume 回合；仍返回 false（未确认送达）。
      ...providerDeliversLeadViaHooks(this.provider) ? {
        steerLead: () => {
          if (providerWakesLead(this.provider)) {
            void this.provider.wakeLead().then((result) => {
              if (result.woke) {
                this.opts.warn?.(`agent-team lead wake launched for team "${this.teamId}"`);
              } else if (result.reason !== "disabled" && result.reason !== "lead-active" && result.reason !== "recent-activity" && result.reason !== "cooldown") {
                this.opts.warn?.(`agent-team lead wake skipped for team "${this.teamId}": ${result.reason}`);
              }
            }).catch((err) => {
              this.opts.warn?.(
                `agent-team lead wake failed for team "${this.teamId}": ${err instanceof Error ? err.message : String(err)}`
              );
            });
          }
          return false;
        }
      } : {},
      warn: this.opts.warn
    });
    if (providerHasBoundary(this.provider)) {
      this.provider.bind({
        onBoundary: (event) => void this.handleTurnBoundary(event),
        pendingLookup: (memberId) => {
          const state = store.state();
          return runtime.mailbox.pendingFor(state, memberId).map((message) => ({ messageId: message.id, framedJson: JSON.stringify(frameMessage(message)) }));
        },
        // 0.4.1：模型失败记录变化（后台续跑同步失败/恢复清除）→ 成员展示立即刷新
        // （Activity 唤醒 + 面板下一帧拿到新诊断；不等下一次轮次边界）。
        onModelFailureChanged: () => {
          if (this.mode === "coordinator" && this.runtime !== null && !this.closed) {
            this.runtime.roster.notifyStatusChanged();
          }
        }
      });
      const adopted = this.provider.adoptOrphans();
      this.opts.warn?.(
        `agent-team coordinator adopted team "${this.teamId}": finalized ${adopted.finalized.length} finished turn(s), watching ${adopted.adopted.length} live turn(s)`
      );
    }
    this.initialLoad = store.lastLoad;
    const initialState = store.state();
    if (initialState.failure !== void 0) {
      this.degradedReason = initialState.failure;
      this.opts.warn?.(
        `Agent Teams coordinator for team "${this.teamId}" started in degraded mode (projection failure): ${initialState.failure}`
      );
    } else {
      await runtime.recoverAll();
    }
    const socket = resolveSocketPath(paths.teamDir);
    const token = newRpcToken();
    const server2 = new RpcServer(socket.socketPath, {
      token,
      maxFrameBytes: frameBudgetFor(this.limits.maxMessageBytes)
    });
    const table = buildTeamMethodTable({
      teamId: this.teamId,
      runtime,
      store,
      coordinatorBootId: this.lock.info?.bootId ?? bootId()
    });
    registerTeamMethods(server2, table);
    await server2.listen({ callTimeoutMs: this.opts.callTimeoutMs });
    writeRpcToken(paths.teamDir, token);
    writeSocketRegistry(paths.teamDir, socket.socketPath);
    this.store = store;
    this.runtime = runtime;
    this.server = server2;
    this.table = table;
    this.mode = "coordinator";
    this.stopWatcher();
    this.startDeliverySweep();
    this.opts.onPromoted?.({
      socketPath: socket.socketPath,
      seq: store.committedSeq,
      fromCheckpoint: this.initialLoad?.fromCheckpoint ?? false,
      ...this.degradedReason !== void 0 ? { failure: this.degradedReason } : {}
    });
  }
  /** 单发晋升尝试：锁缺失/过龄才出手；新鲜持有 → false。 */
  async promoteOnce() {
    if (this.mode === "coordinator" || this.closed) return this.mode === "coordinator";
    const observed = this.lock.observe();
    if (observed.exists && observed.ageMs <= this.lock.tuningOptions.expiryMs) {
      return false;
    }
    try {
      await this.lock.acquire({ waitMs: 0 });
    } catch {
      return false;
    }
    await this.serve();
    return true;
  }
  startTakeoverWatcher() {
    if (this.opts.autoTakeover === false || this.watcher !== null) return;
    const pollMs = this.opts.takeoverPollMs ?? 100;
    const watcher = setInterval(() => {
      void this.tryPromote().catch(() => void 0);
    }, pollMs);
    watcher.unref?.();
    this.watcher = watcher;
  }
  stopWatcher() {
    if (this.watcher !== null) {
      clearInterval(this.watcher);
      this.watcher = null;
    }
  }
  /**
   * pending 补投：轮次边界是主路径；进程瞬时失败（拉起后未落库即退出）会留下 pending，
   * 若没有新的边界/发送就永远不会再试。这里按固定间隔扫描（provider 内部对运行中/退避
   * 目标快速返回 queued，不重复拉起）。
   */
  startDeliverySweep() {
    if (this.deliveryTimer !== null) return;
    const everyMs = this.opts.deliverySweepMs ?? 2e3;
    if (everyMs <= 0) return;
    this.deliveryTimer = setInterval(() => {
      if (this.mode !== "coordinator" || this.runtime === null || this.closed) return;
      try {
        const state = this.store?.state();
        if (state === void 0) return;
        const delivered = new Set(state.delivered);
        if (!state.messages.some((message) => !delivered.has(message.id))) return;
      } catch {
        return;
      }
      void this.runtime.mailbox.recoverFor("all").catch((err) => {
        this.opts.warn?.(
          `agent-team delivery sweep failed for "${this.teamId}": ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }, everyMs);
    this.deliveryTimer.unref?.();
  }
  stopDeliverySweep() {
    if (this.deliveryTimer !== null) {
      clearInterval(this.deliveryTimer);
      this.deliveryTimer = null;
    }
  }
};
function providerIsPresentation(provider) {
  return typeof provider.statusOf === "function" && typeof provider.modelOf === "function";
}
function providerHasBoundary(provider) {
  return typeof provider.bind === "function" && typeof provider.adoptOrphans === "function";
}
function providerDeliversLeadViaHooks(provider) {
  return provider.LEAD_DELIVERY_VIA_HOOKS === true;
}
function providerWakesLead(provider) {
  return typeof provider.wakeLead === "function";
}

// src/mcp/policy.ts
function teamPolicy(interrupt) {
  return `Agent Teams is available in this session

The Team Lead and all teammates share the same working directory and filesystem. Edits are immediately visible to every member. Split write work into disjoint scopes, record expected write scopes on shared tasks, and use task dependencies when work must be ordered. Write-scope overlap is advisory, not a lock.

Prefer read/edit/write for file changes. If a file operation reports that the file changed since you last read it, read the current file again, rebase your intended change onto the new content, and retry. Bash, formatters, code generators, and scripts are not fully protected by the filesystem version guard; coordinate them explicitly and have the Lead review the final diff and run tests.

Use the target returned by spawn_teammate or list_agents for send_message${interrupt ? " and interrupt_agent" : ""}, or as owner when assigning or filtering shared tasks. send_message steers a running target at its nearest step boundary and starts or resumes an inactive target. inactive means no turn is executing; it does not describe task completion, success, failure, or waiting for other agents. provisioning means member creation is in progress; failed means member creation failed. A peer message starts with its sender name. A successful send does not mean the recipient has processed it. Shared-task workflow is list, get, claim with the current revision, perform the work, then complete. Task readiness never starts an owner. Before wait_agent, use list_agents and make sure another required member is running or provisioning; use send_message first when the required member is inactive. wait_agent observes only changes after that call starts, never wakes a member, and returns noProgress immediately when no other member can produce a change. Re-list after wakeup or timeout. The Lead must wait for required teammates before giving the final answer.`;
}
var POLICY_TEXT = teamPolicy(true);
var HOOK_POLICY_PREFIX = "[agent-team]";
var IDENTITY_LEAD_TEXT = `You are the Team Lead named "lead".
Use list_agents({}) to find your teammates and their names.
To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).`;
var POLICY_PROBE_MARKER = "quartz-ember-73";
var ORCHESTRATOR_SECTION_TEXT = "Lead operating mode (orchestrator): Decompose any non-trivial multi-step request into disjoint work packages before doing hands-on work. Do not edit files or implement directly except trivial one-line fixes or when no eligible member exists \u2014 delegate by creating teammates that cover the roles the goal requires. You decide the team composition and spawn it without being asked; consult the user only when the choice materially changes cost or scope. Turn every delegated unit into a shared task whose description states concrete acceptance criteria, assign an owner, record expected write scopes, and set dependencies when ordering matters. Require each owner to self-check and report changed files and test results before completing. When a task reaches completed, verify it independently: review the final diff and run the relevant tests yourself; if it fails, reopen the task with concrete findings; if it passes, append your acceptance verdict to the task description \u2014 a task is done when completed plus your recorded acceptance. Reuse idle teammates before spawning new ones and keep one member per role, within the member limit. You still wait for required teammates and synthesize their results for the final answer.";
function buildSessionStartContext(identityText, interrupt = true, leadMode2) {
  const policy = teamPolicy(interrupt);
  const orchestration = leadMode2 === "orchestrator" ? `
${HOOK_POLICY_PREFIX} ${ORCHESTRATOR_SECTION_TEXT}` : "";
  const probe = process.env.TEAM_POLICY_PROBE === "1" ? `
${HOOK_POLICY_PREFIX} \u7B56\u7565\u6CE8\u5165\u9A8C\u8BC1\u6807\u8BB0\uFF1A${POLICY_PROBE_MARKER}` : "";
  return `${HOOK_POLICY_PREFIX} ${policy}
${HOOK_POLICY_PREFIX} ${identityText}${orchestration}${probe}`;
}
var SESSION_START_CONTEXT = buildSessionStartContext(IDENTITY_LEAD_TEXT, true, "orchestrator");
var FAIL_LOUD_WARNING = "[agent-team] \u8B66\u544A\uFF1A\u672A\u68C0\u6D4B\u5230\u672C\u4F1A\u8BDD\u7684\u7B56\u7565\u6CE8\u5165\uFF08SessionStart hook \u53EF\u80FD\u672A\u751F\u6548\uFF09\u3002\u8BF7\u786E\u8BA4\u63D2\u4EF6\u5DF2\u542F\u7528\u4E14 hooks \u58F0\u660E\u5B58\u5728\uFF1B\u56E2\u961F\u5DE5\u5177\u4ECD\u53EF\u8C03\u7528\uFF0C\u4F46\u6A21\u578B\u53EF\u80FD\u672A\u52A0\u8F7D\u5B8C\u6574\u534F\u4F5C\u7B56\u7565\u3002";
var NO_PROGRESS_REASON = "no-active-peer";
var NO_PROGRESS_MESSAGE = "No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use send_message to wake each required inactive teammate before waiting again.";
function noProgressResult() {
  return { timedOut: false, noProgress: { reason: NO_PROGRESS_REASON, message: NO_PROGRESS_MESSAGE } };
}

// src/mcp/backend.ts
var WAIT_PROGRESS_INTERVAL_MS = 9e3;
var WAIT_DEFAULT_TIMEOUT_MS = 3e4;
var WAIT_MIN_TIMEOUT_MS = 1e4;
var WAIT_MAX_TIMEOUT_MS = 36e5;
var DEFAULT_IDLE_RECLAIM_MS = 10 * 6e4;
var IDLE_SWEEP_MS = 6e4;
var TeamToolBackend = class {
  constructor(opts) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.idleReclaimMs = opts.idleReclaimMs ?? DEFAULT_IDLE_RECLAIM_MS;
  }
  teams = /* @__PURE__ */ new Map();
  idleTimer = null;
  now;
  idleReclaimMs;
  /** 〔对齐轮〕0.2.1 D3：interrupt 开关（默认 true）。 */
  get interruptEnabled() {
    return this.opts.interrupt ?? true;
  }
  /** 冷启动即服务：惰性 open（并发共享同一 promise）；失败不留半成品缓存。 */
  backendFor(teamId) {
    let entry = this.teams.get(teamId);
    if (entry === void 0) {
      const provider = this.opts.providerFactory !== void 0 ? this.opts.providerFactory(teamId) : this.opts.provider !== void 0 ? this.opts.provider : void 0;
      const resolvedProvider = provider;
      const opening = TeamCoordinatorHost.open({
        dataRoot: this.opts.dataRoot,
        teamId,
        limits: this.opts.limits,
        ...provider !== void 0 ? { provider } : {},
        warn: this.opts.warn
      });
      entry = {
        host: null,
        opening,
        // 缺省装配（host 内部 new MockProvider）时拿不到实例 → 模型消歧退化为「按目录唯一命中」。
        ...resolvedProvider !== void 0 ? { provider: resolvedProvider } : {},
        lastUsedAt: this.now(),
        inflight: 0
      };
      const self = entry;
      void opening.then(
        (host) => {
          self.host = host;
          return host;
        },
        (err) => {
          if (this.teams.get(teamId) === self) this.teams.delete(teamId);
          this.opts.warn?.(`agent-team host open failed for "${teamId}": ${err instanceof Error ? err.message : String(err)}`);
          return void 0;
        }
      );
      this.teams.set(teamId, entry);
      this.ensureIdleSweep();
    }
    entry.lastUsedAt = this.now();
    return entry.opening;
  }
  /** 用法包装：记录在途/最后使用时间；工具方法统一经此取 host。 */
  async withHost(teamId, fn) {
    const host = await this.backendFor(teamId);
    const entry = this.teams.get(teamId);
    if (entry !== void 0) entry.inflight += 1;
    try {
      return await fn(host);
    } finally {
      if (entry !== void 0) {
        entry.inflight -= 1;
        entry.lastUsedAt = this.now();
      }
    }
  }
  /** 空闲回收：关闭超过阈值且无在途调用的团队 host（durable 日志保留，下次调用按冷启动恢复）。 */
  async sweepIdleHosts() {
    if (this.idleReclaimMs <= 0) return 0;
    const now2 = this.now();
    let reclaimed = 0;
    for (const [teamId, entry] of [...this.teams.entries()]) {
      if (entry.host === null || entry.inflight > 0) continue;
      if (now2 - entry.lastUsedAt < this.idleReclaimMs) continue;
      this.teams.delete(teamId);
      const host = entry.host;
      try {
        await host.close();
        reclaimed += 1;
      } catch (err) {
        this.opts.warn?.(
          `agent-team idle host close failed for "${teamId}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    if (reclaimed > 0) this.opts.warn?.(`agent-team reclaimed ${reclaimed} idle team host(s)`);
    return reclaimed;
  }
  ensureIdleSweep() {
    if (this.idleTimer !== null || this.idleReclaimMs <= 0) return;
    this.idleTimer = setInterval(() => void this.sweepIdleHosts(), IDLE_SWEEP_MS);
    this.idleTimer.unref?.();
  }
  /** 诊断：某团队 host 是否已开且为协调者（契约测试用）。 */
  modeOf(teamId) {
    const entry = this.teams.get(teamId);
    return entry?.host?.currentMode ?? "unopened";
  }
  async close() {
    if (this.idleTimer !== null) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    const entries = [...this.teams.values()];
    this.teams.clear();
    const errors = [];
    for (const entry of entries) {
      try {
        const host = await entry.opening;
        await host.close();
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Agent Teams tool backend close failed");
    }
  }
  // ---------------------------------------------------------------- 9 工具操作
  /** spawn_teammate（02 §9.3；context 缺省 fresh 由域层承担；〔对齐轮〕0.2.1：初始任务不含身份前缀）。
   *  参数原值直传——类型/枚举守卫在方法表 requireString/optionalString（冻结消息）。
   *  0.4.0：model/thoughtLevel 参数注销——成员模型唯一路线 = provider 每轮跟随 Lead 最新
   *  已确认选择；Lead 模型不可继承（官方套餐/目录外/解析不出）时 provider 抛错 → 本调用报错。 */
  async spawnTeammate(identity, args) {
    return this.withHost(
      identity.teamId,
      async (host) => await host.dispatch("member.spawn", {
        session_id: identity.agentId,
        name: args.name,
        description: args.description,
        prompt: args.prompt,
        ...args.context !== void 0 ? { context: args.context } : {}
      })
    );
  }
  // 0.4.0 注销 setMemberModel / resolveModelArgs / leadProviderId / catalog / wireModelSelection /
  // validateThoughtLevel（成员模型没有独立配置通道；stage-8 原文见 traceability §18 与 git 历史）。
  /** list_agents 的行派生（协调者 = roster 全保真；代理 = 本地重放派生）。 */
  async memberRows(host, identity) {
    const runtime = host.teamRuntime;
    if (runtime !== null) {
      return runtime.roster.listMembers(identity.agentId).members;
    }
    const loaded = await host.readBoard();
    requireMembership(
      () => {
        if (loaded.state.failure !== void 0) throw new Error(loaded.state.failure);
        return loaded.state;
      },
      identity.agentId
    );
    return memberRowsFromState(loaded.state.id, loaded.state.members, identity.agentId);
  }
  /** send_message（02 §9.5；内容映射 content=[{type:"text",text:message}]，target 原值直传）。
   *  〔对齐轮〕0.2.1：工具层输出 {sent:true}（不暴露 messageId；投递状态为内部适配层）。 */
  async sendMessage(identity, args) {
    const content = [{ type: "text", text: args.message }];
    return this.withHost(identity.teamId, async (host) => {
      await host.dispatch("message.send", {
        session_id: identity.agentId,
        targetName: args.target,
        content
      });
      return { sent: true };
    });
  }
  /** list_agents（02 §9.6；输出 MEMBER_VIEW[]，Lead 伪行 target="lead"）。 */
  async listAgents(identity) {
    return this.withHost(identity.teamId, (host) => this.memberRows(host, identity));
  }
  /** interrupt_agent（02 §9.8；Lead-only 域层校验，工具层不放宽；target 原值直传）。
   *  〔对齐轮〕0.2.1 D3：interrupt=false 时本工具未注册——调用按「未知工具」拒绝（handlers 承担）。 */
  async interruptAgent(identity, args) {
    return this.withHost(
      identity.teamId,
      async (host) => await host.dispatch("member.interrupt", {
        session_id: identity.agentId,
        name: args.target
      })
    );
  }
  /**
   * wait_agent（02 §9.7/§8）：缺省 30000 → 非法值绕过捷径直报 TEAM_INVALID_TIMEOUT
   * → 合法则先跑 no-active-peer 捷径（仅协调者模式可评估）→ 否则注册等待
   * （等待期 progress 保活 ≤10s；代理模式经 socket 且按调用豁免超时）。
   */
  async waitAgent(identity, args, emitProgress, signal) {
    const raw = args.timeout_ms;
    const timeoutMs = raw === void 0 ? WAIT_DEFAULT_TIMEOUT_MS : raw;
    return this.withHost(identity.teamId, async (host) => {
      if (!isValidTimeout(timeoutMs)) {
        if (typeof timeoutMs === "number") {
          return await host.dispatch(
            "wait.agent",
            { session_id: identity.agentId, timeoutMs },
            signal !== void 0 ? { signal } : {}
          );
        }
        throw new TeamError(
          "TEAM_INVALID_TIMEOUT",
          "timeoutMs must be an integer from 10000 through 3600000"
        );
      }
      const runtime = host.teamRuntime;
      let wait;
      if (runtime !== null) {
        const rows = runtime.roster.listMembers(identity.agentId).members;
        const selfTarget = identity.role === "lead" ? "lead" : identity.name;
        const hasActivePeer = rows.some(
          (row) => row.target !== selfTarget && (row.status === "running" || row.status === "provisioning")
        );
        if (!hasActivePeer) return noProgressResult();
        wait = host.dispatch(
          "wait.agent",
          { session_id: identity.agentId, timeoutMs },
          signal !== void 0 ? { signal } : {}
        );
      } else {
        const { teamDir } = teamPaths(this.opts.dataRoot, identity.teamId);
        wait = callCoordinator(
          teamDir,
          identity.teamId,
          "wait.agent",
          { session_id: identity.agentId, timeoutMs },
          {
            timeoutMs: timeoutMs + WAIT_AGENT_GRACE_MS,
            ...signal !== void 0 ? { signal } : {}
          }
        );
      }
      return emitProgress === void 0 ? wait : withKeepAlive(wait, emitProgress);
    });
  }
  /** team_task_create（02 §9.9；snake_case → 方法表参数，原值直传）。 */
  async taskCreate(identity, args) {
    return this.withHost(identity.teamId, async (host) => {
      const result = await host.dispatch("task.create", {
        session_id: identity.agentId,
        subject: args.subject,
        description: args.description,
        ...args.blocked_by !== void 0 ? { blockedBy: args.blocked_by } : {},
        ...args.write_scopes !== void 0 ? { writeScopes: args.write_scopes } : {}
      });
      return result.task;
    });
  }
  /** team_task_list（02 §9.10；过滤/分页语义与越界消息逐字由域层承担；类型守卫在 handlers）。 */
  async taskList(identity, args) {
    return this.withHost(
      identity.teamId,
      async (host) => await host.dispatch("task.list", {
        session_id: identity.agentId,
        ...args.status !== void 0 ? { status: args.status } : {},
        ...args.owner !== void 0 ? { owner: args.owner } : {},
        ...args.ready !== void 0 ? { ready: args.ready } : {},
        ...args.cursor !== void 0 ? { cursor: args.cursor } : {},
        ...args.limit !== void 0 ? { limit: args.limit } : {}
      })
    );
  }
  /** team_task_get（02 §9.11；含 deleted 墓碑）。 */
  async taskGet(identity, args) {
    return this.withHost(identity.teamId, async (host) => {
      const result = await host.dispatch("task.get", {
        session_id: identity.agentId,
        taskId: args.task_id
      });
      return result.task;
    });
  }
  /** team_task_update（02 §9.12；CAS 直传，原值交方法表校验）。 */
  async taskUpdate(identity, args) {
    return this.withHost(identity.teamId, async (host) => {
      const result = await host.dispatch("task.update", {
        session_id: identity.agentId,
        taskId: args.task_id,
        expectedRevision: args.expected_revision,
        action: args.action,
        ...args.subject !== void 0 ? { subject: args.subject } : {},
        ...args.description !== void 0 ? { description: args.description } : {},
        ...args.blocked_by !== void 0 ? { blockedBy: args.blocked_by } : {},
        ...args.write_scopes !== void 0 ? { writeScopes: args.write_scopes } : {},
        ...args.owner !== void 0 ? { owner: args.owner } : {}
      });
      return result.task;
    });
  }
  /**
   * teammate 启动参数接口（T3.4；实参注入归 stage-4 provider）。
   * D6 对齐：--disallowed-tools Task（遮蔽一次性子代理工具，本阶段只留接口）。
   */
  static teammateDisallowedTools() {
    return ["Task"];
  }
};
function isValidTimeout(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= WAIT_MIN_TIMEOUT_MS && value <= WAIT_MAX_TIMEOUT_MS;
}
var MEMBER_STATUS_BY_PHASE = {
  active: "inactive",
  provisioning: "provisioning",
  failed: "failed"
};
function memberRowsFromState(teamId, members, callerId) {
  const rows = [
    { target: "lead", role: "lead", status: teamId === callerId ? "running" : "inactive", diagnostics: [] }
  ];
  for (const member of members) {
    rows.push({
      target: member.name,
      role: "teammate",
      status: MEMBER_STATUS_BY_PHASE[member.phase],
      description: member.description,
      provider: member.provider,
      context: member.context,
      diagnostics: member.error !== void 0 ? [member.error] : []
    });
  }
  return rows;
}
async function withKeepAlive(wait, emitProgress, intervalMs = WAIT_PROGRESS_INTERVAL_MS) {
  let tick = 0;
  const timer = setInterval(() => {
    tick += 1;
    void emitProgress(tick, "waiting for team activity").catch(() => void 0);
  }, intervalMs);
  try {
    return await wait;
  } finally {
    clearInterval(timer);
  }
}

// src/mcp/tools.ts
var PANEL_RESOURCE_URI = "ui://agent-team/team-panel.html";
var PANEL_SURFACE_ID = "agent-team-panel";
var TEAM_TOOL_DEFINITIONS = [
  {
    // 02 §9.3
    name: "spawn_teammate",
    description: "Create one named, durable teammate. Only the Team Lead may call this tool. In orchestrator mode, create teammates proactively when the goal benefits from delegation, within the member limit. The teammate automatically follows the Lead's latest confirmed model and reasoning level on every turn; there is no per-member model option.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique lower-kebab-case teammate name." },
        description: { type: "string", description: "Short description of the delegated responsibility." },
        prompt: { type: "string", description: "Complete initial task for the teammate." },
        context: {
          type: "string",
          enum: ["fresh", "fork"],
          description: "fresh starts without Lead history; fork inherits completed Lead turns. Defaults to fresh."
        }
      },
      required: ["name", "description", "prompt"],
      additionalProperties: false
    },
    _meta: {
      ui: { resourceUri: PANEL_RESOURCE_URI, surface: PANEL_SURFACE_ID }
    }
  },
  {
    // 02 §9.5（〔对齐轮〕0.2.1 描述：删 "durable"、"durable message"→"message"）
    name: "send_message",
    description: "Send one message to another Team member. A running target receives it at the nearest step boundary; an inactive target starts or resumes a turn.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Member target returned by spawn_teammate or list_agents, including lead."
        },
        message: { type: "string", description: "Self-contained message for the target." }
      },
      required: ["target", "message"],
      additionalProperties: false
    }
  },
  {
    // 02 §9.6
    name: "list_agents",
    description: "List the Lead and every durable teammate with an addressable target and current availability. inactive means no turn is executing, not a task result. provisioning and failed describe member creation.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    // 02 §9.8
    name: "interrupt_agent",
    description: "Interrupt one teammate's current turn while preserving its pending inbox. Team Lead only.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Teammate target returned by spawn_teammate or list_agents."
        }
      },
      required: ["target"],
      additionalProperties: false
    }
  },
  // 0.4.0 注销 member_set_model（02 §9.13）：成员模型没有独立配置通道，唯一路线 = 每轮
  // 跟随 Lead 最新已确认选择；原规格条目见 traceability §18 与 git 历史。
  {
    // 02 §9.7（〔对齐轮〕0.2.1 描述："mailbox"→"message"）
    name: "wait_agent",
    description: "Wait for the next teammate status, message, or shared-task change after this call starts. This never wakes inactive members and returns noProgress immediately when no other member is running or provisioning. Re-list after wakeup or timeout instead of polling.",
    inputSchema: {
      type: "object",
      properties: {
        timeout_ms: {
          type: "integer",
          description: "Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000."
        }
      },
      additionalProperties: false
    }
  },
  {
    // 02 §9.9
    name: "team_task_create",
    description: "Create one unowned pending task on the shared Team task board.",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Concise task title." },
        description: { type: "string", description: "Complete task details and acceptance criteria." },
        blocked_by: { type: "array", items: { type: "string" }, description: "Task ids that must complete first." },
        write_scopes: {
          type: "array",
          items: { type: "string" },
          description: "Advisory workspace-relative file or directory prefixes this task expects to modify."
        }
      },
      required: ["subject", "description"],
      additionalProperties: false
    }
  },
  {
    // 02 §9.10
    name: "team_task_list",
    description: "List shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed"],
          description: "Optional exact status filter."
        },
        owner: {
          type: "string",
          description: "Optional member target from spawn_teammate or list_agents, matching ownerName; use unowned for tasks without an owner."
        },
        ready: { type: "boolean", description: "Optional readiness filter." },
        cursor: { type: "integer", description: "Zero-based result offset. Defaults to 0." },
        limit: { type: "integer", description: "Number of rows, 1 through 100. Defaults to 50." }
      },
      additionalProperties: false
    }
  },
  {
    // 02 §9.11
    name: "team_task_get",
    description: "Read the complete latest value of one shared task before changing or executing it.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Shared task id." }
      },
      required: ["task_id"],
      additionalProperties: false
    }
  },
  {
    // 02 §9.12
    name: "team_task_update",
    description: "Compare-and-set a shared task action using the latest revision from team_task_get or team_task_list. In orchestrator mode, the Lead verifies a completed task and reopens it with concrete findings on failure.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Shared task id." },
        expected_revision: {
          type: "integer",
          description: "Current task revision used as the CAS precondition."
        },
        action: {
          type: "string",
          enum: ["claim", "release", "edit", "set_dependencies", "complete", "reopen", "reassign", "delete"],
          description: "Task transition to apply."
        },
        subject: { type: "string", description: "Replacement title for edit." },
        description: {
          type: "string",
          description: "Replacement details for edit; for reopen, the concrete findings that failed verification."
        },
        blocked_by: {
          type: "array",
          items: { type: "string" },
          description: "Complete blocker list for set_dependencies."
        },
        write_scopes: {
          type: "array",
          items: { type: "string" },
          description: "Replacement advisory write scopes for edit."
        },
        owner: {
          type: "string",
          description: "Member target from spawn_teammate or list_agents for Lead-only reassign; omit to unassign."
        }
      },
      required: ["task_id", "expected_revision", "action"],
      additionalProperties: false
    }
  }
];
var TEAM_TOOL_NAMES = new Set(TEAM_TOOL_DEFINITIONS.map((t) => t.name));
function teamToolDefinitions(options = {}) {
  const interrupt = options.interrupt ?? true;
  return interrupt ? TEAM_TOOL_DEFINITIONS : TEAM_TOOL_DEFINITIONS.filter((t) => t.name !== "interrupt_agent");
}

// src/mcp/results.ts
function compactJson(value) {
  return JSON.stringify(value);
}
function successResult(value) {
  return { content: [{ type: "text", text: compactJson(value) }] };
}
function errorResult(err) {
  const body = normalizeError(err);
  return {
    isError: true,
    content: [{ type: "text", text: compactJson({ error: body }) }]
  };
}
function normalizeError(err) {
  if (isTeamError(err)) return { code: err.code, message: err.message };
  if (err instanceof AggregateError) {
    const first = err.errors.find(isTeamError);
    if (first !== void 0) {
      return { code: first.code, message: `${err.message}: ${first.message}` };
    }
    const firstPlain = err.errors[0];
    return {
      message: err.message + (firstPlain !== void 0 ? `: ${firstPlain instanceof Error ? firstPlain.message : String(firstPlain)}` : "")
    };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}
function withFailLoud(result, identity) {
  if (identity.hookRegistered) return result;
  return { ...result, content: [...result.content, { type: "text", text: FAIL_LOUD_WARNING }] };
}

// src/mcp/identity.ts
import fs8 from "node:fs";
import path7 from "node:path";
function sessionMapPath(dataRoot) {
  return path7.join(dataRoot, "session-map.json");
}
function safeSessionKey(sessionId) {
  return sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
}
function registryLockPath(dataRoot) {
  return `${sessionMapPath(dataRoot)}.lock`;
}
function withRegistryLock(dataRoot, fn) {
  const lock = registryLockPath(dataRoot);
  const started = Date.now();
  let fd = null;
  while (Date.now() - started < 2e3) {
    try {
      fd = fs8.openSync(lock, "wx", 384);
      break;
    } catch {
      try {
        const stat = fs8.statSync(lock);
        if (Date.now() - stat.mtimeMs > 5e3) fs8.unlinkSync(lock);
      } catch {
      }
      const until = Date.now() + 20;
      while (Date.now() < until) {
      }
    }
  }
  try {
    fn();
  } finally {
    if (fd !== null) {
      try {
        fs8.closeSync(fd);
        fs8.unlinkSync(lock);
      } catch {
      }
    }
  }
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
function upsertSessionEntry(dataRoot, sessionId, patch) {
  const file = sessionMapPath(dataRoot);
  try {
    fs8.mkdirSync(path7.dirname(file), { recursive: true });
    withRegistryLock(dataRoot, () => {
      let registry2 = {};
      try {
        const parsed = JSON.parse(fs8.readFileSync(file, "utf8"));
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          registry2 = parsed;
        }
      } catch (err) {
        if (err.code !== "ENOENT") {
          try {
            fs8.renameSync(file, `${file}.corrupt-${Date.now()}`);
          } catch {
          }
        }
      }
      const key = safeSessionKey(sessionId);
      const prior = registry2[key] ?? {};
      registry2[key] = { ...prior, ...patch, session_id: sessionId };
      const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
      const fd = fs8.openSync(tmp, "w", 384);
      try {
        fs8.writeFileSync(fd, JSON.stringify(registry2, null, 2));
        fs8.fsyncSync(fd);
      } finally {
        fs8.closeSync(fd);
      }
      fs8.renameSync(tmp, file);
    });
  } catch {
  }
}
function resolveIdentity(opts) {
  const metaSession = opts.meta?.session_id;
  let sessionId;
  let source = "meta";
  if (typeof metaSession === "string" && metaSession.length > 0) {
    sessionId = metaSession;
  } else {
    const windowMs = opts.fallbackWindowMs ?? 3e5;
    const candidates = [];
    for (const entry2 of Object.values(readSessionRegistry(opts.dataRoot))) {
      if (typeof entry2?.session_id !== "string") continue;
      const firstSeen = entry2.firstSeen !== void 0 ? Date.parse(entry2.firstSeen) : NaN;
      if (Number.isNaN(firstSeen)) continue;
      if (Math.abs(firstSeen - opts.bootTimeMs) <= windowMs) candidates.push(entry2);
    }
    if (candidates.length === 1) {
      sessionId = candidates[0].session_id;
      source = "hook-map";
    }
  }
  if (sessionId === void 0) {
    throw notMemberError("<unknown>");
  }
  const registry2 = readSessionRegistry(opts.dataRoot);
  const entry = registry2[safeSessionKey(sessionId)] ?? {};
  const runtimeScope = opts.meta?.runtime_scope;
  const hookRegistered = entry.hookRegistered === true;
  if (entry.role === "teammate" && typeof entry.teamId === "string" && entry.teamId.length > 0) {
    touch(opts, sessionId, entry, source);
    const memberId = typeof entry.memberId === "string" && entry.memberId.length > 0 ? entry.memberId : sessionId;
    return {
      sessionId,
      teamId: entry.teamId,
      role: "teammate",
      name: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : sessionId,
      agentId: memberId,
      source,
      hookRegistered
    };
  }
  if (runtimeScope === "subagent") {
    throw notMemberError(sessionId);
  }
  touch(opts, sessionId, entry, source);
  return {
    sessionId,
    teamId: sessionId,
    role: "lead",
    name: "lead",
    agentId: sessionId,
    source,
    hookRegistered
  };
}
function notMemberError(agentId) {
  return new TeamError(
    "TEAM_NOT_MEMBER",
    `agent "${agentId}" is not a member of an active Agent Team`
  );
}
function touch(opts, sessionId, entry, source) {
  const patch = {
    lastSeen: ts(),
    ...entry.firstSeen === void 0 ? { firstSeen: ts() } : {},
    ...entry.hookRegistered === true ? { hookRegistered: true } : {}
  };
  if (entry.session_id === void 0 || source === "hook-map") patch.session_id = sessionId;
  upsertSessionEntry(opts.dataRoot, sessionId, patch);
}

// src/mcp/handlers.ts
async function handleTeamToolCall(opts, tool) {
  let identity;
  try {
    identity = resolveIdentity({
      dataRoot: opts.dataRoot,
      meta: opts.meta,
      bootTimeMs: opts.bootTimeMs,
      ...opts.now !== void 0 ? { now: opts.now } : {}
    });
  } catch (err) {
    return errorResult(err);
  }
  try {
    const result = await dispatch(opts, identity, tool);
    return withFailLoud(successResult(result), identity);
  } catch (err) {
    return withFailLoud(errorResult(err), identity);
  }
}
async function dispatch(opts, identity, tool) {
  const { backend: backend2, args } = opts;
  switch (tool) {
    case "spawn_teammate":
      return backend2.spawnTeammate(identity, {
        name: args.name,
        description: args.description,
        prompt: args.prompt,
        ...args.context !== void 0 ? { context: args.context } : {}
      });
    case "send_message":
      guardNonEmptyString(args.message, "message");
      return backend2.sendMessage(identity, { target: args.target, message: args.message });
    case "list_agents":
      return backend2.listAgents(identity);
    case "interrupt_agent":
      if (!backend2.interruptEnabled) throw new TypeError("unsupported team tool: interrupt_agent");
      return backend2.interruptAgent(identity, { target: args.target });
    // 0.4.0 注销 member_set_model case（工具面 9 个；未知工具由上游分派拒绝）。
    case "wait_agent":
      return backend2.waitAgent(
        identity,
        { ...args.timeout_ms !== void 0 ? { timeout_ms: args.timeout_ms } : {} },
        opts.emitProgress,
        opts.signal
      );
    case "team_task_create":
      return backend2.taskCreate(identity, {
        subject: args.subject,
        description: args.description,
        ...args.blocked_by !== void 0 ? { blocked_by: args.blocked_by } : {},
        ...args.write_scopes !== void 0 ? { write_scopes: args.write_scopes } : {}
      });
    case "team_task_list":
      if (args.ready !== void 0 && typeof args.ready !== "boolean") {
        throw invalidArg('param "ready" must be a boolean');
      }
      if (args.cursor !== void 0) guardSafeInteger(args.cursor, "cursor");
      if (args.limit !== void 0) guardSafeInteger(args.limit, "limit");
      if (args.status !== void 0 && args.status !== "pending" && args.status !== "in_progress" && args.status !== "completed") {
        throw invalidArg('param "status" must be one of pending, in_progress, completed');
      }
      return backend2.taskList(identity, {
        ...args.status !== void 0 ? { status: args.status } : {},
        ...args.owner !== void 0 ? { owner: args.owner } : {},
        ...args.ready !== void 0 ? { ready: args.ready } : {},
        ...args.cursor !== void 0 ? { cursor: args.cursor } : {},
        ...args.limit !== void 0 ? { limit: args.limit } : {}
      });
    case "team_task_get":
      return backend2.taskGet(identity, { task_id: args.task_id });
    case "team_task_update":
      return backend2.taskUpdate(identity, {
        task_id: args.task_id,
        expected_revision: args.expected_revision,
        action: args.action,
        ...args.subject !== void 0 ? { subject: args.subject } : {},
        ...args.description !== void 0 ? { description: args.description } : {},
        ...args.blocked_by !== void 0 ? { blocked_by: args.blocked_by } : {},
        ...args.write_scopes !== void 0 ? { write_scopes: args.write_scopes } : {},
        ...args.owner !== void 0 ? { owner: args.owner } : {}
      });
    default:
      throw new TypeError(`unsupported team tool: ${tool}`);
  }
}
function invalidArg(message) {
  return new TeamError("TEAM_INVALID_ARGUMENT", message);
}
function guardNonEmptyString(v, key) {
  if (typeof v !== "string" || v.length === 0) {
    throw invalidArg(`param "${key}" must be a non-empty string`);
  }
}
function guardSafeInteger(v, key) {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) {
    throw invalidArg(`param "${key}" must be a safe integer`);
  }
}
function isTeamTool(name) {
  return TEAM_TOOL_NAMES.has(name);
}

// src/mcp/registry.ts
function listTeamTools(options = {}) {
  return teamToolDefinitions(options).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    ...t._meta !== void 0 ? { _meta: t._meta } : {}
  }));
}
async function callTeamTool(input, notifier) {
  const emitProgress = buildProgressSink(input, notifier);
  return handleTeamToolCall(
    {
      backend: input.backend,
      dataRoot: input.dataRoot,
      bootTimeMs: input.bootTimeMs,
      meta: input.meta,
      args: input.args,
      ...emitProgress !== void 0 ? { emitProgress } : {},
      ...input.signal !== void 0 ? { signal: input.signal } : {},
      ...input.now !== void 0 ? { now: input.now } : {}
    },
    input.name
  );
}
function buildProgressSink(input, notifier) {
  if (input.name !== "wait_agent") return void 0;
  const token = input.meta?.progressToken;
  if (notifier === void 0 || token === void 0) return void 0;
  if (typeof token !== "string" && typeof token !== "number") return void 0;
  return async (progress, message) => {
    try {
      await notifier.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken: token,
          progress,
          ...message !== void 0 ? { message } : {}
        }
      });
    } catch {
    }
  };
}

// src/provider/resume-provider.ts
import { createHash as createHash2 } from "node:crypto";
import fs18 from "node:fs";
import path17 from "node:path";

// src/provider/lead-wake.ts
import fs11 from "node:fs";
import path10 from "node:path";

// src/provider/procgroup.ts
import { execFile } from "node:child_process";
import fs10 from "node:fs";
import path9 from "node:path";
import { fileURLToPath } from "node:url";

// src/provider/member-files.ts
import fs9 from "node:fs";
import path8 from "node:path";
function memberPaths(teamDir, memberId) {
  const memberDir = path8.join(teamDir, "members", memberId);
  const runDir = path8.join(memberDir, "run");
  return {
    memberDir,
    originFile: path8.join(memberDir, "origin.json"),
    receiptsFile: path8.join(memberDir, "receipts.jsonl"),
    stopBudgetFile: path8.join(memberDir, "stop-budget.json"),
    runDir,
    currentFile: path8.join(runDir, "current.json"),
    drainMarkerFile: path8.join(runDir, "drain-requested.json"),
    modelFailedFile: path8.join(memberDir, "model-failed.json")
  };
}
function turnFile(runDir, turnId) {
  return path8.join(runDir, `${turnId}.json`);
}
function writeJsonAtomic(file, value) {
  fs9.mkdirSync(path8.dirname(file), { recursive: true, mode: 448 });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs9.openSync(tmp, "w", 384);
  try {
    fs9.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs9.fsyncSync(fd);
  } finally {
    fs9.closeSync(fd);
  }
  fs9.renameSync(tmp, file);
}
function readJson(file) {
  let raw;
  try {
    raw = fs9.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return void 0;
    throw err;
  }
  return JSON.parse(raw);
}
function writeOrigin(paths, origin) {
  writeJsonAtomic(paths.originFile, origin);
}
function readOrigin(paths) {
  return readJson(paths.originFile);
}
function writeTurn(runDir, turn) {
  writeJsonAtomic(turnFile(runDir, turn.turnId), turn);
}
function readTurn(runDir, turnId) {
  return readJson(turnFile(runDir, turnId));
}
function setCurrentTurn(paths, turnId) {
  writeJsonAtomic(paths.currentFile, { turnId });
}
function readCurrentTurnId(paths) {
  return readJson(paths.currentFile)?.turnId;
}
function listTurns(runDir) {
  let names;
  try {
    names = fs9.readdirSync(runDir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return names.filter((n) => /^turn-\d+\.json$/.test(n)).sort((a, b) => turnNumber(a) - turnNumber(b)).map((n) => readJson(path8.join(runDir, n))).filter((t) => t !== void 0);
}
function turnNumber(name) {
  return Number(name.slice("turn-".length, -".json".length));
}
function nextTurnId(runDir) {
  let names = [];
  try {
    names = fs9.readdirSync(runDir);
  } catch {
  }
  let max = 0;
  for (const n of names) {
    if (/^turn-\d+\.json$/.test(n)) max = Math.max(max, turnNumber(n));
  }
  return `turn-${max + 1}`;
}
function appendReceipt(paths, receipt) {
  fs9.mkdirSync(path8.dirname(paths.receiptsFile), { recursive: true, mode: 448 });
  const fd = fs9.openSync(paths.receiptsFile, "a", 384);
  try {
    fs9.writeFileSync(fd, JSON.stringify(receipt) + "\n");
    fs9.fsyncSync(fd);
  } finally {
    fs9.closeSync(fd);
  }
}
function readReceipts(paths) {
  let raw;
  try {
    raw = fs9.readFileSync(paths.receiptsFile, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const receipts = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    receipts.push(JSON.parse(line));
  }
  return receipts;
}
function receiptMessageIds(paths) {
  return new Set(readReceipts(paths).map((r) => r.messageId));
}
function readStopBudget(paths) {
  return readJson(paths.stopBudgetFile);
}
function writeStopBudget(paths, budget) {
  writeJsonAtomic(paths.stopBudgetFile, budget);
}
function readModelFailed(paths) {
  return readJson(paths.modelFailedFile);
}
function writeModelFailed(paths, record2) {
  writeJsonAtomic(paths.modelFailedFile, record2);
}
function clearModelFailed(paths) {
  try {
    fs9.unlinkSync(paths.modelFailedFile);
  } catch {
  }
}

// src/provider/procgroup.ts
var HELPER_DEFAULT = path9.join(path9.dirname(fileURLToPath(import.meta.url)), "detach-helper.mjs");
var SPAWN_HELPER_TIMEOUT_MS = 1e4;
async function spawnDetached(spec) {
  const dir = path9.dirname(spec.stdoutFile);
  const specFile = spec.specFile ?? path9.join(dir, `${path9.basename(spec.stdoutFile, ".out")}.spec.json`);
  const resultFile = spec.resultFile ?? path9.join(dir, `${path9.basename(spec.stdoutFile, ".out")}.spawn.json`);
  const specDoc = {
    command: spec.command,
    argv: spec.argv,
    cwd: spec.cwd,
    stdoutFile: spec.stdoutFile,
    resultFile
  };
  if (spec.persistEnv === true) specDoc.env = spec.env;
  writeJsonAtomic(specFile, specDoc);
  const helper = process.env.TEAM_DETACH_HELPER ?? HELPER_DEFAULT;
  await new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["--", helper, specFile],
      { timeout: SPAWN_HELPER_TIMEOUT_MS, cwd: spec.cwd, env: spec.env },
      (err) => {
        if (err) reject(new Error(`detach helper failed: ${err.message}`));
        else resolve();
      }
    );
  });
  let result;
  try {
    result = JSON.parse(fs10.readFileSync(resultFile, "utf8"));
  } catch (err) {
    throw new Error(`detach helper produced no result file: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof result.error === "string") {
    throw new Error(`turn process launch failed: ${result.error}`);
  }
  return { pid: result.pid ?? null, pgid: result.pid ?? null, stdoutFile: spec.stdoutFile, specFile, resultFile };
}
function pidAlive(pid) {
  if (pid === null || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
function pgidAlive(pgid) {
  if (pgid === null || !Number.isInteger(pgid) || pgid <= 0) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
async function killProcessGroup(pgid, graceMs) {
  if (pgid === null || pgid <= 0) return true;
  signalGroup(pgid, "SIGTERM");
  for (let waited = 0; waited < graceMs; waited += 50) {
    await sleep3(50);
    if (!pgidAlive(pgid) && !pidAlive(pgid)) return true;
  }
  if (pgidAlive(pgid) || pidAlive(pgid)) {
    signalGroup(pgid, "SIGKILL");
    for (let waited = 0; waited < 2e3; waited += 50) {
      await sleep3(50);
      if (!pgidAlive(pgid) && !pidAlive(pgid)) return true;
    }
  }
  return !pgidAlive(pgid) && !pidAlive(pgid);
}
function signalGroup(pgid, sig) {
  try {
    process.kill(-pgid, sig);
  } catch (err) {
    if (err.code !== "ESRCH") {
      throw err;
    }
  }
}
function sleep3(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/provider/lead-wake.ts
var WAKE_COOLDOWN_MS = 3e4;
var WAKE_LOCK_STALE_MS = 12e4;
var WAKE_PROMPT = "[agent-team] \u4F60\u6709\u5F85\u6536\u56E2\u961F\u6D88\u606F\u3002\u8BF7\u53EA\u5904\u7406\u6536\u4EF6\u7BB1\uFF08\u8BFB\u53D6\u5E76\u56DE\u590D\u6458\u8981\uFF09\uFF0C\u4E0D\u8981\u6267\u884C\u5176\u4ED6\u4EFB\u52A1\u3002";
function leadDir(teamDir) {
  return path10.join(teamDir, "lead");
}
function leadStatePath(teamDir) {
  return path10.join(leadDir(teamDir), "state.json");
}
function wakeLockPath(teamDir) {
  return path10.join(leadDir(teamDir), "wake.lock");
}
function readLeadState(teamDir) {
  try {
    const parsed = JSON.parse(fs11.readFileSync(leadStatePath(teamDir), "utf8"));
    if (typeof parsed.active !== "boolean" || typeof parsed.updatedAt !== "string") return void 0;
    return parsed;
  } catch {
    return void 0;
  }
}
function writeLeadState(teamDir, state) {
  const dir = leadDir(teamDir);
  fs11.mkdirSync(dir, { recursive: true });
  const file = leadStatePath(teamDir);
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs11.openSync(tmp, "w", 384);
  try {
    fs11.writeFileSync(fd, JSON.stringify(state, null, 2));
    fs11.fsyncSync(fd);
  } finally {
    fs11.closeSync(fd);
  }
  fs11.renameSync(tmp, file);
}
function acquireLock(teamDir, now2) {
  const dir = leadDir(teamDir);
  fs11.mkdirSync(dir, { recursive: true });
  const file = wakeLockPath(teamDir);
  try {
    const fd = fs11.openSync(file, "wx", 384);
    fs11.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: now2 }));
    fs11.closeSync(fd);
    return true;
  } catch {
    try {
      const stat = fs11.statSync(file);
      if (now2 - stat.mtimeMs > WAKE_LOCK_STALE_MS) {
        fs11.unlinkSync(file);
        const fd = fs11.openSync(file, "wx", 384);
        fs11.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: now2 }));
        fs11.closeSync(fd);
        return true;
      }
    } catch {
    }
    return false;
  }
}
function releaseLock(teamDir) {
  try {
    fs11.unlinkSync(wakeLockPath(teamDir));
  } catch {
  }
}
async function maybeWakeLead(args) {
  if (process.env.TEAM_WAKE_LEAD !== "1") return Promise.resolve({ woke: false, reason: "disabled" });
  const now2 = args.now ?? Date.now();
  const state = readLeadState(args.teamDir);
  if (state === void 0) return Promise.resolve({ woke: false, reason: "no-lead-state" });
  if (state.active) return Promise.resolve({ woke: false, reason: "lead-active" });
  const updated = Date.parse(state.updatedAt);
  if (Number.isNaN(updated) || now2 - updated < args.minIdleMs) {
    return Promise.resolve({ woke: false, reason: "recent-activity" });
  }
  if (state.lastWakeAt !== void 0) {
    const last = Date.parse(state.lastWakeAt);
    if (!Number.isNaN(last) && now2 - last < WAKE_COOLDOWN_MS) {
      return Promise.resolve({ woke: false, reason: "cooldown" });
    }
  }
  if (!acquireLock(args.teamDir, now2)) return Promise.resolve({ woke: false, reason: "wake-locked" });
  const runDir = path10.join(leadDir(args.teamDir), "run");
  fs11.mkdirSync(runDir, { recursive: true });
  const stdoutFile = path10.join(runDir, `wake-${now2}.out`);
  try {
    const argv = [
      ...args.zcode.argvPrefix,
      "-p",
      WAKE_PROMPT,
      "--json",
      "--mode",
      "yolo",
      "--surface",
      "terminal",
      "--cwd",
      args.cwd,
      "--resume",
      args.leadSessionId
    ];
    if (args.launch !== void 0) {
      await args.launch({ command: args.zcode.command, argv, cwd: args.cwd, stdoutFile });
    } else {
      await spawnDetached({
        command: args.zcode.command,
        argv,
        env: process.env,
        cwd: args.cwd,
        stdoutFile
      });
    }
    writeLeadState(args.teamDir, { ...state, lastWakeAt: new Date(now2).toISOString() });
    return { woke: true, reason: "launched" };
  } catch (err) {
    return { woke: false, reason: `spawn-failed: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    releaseLock(args.teamDir);
  }
}
function leadWakeEnabled() {
  return process.env.TEAM_WAKE_LEAD === "1";
}

// src/provider/transcript.ts
import fs12 from "node:fs";
import os3 from "node:os";
import path11 from "node:path";
import { DatabaseSync } from "node:sqlite";
function defaultDbPath() {
  return process.env.TEAM_DB_PATH ?? path11.join(os3.homedir(), ".zcode", "cli", "db", "db.sqlite");
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
    if (!this.dbMissing) this.dbMissing = !fs12.existsSync(this.dbPath);
    else if (!fs12.existsSync(this.dbPath)) return true;
    else this.dbMissing = false;
    return this.dbMissing;
  }
  open() {
    if (this.db !== null) return this.db;
    if (!fs12.existsSync(this.dbPath)) {
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

// src/provider/framing.ts
function renderFramed(framedJson) {
  const blocks = JSON.parse(framedJson);
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error("framed message must be a non-empty JSON array of content blocks");
  }
  const header = blocks[0];
  if (header.type !== "text" || typeof header.text !== "string") {
    throw new Error("framed message first block must be the text header");
  }
  const m = header.text.match(/^Team message from (.+):$/);
  if (m === null) {
    throw new Error(`framed message header mismatch: ${JSON.stringify(header.text)}`);
  }
  const lines = [header.text];
  for (const block of blocks.slice(1)) {
    if (block.type === "text" && typeof block.text === "string") {
      lines.push(block.text);
    } else {
      lines.push(JSON.stringify(block));
    }
  }
  return { messageId: "", senderName: m[1], text: lines.join("\n") };
}
function renderFramedBatch(items) {
  const rendered = items.map((item) => ({ ...renderFramed(item.framedJson), messageId: item.messageId }));
  return { promptText: rendered.map((r) => r.text).join("\n\n"), rendered };
}

// src/provider/fork-context.ts
var FORK_HEADER = "[Agent Teams fork context] Your Team Lead's session transcript so far (for context inheritance):";
var FORK_FOOTER = "[End of fork context]";
function buildForkFirstPrompt(reader, leadSessionId, task, opts = {}) {
  const maxChars = opts.maxChars ?? Number(process.env.TEAM_FORK_MAX_CHARS ?? 24e3);
  const turns = reader.exportTurns(leadSessionId);
  const kept = truncateTurns(turns, maxChars);
  const lines = [FORK_HEADER];
  kept.turns.forEach((turn, i) => {
    lines.push(`--- ${turn.role} #${i + 1} ---`);
    if (turn.text.length > 0) lines.push(turn.text);
    if (turn.toolNames.length > 0) lines.push(`[tools used: ${turn.toolNames.join(", ")}]`);
  });
  lines.push(FORK_FOOTER);
  lines.push("");
  lines.push(task);
  return {
    prompt: lines.join("\n"),
    includedTurns: kept.turns.length,
    truncated: kept.truncated
  };
}
function truncateTurns(turns, maxChars) {
  if (turns.length === 0) return { turns: [], truncated: false };
  const rendered = (t) => t.text.length > 0 ? t.text : `[tools used: ${t.toolNames.join(", ")}]`;
  const totalChars = turns.reduce((sum, t) => sum + rendered(t).length, 0);
  if (totalChars <= maxChars) return { turns: [...turns], truncated: false };
  const first = turns[0];
  const budget = maxChars - rendered(first).length;
  const tail = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 1; i--) {
    const cost = rendered(turns[i]).length;
    if (used + cost > budget && tail.length > 0) break;
    tail.unshift(turns[i]);
    used += cost;
  }
  return { turns: [first, ...tail], truncated: true };
}

// src/provider/zcode-bin.ts
import fs13 from "node:fs";
import path12 from "node:path";
import { execFileSync } from "node:child_process";
var DESKTOP_ZCODE_CJS = "/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs";
function resolveZcodeBin(env = process.env) {
  const explicit = env.TEAM_ZCODE_BIN;
  if (explicit && explicit.trim()) {
    return binFor(explicit.trim(), "env");
  }
  const rg = env.ZCODE_RG_BINARY;
  if (rg && rg.trim()) {
    const derived = path12.join(path12.dirname(path12.dirname(path12.dirname(rg))), "glm", "zcode.cjs");
    if (fs13.existsSync(derived)) return binFor(derived, "rg-derive");
  }
  if (fs13.existsSync(DESKTOP_ZCODE_CJS)) return binFor(DESKTOP_ZCODE_CJS, "desktop-default");
  try {
    const which = execFileSync("which", ["zcode"], { encoding: "utf8" }).trim();
    if (which.length > 0) return binFor(which, "which");
  } catch {
  }
  throw new Error(
    "cannot locate the zcode CLI binary: set TEAM_ZCODE_BIN (daemon env) or install ZCode Desktop"
  );
}
function binFor(p, source) {
  if (/\.(cjs|mjs|js)$/.test(p)) {
    return { command: process.execPath, argvPrefix: [p], source };
  }
  return { command: p, argvPrefix: [], source };
}

// src/provider/session-breeder.ts
import fs16 from "node:fs";
import os6 from "node:os";
import path15 from "node:path";
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";

// src/provider/app-server-client.mjs
import { execFile as execFile2 } from "node:child_process";
import fs14 from "node:fs";
import os4 from "node:os";
import path13 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var BRIDGE_DEFAULT = path13.join(path13.dirname(fileURLToPath2(import.meta.url)), "app-server-bridge.mjs");
var AppServerClient = class _AppServerClient {
  #child;
  #specFile;
  #buffer = "";
  #nextId = 1;
  #pending = /* @__PURE__ */ new Map();
  #notifications = [];
  #stderr = "";
  #closed = false;
  #exited = false;
  #log;
  constructor(opts) {
    this.#log = opts.log;
    const specDir = fs14.mkdtempSync(path13.join(os4.tmpdir(), "at-appserver-"));
    try {
      fs14.chmodSync(specDir, 448);
    } catch {
    }
    this.#specFile = path13.join(specDir, "spec.json");
    fs14.writeFileSync(
      this.#specFile,
      JSON.stringify({
        executable: opts.executable,
        argv: [...opts.argvPrefix, "app-server"],
        cwd: opts.cwd
      }),
      { mode: 384 }
    );
    const bridge = process.env.TEAM_APP_SERVER_BRIDGE ?? BRIDGE_DEFAULT;
    this.#child = execFile2(
      process.execPath,
      ["--", bridge, this.#specFile],
      { cwd: opts.cwd, timeout: 0, maxBuffer: 8 * 1024 * 1024, env: opts.env ?? process.env },
      (err) => {
        this.#exited = true;
        const error2 = err ?? new Error("app-server exited");
        for (const [, pending] of this.#pending) {
          clearTimeout(pending.timer);
          pending.reject(error2);
        }
        this.#pending.clear();
      }
    );
    this.#child.stdout?.on("data", (chunk) => this.#onStdout(String(chunk)));
    this.#child.stderr?.on("data", (chunk) => {
      this.#stderr += String(chunk);
      if (this.#stderr.length > 32e3) this.#stderr = this.#stderr.slice(-32e3);
    });
    this.#child.on("exit", () => {
      this.#exited = true;
    });
  }
  /** 校验可执行文件为绝对路径后启动（相对路径/空串一律拒绝）。 */
  static spawn(opts) {
    if (typeof opts.executable !== "string" || !path13.isAbsolute(opts.executable)) {
      throw new Error("app-server executable must be an absolute path");
    }
    return new _AppServerClient(opts);
  }
  #onStdout(text) {
    this.#buffer += text;
    let index;
    while ((index = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof message.id === "number" && this.#pending.has(message.id)) {
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error !== void 0) {
          const error2 = new Error(message.error.message ?? "app-server rpc error");
          error2.rpc = message.error;
          pending.reject(error2);
        } else {
          pending.resolve(message.result);
        }
        continue;
      }
      if (typeof message.method === "string") {
        this.#notifications.push({ method: message.method, params: message.params });
        if (message.id !== void 0 && message.id !== null) {
          const result = message.method === "session/requestRuntimePreferences" ? {
            nativeSearchEnhancementsEnabled: true,
            memoryEnabled: false,
            askUserQuestionAutoResolutionEnabled: true
          } : null;
          this.#write({ id: message.id, result });
        }
      }
    }
  }
  #write(message) {
    if (this.#closed || this.#child.stdin === null || this.#child.stdin.destroyed) return;
    this.#child.stdin.write(`${JSON.stringify(message)}
`);
  }
  /** 等待 startup/storageState ready（超时返回 false，不抛错）。 */
  async waitReady(timeoutMs = 2e4) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.#notifications.some(
        (n) => n.method === "startup/storageState" && n.params?.phase === "ready"
      )) {
        return true;
      }
      if (this.#exited) return false;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }
  rpc(method, params, timeoutMs = 3e4) {
    if (this.#closed) return Promise.reject(new Error("app-server client is closed"));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`app-server rpc timeout: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.#pending.set(id, { resolve, reject, timer });
      this.#write({ id, method, params });
    });
  }
  getStderr() {
    return this.#stderr;
  }
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const [, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("app-server client closed"));
    }
    this.#pending.clear();
    try {
      this.#child.stdin?.end();
    } catch {
    }
    if (!this.#exited) {
      try {
        this.#child.kill("SIGTERM");
      } catch {
      }
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          try {
            this.#child.kill("SIGKILL");
          } catch {
          }
          resolve();
        }, 1500);
        timer.unref?.();
        this.#child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    try {
      fs14.rmSync(path13.dirname(this.#specFile), { recursive: true, force: true });
    } catch {
    }
    this.#log?.({ event: "app-server-closed", stderrTail: this.#stderr.slice(-800) });
  }
};

// src/sidebar/tasks-index.ts
import fs15 from "node:fs";
import os5 from "node:os";
import path14 from "node:path";
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";
var ANCHOR_TITLE = "Agent Team anchor";
function defaultTasksIndexPath() {
  return process.env.TEAM_TASKS_INDEX ?? path14.join(os5.homedir(), ".zcode", "v2", "tasks-index.sqlite");
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
function tombstoneAnchor(input) {
  const dbPath = input.dbPath ?? defaultTasksIndexPath();
  if (!fs15.existsSync(dbPath)) return { applied: false, reason: "tasks-index-missing" };
  const now2 = input.now ?? Date.now();
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
        createdAt: now2,
        updatedAt: now2,
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
        now: now2,
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

// src/provider/session-breeder.ts
function defaultSessionDbPath() {
  return process.env.TEAM_DB_PATH ?? path15.join(os6.homedir(), ".zcode", "cli", "db", "db.sqlite");
}
var BreedError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "BreedError";
  }
};
var AppServerSessionBreeder = class {
  zcode;
  tasksIndexPath;
  dbPath;
  log;
  now;
  readyTimeoutMs;
  constructor(opts = {}) {
    this.zcode = opts.zcode ?? resolveZcodeBin();
    this.tasksIndexPath = opts.tasksIndexPath ?? defaultTasksIndexPath();
    this.dbPath = opts.dbPath ?? defaultSessionDbPath();
    this.log = opts.log ?? (() => void 0);
    this.now = opts.now ?? Date.now;
    this.readyTimeoutMs = opts.readyTimeoutMs ?? 2e4;
  }
  /**
   * 解析 Leader 会话的真实工作目录（只读）。
   * daemon 由宿主跨工作区复用，`TEAM_PROJECT_DIR` 可能来自首个启动工作区——
   * anchor 必须建在 Lead 自己的目录，否则 teammate 工具 cwd 会错。
   */
  resolveWorkspace(leadSessionId, fallback) {
    if (!fs16.existsSync(this.dbPath)) return path15.resolve(fallback);
    try {
      const db = new DatabaseSync3(this.dbPath, { readOnly: true });
      try {
        const row = db.prepare("select directory from session where id = ?").get(leadSessionId);
        if (typeof row?.directory === "string" && row.directory.length > 0) {
          return path15.resolve(row.directory);
        }
      } finally {
        db.close();
      }
    } catch {
    }
    return path15.resolve(fallback);
  }
  /**
   * 培育失败清理：把已创建的 anchor 再写一次 tombstone（幂等），防止 child 未建成时
   * anchor 暴露到左侧任务栏。仅 anchor 行（D25 白名单），不触碰其他行。
   */
  disposeBredSessions(input) {
    try {
      const result = tombstoneAnchor({
        taskId: input.anchorSessionId,
        workspacePath: input.workspacePath,
        dbPath: this.tasksIndexPath,
        now: this.now()
      });
      this.log({
        event: "session-breed-dispose",
        anchorSessionId: input.anchorSessionId,
        applied: result.applied,
        reason: result.reason ?? null
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log({ event: "session-breed-dispose-failed", anchorSessionId: input.anchorSessionId, message });
      return { applied: false, reason: message };
    }
  }
  /** 造一个隐藏子会话；失败抛 BreedError（不回退成可见会话——DSH 口径：失败即 failed 成员）。 */
  async createChild(input) {
    const startedAt = this.now();
    const workspacePath = this.resolveWorkspace(input.teamId, input.workspacePath);
    const client = this.#spawnClient(workspacePath);
    let anchorSessionId = null;
    let childSessionId = null;
    try {
      const ready = await client.waitReady(input.timeoutMs ?? this.readyTimeoutMs);
      if (!ready) {
        throw new BreedError(
          "startup-timeout",
          `app-server did not become ready within ${input.timeoutMs ?? this.readyTimeoutMs}ms`
        );
      }
      const anchorAck = await client.rpc("v4/command", {
        commandId: `team-anchor-${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
        clientId: "agent-team",
        sessionId: null,
        issuedAt: startedAt,
        type: "createSession",
        payload: { workspaceId: workspacePath, permissionScope: "session" }
      });
      const createdAnchorId = anchorAck?.result?.sessionId;
      if (typeof createdAnchorId !== "string" || createdAnchorId.length === 0) {
        throw new BreedError("create-rejected", describeAck("createSession", anchorAck));
      }
      anchorSessionId = createdAnchorId;
      const tombstone = tombstoneAnchor({
        taskId: anchorSessionId,
        workspacePath,
        dbPath: this.tasksIndexPath,
        now: this.now()
      });
      if (!tombstone.applied && tombstone.reason === "row-not-owned") {
        throw new BreedError(
          "create-rejected",
          `anchor "${anchorSessionId}" task row is not owned by agent-team; refusing to continue`
        );
      }
      const sideAck = await client.rpc("v4/command", {
        commandId: `team-child-${this.now()}-${Math.random().toString(36).slice(2, 8)}`,
        clientId: "agent-team",
        sessionId: anchorSessionId,
        issuedAt: this.now(),
        type: "createSelectionSideSession",
        payload: {}
      });
      const createdChildId = sideAck?.result?.sessionId;
      if (typeof createdChildId !== "string" || createdChildId.length === 0) {
        throw new BreedError("command-rejected", describeAck("createSelectionSideSession", sideAck));
      }
      childSessionId = createdChildId;
      let appliedModel;
      if (input.modelSelection !== void 0) {
        try {
          await this.#setModel(client, childSessionId, input.modelSelection);
          appliedModel = input.modelSelection;
          this.log({
            event: "model-set",
            teamId: input.teamId,
            childSessionId,
            providerId: input.modelSelection.providerId,
            modelId: input.modelSelection.modelId,
            reasoningLevel: input.modelSelection.reasoningLevel ?? null
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log({
            event: "model-set-failed",
            teamId: input.teamId,
            childSessionId,
            providerId: input.modelSelection.providerId,
            modelId: input.modelSelection.modelId,
            message
          });
          throw new BreedError(
            "model-rejected",
            `member could not use the inherited model ${input.modelSelection.providerId}/${input.modelSelection.modelId}: ${message}`
          );
        }
      }
      if (anchorSessionId === null || childSessionId === null) {
        throw new BreedError("unsupported", "session breeding produced no anchor/child id");
      }
      const elapsedMs = this.now() - startedAt;
      this.log({
        event: "session-bred",
        teamId: input.teamId,
        anchorSessionId,
        childSessionId,
        tombstone,
        elapsedMs
      });
      return {
        anchorSessionId,
        childSessionId,
        elapsedMs,
        workspacePath,
        ...appliedModel !== void 0 ? { appliedModel } : {}
      };
    } catch (err) {
      const stderr = client.getStderr().slice(-800);
      if (err instanceof BreedError) {
        this.log({
          event: "session-breed-failed",
          teamId: input.teamId,
          code: err.code,
          message: err.message,
          stderr,
          anchorSessionId,
          childSessionId
        });
        if (anchorSessionId !== null) {
          this.disposeBredSessions({ anchorSessionId, workspacePath });
        }
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      const code = /timeout/i.test(message) ? "startup-timeout" : /exited|ENOENT|EACCES|spawn/i.test(message) ? "spawn-failed" : "unsupported";
      this.log({
        event: "session-breed-failed",
        teamId: input.teamId,
        code,
        message,
        stderr,
        anchorSessionId,
        childSessionId
      });
      if (anchorSessionId !== null) {
        this.disposeBredSessions({ anchorSessionId, workspacePath });
      }
      throw new BreedError(code, `${message}${stderr.length > 0 ? ` | stderr: ${stderr}` : ""}`);
    } finally {
      await client.close();
    }
  }
  /** 每轮执行前同步（0.4.0）：同 createChild 会话活跃前提下 setModel；失败返回原因（调用方阻止本轮）。 */
  async applyModelSelection(input) {
    const readyTimeoutMs = input.timeoutMs ?? this.readyTimeoutMs;
    let client;
    try {
      client = this.#spawnClient(input.workspacePath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log({ event: "model-apply-failed", sessionId: input.sessionId, reason });
      return { applied: false, reason };
    }
    try {
      const ready = await client.waitReady(readyTimeoutMs);
      if (!ready) {
        const reason = `app-server did not become ready within ${readyTimeoutMs}ms`;
        this.log({ event: "model-apply-failed", sessionId: input.sessionId, reason });
        return { applied: false, reason };
      }
      await client.rpc("session/resume", { sessionId: input.sessionId }, 2e4);
      await this.#setModel(client, input.sessionId, input.selection);
      this.log({
        event: "model-applied",
        sessionId: input.sessionId,
        providerId: input.selection.providerId,
        modelId: input.selection.modelId,
        reasoningLevel: input.selection.reasoningLevel ?? null
      });
      return { applied: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log({ event: "model-apply-failed", sessionId: input.sessionId, reason });
      return { applied: false, reason };
    } finally {
      await client.close();
    }
  }
  /**
   * 应用一次模型选择（createChild 首轮 / launchTurn 每轮同步共用）。
   * result 是巨型消息快照（PoC 事实 1）：只记目标三元组与错误文本，绝不整包落日志。
   */
  /** setModel 请求体（createChild / applyModelSelection 共用；persistAsWorkspaceLastUsed 恒 false）。 */
  async #setModel(client, sessionId, selection) {
    await client.rpc(
      "session/setModel",
      {
        sessionId,
        model: {
          providerId: selection.providerId,
          modelId: selection.modelId,
          ...selection.reasoningLevel !== void 0 ? { options: { reasoningLevel: selection.reasoningLevel } } : {}
        },
        persistAsWorkspaceLastUsed: false
      },
      2e4
    );
  }
  #spawnClient(workspacePath) {
    try {
      return AppServerClient.spawn({
        executable: this.zcode.command,
        argvPrefix: this.zcode.argvPrefix,
        cwd: workspacePath,
        log: this.log
      });
    } catch (err) {
      throw new BreedError(
        "spawn-failed",
        `app-server spawn failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
};
function describeAck(type, ack) {
  const status = ack?.reasonCode ?? ack?.status ?? "no session id";
  return `${type} rejected: ${status}${ack?.message !== void 0 ? ` (${ack.message})` : ""}`;
}
function isolationModeFromEnv(env = process.env) {
  return env.TEAM_SESSION_ISOLATION === "legacy" ? "legacy" : "child";
}

// src/provider/model-catalog.ts
import fs17 from "node:fs";
import os7 from "node:os";
import path16 from "node:path";
function defaultModelConfigPath(homedir = os7.homedir()) {
  return path16.join(homedir, ".zcode", "v2", "config.json");
}
function defaultProviderConfigPath(homedir = os7.homedir()) {
  return path16.join(homedir, ".zcode", "v2", "provider_config.json");
}
function readModelCatalogDetailed(homedir = os7.homedir()) {
  const registry2 = readRegistryCatalog(homedir);
  if ("catalog" in registry2) {
    return { catalog: registry2.catalog, source: "provider-config" };
  }
  const registryError = "error" in registry2 ? registry2.error : void 0;
  const legacy = readLegacyCatalog(homedir);
  return {
    ...legacy,
    source: "config-json",
    ...legacy.error !== void 0 ? { error: registryError !== void 0 ? `${registryError}; ${legacy.error}` : legacy.error } : registryError !== void 0 ? { warning: registryError } : {}
  };
}
function readModelCatalog(homedir = os7.homedir()) {
  return readModelCatalogDetailed(homedir).catalog;
}
function findCatalogProvider(catalog, providerId) {
  return catalog.providers.find((p) => p.providerId === providerId);
}
function findCatalogModel(catalog, providerId, modelId) {
  return findCatalogProvider(catalog, providerId)?.models.find((m) => m.id === modelId);
}
function catalogSupports(catalog, selection) {
  const provider = findCatalogProvider(catalog, selection.providerId);
  if (provider === void 0 || !provider.enabled) return false;
  const model = provider.models.find((m) => m.id === selection.modelId);
  return model !== void 0 && model.enabled !== false;
}
function defaultReasoningLevel(catalog, providerId, modelId) {
  const model = findCatalogModel(catalog, providerId, modelId);
  const variants = model?.reasoning?.variants;
  const preferred = model?.reasoning?.defaultVariant;
  if (preferred !== void 0 && (variants === void 0 || variants.includes(preferred))) return preferred;
  if (variants === void 0) return DEFAULT_REASONING_LEVEL;
  return variants.includes(DEFAULT_REASONING_LEVEL) ? DEFAULT_REASONING_LEVEL : variants[0] ?? DEFAULT_REASONING_LEVEL;
}
function applyReasoningDefault(catalog, selection) {
  if (selection.reasoningLevel !== void 0) return selection;
  return {
    ...selection,
    reasoningLevel: defaultReasoningLevel(catalog, selection.providerId, selection.modelId)
  };
}
function readRegistryCatalog(homedir) {
  const file = defaultProviderConfigPath(homedir);
  let doc;
  try {
    doc = JSON.parse(fs17.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return { missing: true };
    return { error: `provider registry unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
  const config3 = doc?.config;
  if (config3 === null || typeof config3 !== "object" || Array.isArray(config3)) {
    return { error: "provider registry unavailable: config is not an object" };
  }
  const cfg = config3;
  const order = cfg.providerOrder;
  const rules = cfg.providerConfigRules?.providerRules;
  if (!Array.isArray(order) || !Array.isArray(rules)) {
    return { error: "provider registry unavailable: providerOrder/providerRules is not an array" };
  }
  const ruleById = /* @__PURE__ */ new Map();
  for (const raw of rules) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rule = raw;
    const providerId = nonEmpty(rule.providerId);
    if (providerId !== void 0) ruleById.set(providerId, rule);
  }
  const modelRules = registryModelRules(cfg);
  const legacyReasoning = readLegacyReasoning(homedir);
  const providers = [];
  const seen = /* @__PURE__ */ new Set();
  for (const rawId of order) {
    const providerId = nonEmpty(rawId);
    if (providerId === void 0 || seen.has(providerId)) continue;
    seen.add(providerId);
    const rule = ruleById.get(providerId);
    const ruleConfig = recordOf(rule?.config);
    const models = [];
    const modelSeen = /* @__PURE__ */ new Set();
    for (const rawModel of arrayOf(ruleConfig?.modelOrder)) {
      const id = nonEmpty(rawModel);
      if (id === void 0 || modelSeen.has(id)) continue;
      modelSeen.add(id);
      const ruleConfigForModel = modelRules.get(modelKey(providerId, id));
      const enabled = ruleConfigForModel?.enabled !== false;
      const reasoning = legacyReasoning.get(modelKey(providerId, id)) ?? registryReasoning(ruleConfigForModel);
      models.push({
        id,
        enabled,
        ...reasoning !== void 0 ? { reasoning } : {}
      });
    }
    providers.push({
      providerId,
      name: nonEmpty(rule?.providerName) ?? providerId,
      // api.type 是协议族（anthropic/openai-responses…）——只取该字符串，绝不带 baseUrl。
      kind: nonEmpty(recordOf(ruleConfig?.api)?.type) ?? "unknown",
      enabled: true,
      models
    });
  }
  return { catalog: { providers } };
}
function registryModelRules(cfg) {
  const rules = cfg.modelConfigRules?.providerModelRules;
  const out = /* @__PURE__ */ new Map();
  for (const raw of arrayOf(rules)) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rule = raw;
    const providerId = nonEmpty(rule.providerId);
    const modelId = nonEmpty(rule.modelId);
    if (providerId === void 0 || modelId === void 0) continue;
    out.set(modelKey(providerId, modelId), recordOf(rule.config) ?? {});
  }
  return out;
}
function registryReasoning(rule) {
  const specs = recordOf(rule?.optionSpecs);
  const level = recordOf(specs?.reasoningLevel);
  return catalogReasoning({ variants: level?.values });
}
function readLegacyCatalog(homedir) {
  const file = defaultModelConfigPath(homedir);
  const doc = readJsonOrUndefined(file);
  if ("error" in doc) {
    return { catalog: { providers: [] }, error: `model catalog unavailable: ${doc.error}` };
  }
  const rawProviders = doc.value?.provider;
  if (rawProviders === null || typeof rawProviders !== "object" || Array.isArray(rawProviders)) {
    return { catalog: { providers: [] }, error: "model catalog unavailable: config.provider is not an object" };
  }
  const providers = [];
  for (const [providerId, raw] of Object.entries(rawProviders)) {
    if (providerId.length === 0 || raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record2 = raw;
    const enabled = record2.enabled !== false;
    const disabledReason = enabled ? void 0 : nonEmpty(record2.systemDisabledReason) ?? "disabled";
    providers.push({
      providerId,
      name: nonEmpty(record2.name) ?? providerId,
      kind: nonEmpty(record2.kind) ?? "unknown",
      enabled,
      ...disabledReason !== void 0 ? { disabledReason } : {},
      models: legacyModels(record2.models)
    });
  }
  return { catalog: { providers } };
}
function legacyModels(raw) {
  const models = [];
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [id, value] of Object.entries(raw)) {
      const model = legacyModel(id, value);
      if (model !== void 0) models.push(model);
    }
    return models;
  }
  if (Array.isArray(raw)) {
    for (const value of raw) {
      const id = nonEmpty(value?.id);
      const model = legacyModel(id ?? "", value);
      if (model !== void 0) models.push(model);
    }
  }
  return models;
}
function legacyModel(id, raw) {
  if (id.length === 0) return void 0;
  const record2 = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const reasoning = catalogReasoning(record2.reasoning);
  return { id, enabled: true, ...reasoning !== void 0 ? { reasoning } : {} };
}
function readLegacyReasoning(homedir) {
  const out = /* @__PURE__ */ new Map();
  const doc = readJsonOrUndefined(defaultModelConfigPath(homedir));
  if ("error" in doc) return out;
  const rawProviders = doc.value?.provider;
  if (rawProviders === null || typeof rawProviders !== "object" || Array.isArray(rawProviders)) return out;
  for (const [providerId, raw] of Object.entries(rawProviders)) {
    const record2 = recordOf(raw);
    const models = recordOf(record2?.models);
    if (models === void 0) continue;
    for (const [modelId, modelRaw] of Object.entries(models)) {
      const reasoning = catalogReasoning(recordOf(modelRaw)?.reasoning);
      if (reasoning !== void 0) out.set(modelKey(providerId, modelId), reasoning);
    }
  }
  return out;
}
function catalogReasoning(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return void 0;
  const record2 = raw;
  if (record2.enabled === false) return void 0;
  if (!Array.isArray(record2.variants)) return void 0;
  const variants = [...new Set(record2.variants.map(nonEmpty).filter((v) => v !== void 0))];
  if (variants.length === 0) return void 0;
  const defaultVariant = nonEmpty(record2.defaultVariant);
  return {
    variants,
    ...defaultVariant !== void 0 && variants.includes(defaultVariant) ? { defaultVariant } : {}
  };
}
function modelKey(providerId, modelId) {
  return `${providerId}\0${modelId}`;
}
function recordOf(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}
function readJsonOrUndefined(file) {
  try {
    return { value: JSON.parse(fs17.readFileSync(file, "utf8")) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
function nonEmpty(value) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}

// src/provider/resume-provider.ts
var LEAD_DELIVERY_VIA_HOOKS = true;
var DEFAULT_MODEL_RETRY_BACKOFF_MS = [5e3, 15e3, 3e4];
var ResumePerTurnProvider = class {
  constructor(opts) {
    this.opts = opts;
    this.teamDir = path17.join(opts.dataRoot, "teams", safeDir(opts.teamId));
    this.cwd = opts.cwd ?? process.env.TEAM_PROJECT_DIR ?? process.cwd();
    this.reader = new TranscriptReader({ ...opts.dbPath !== void 0 ? { dbPath: opts.dbPath } : {} });
    this.zcode = opts.zcode ?? resolveZcodeBin();
    this.drainPolicy = opts.drainPolicy ?? drainPolicyFromEnv();
    this.termGraceMs = opts.termGraceMs ?? 3e3;
    this.firstTurnTimeoutMs = opts.firstTurnTimeoutMs ?? 12e4;
    this.deliverConfirmMs = opts.deliverConfirmMs ?? 15e3;
    this.watcherIntervalMs = opts.watcherIntervalMs ?? 500;
    this.relaunchBackoffMs = opts.relaunchBackoffMs ?? 2e3;
    this.sessionIsolation = opts.sessionIsolation ?? isolationModeFromEnv();
    this.leadWakeMinIdleMs = opts.leadWakeMinIdleMs ?? Number(process.env.TEAM_WAKE_LEAD_MIN_IDLE_MS ?? 3e4);
    this.modelRetryBackoffMs = opts.modelRetryBackoffMs !== void 0 && opts.modelRetryBackoffMs.length > 0 ? opts.modelRetryBackoffMs : DEFAULT_MODEL_RETRY_BACKOFF_MS;
    this.breeder = opts.breeder ?? new AppServerSessionBreeder({
      zcode: this.zcode,
      ...opts.dbPath !== void 0 ? { dbPath: opts.dbPath } : {},
      log: (record2) => this.log(record2),
      now: opts.now ?? Date.now
    });
    this.now = opts.now ?? Date.now;
    this.modelCatalog = opts.modelCatalog ?? (() => readModelCatalog());
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = opts.log ?? (() => {
    });
  }
  LEAD_DELIVERY_VIA_HOOKS = LEAD_DELIVERY_VIA_HOOKS;
  teamDir;
  cwd;
  reader;
  zcode;
  drainPolicy;
  termGraceMs;
  firstTurnTimeoutMs;
  deliverConfirmMs;
  watcherIntervalMs;
  relaunchBackoffMs;
  sessionIsolation;
  leadWakeMinIdleMs;
  modelRetryBackoffMs;
  breeder;
  modelCatalog;
  now;
  sleep;
  log;
  boundaryListeners = /* @__PURE__ */ new Set();
  watcherTimer = null;
  adoptedPids = /* @__PURE__ */ new Set();
  watcherBusy = false;
  leadReceiptsMtimeMs = null;
  lastLaunchFailureAt = 0;
  pendingLookup = null;
  closed = false;
  /** 失败记录变化监听（0.4.1：host 接线 → roster.notifyStatusChanged 刷新成员展示）。 */
  modelFailureListeners = /* @__PURE__ */ new Set();
  // ---------------------------------------------------------------- 边界与接线
  /** 协调者接线（host.serve）：轮次边界监听 + pending 合并查询（mailbox 派生）
   *  + 模型失败记录变化通知（0.4.1：后台续跑失败 → 成员展示立即刷新）。 */
  bind(hooks) {
    this.boundaryListeners.add(hooks.onBoundary);
    this.pendingLookup = hooks.pendingLookup;
    if (hooks.onModelFailureChanged !== void 0) {
      this.modelFailureListeners.add(hooks.onModelFailureChanged);
    }
  }
  notifyModelFailureChanged() {
    for (const listener of this.modelFailureListeners) {
      try {
        listener();
      } catch (err) {
        this.log({ ts: iso(this.now()), kind: "model-failure-listener-error", error: errText2(err) });
      }
    }
  }
  /**
   * spawn 前置校验（0.4.1）：Lead 模型不可继承 → 抛错。roster 在**登记成员之前**调用，
   * 可提前识别的配置错误不产生 provisioning 成员、不占成员名、不建隐藏子会话。
   * 供给阶段仍复检（resolveLeadInheritance 在 startContinuable 内照跑）——预检后配置可能变化。
   * legacy 隔离模式无继承语义 → 恒通过。
   */
  preflightMemberModel() {
    if (this.sessionIsolation !== "child") return;
    this.resolveLeadInheritance();
  }
  /** 协调者启动纳管：孤儿轮次定案/再收养 + drain 标记处置 + lead 回执折叠（T4.4/触发点②）。 */
  adoptOrphans() {
    const finalized = [];
    const adopted = [];
    for (const memberId of listMembers(this.teamDir)) {
      const paths = memberPaths(this.teamDir, memberId);
      this.handleDrainMarker(paths);
      for (const turn of listTurns(paths.runDir)) {
        if (turn.status !== "running" && turn.status !== "starting") continue;
        if (this.finalizeIfDead(memberId, turn)) {
          finalized.push(turn.turnId);
        } else if (turn.pid !== null) {
          this.adoptedPids.add(turn.pid);
          adopted.push(turn.turnId);
        }
      }
    }
    this.foldLeadReceipts(true);
    this.startWatcher();
    return { finalized, adopted };
  }
  /** 协调者关闭：停 watcher（轮次进程不杀——独立进程组纪律）。 */
  detach() {
    this.closed = true;
    if (this.watcherTimer !== null) {
      clearInterval(this.watcherTimer);
      this.watcherTimer = null;
    }
    this.adoptedPids.clear();
  }
  emitBoundary(event) {
    for (const listener of this.boundaryListeners) {
      try {
        listener(event);
      } catch (err) {
        this.log({ ts: iso(this.now()), kind: "boundary-listener-error", memberId: event.memberId, error: errText2(err) });
      }
    }
  }
  startWatcher() {
    if (this.watcherTimer !== null || this.closed) return;
    const timer = setInterval(() => {
      void this.watchTick().catch((err) => {
        this.log({ ts: iso(this.now()), kind: "watcher-error", error: errText2(err) });
      });
    }, this.watcherIntervalMs);
    timer.unref?.();
    this.watcherTimer = timer;
  }
  async watchTick() {
    if (this.watcherBusy || this.closed) return;
    this.watcherBusy = true;
    try {
      for (const memberId of listMembers(this.teamDir)) {
        const paths = memberPaths(this.teamDir, memberId);
        const turnId = readCurrentTurnId(paths);
        if (turnId === void 0) continue;
        const turn = readTurn(paths.runDir, turnId);
        if (turn === void 0) continue;
        if (turn.status === "running" || turn.status === "starting") {
          if (turn.interruptRequestedAt !== void 0) {
            const dead = await killProcessGroup(turn.pgid, this.termGraceMs);
            if (dead) {
              const landed = turn.sessionId !== null && this.reader.hasUserText(turn.sessionId, turn.promptText);
              writeTurn(paths.runDir, {
                ...turn,
                status: "interrupted",
                exitedAt: iso(this.now()),
                landed
              });
              this.emitBoundary({
                memberId,
                turnId: turn.turnId,
                landedMessageIds: landed ? turn.messageIds : [],
                carriedMessageIds: turn.messageIds
              });
            }
            continue;
          }
          this.finalizeIfDead(memberId, turn);
        }
      }
      this.foldLeadReceipts(false);
    } finally {
      this.watcherBusy = false;
    }
  }
  /** 轮次进程已死 → 定案（landed 实查）+ 边界事件；返回是否已定案。 */
  finalizeIfDead(memberId, turn) {
    if (turn.pid !== null && pidAlive(turn.pid)) {
      this.adoptedPids.add(turn.pid);
      return false;
    }
    const landed = turn.sessionId !== null && this.reader.hasUserText(turn.sessionId, turn.promptText);
    const next = {
      ...turn,
      status: "exited",
      exitedAt: iso(this.now()),
      landed
    };
    const paths = memberPaths(this.teamDir, memberId);
    writeTurn(paths.runDir, next);
    this.adoptedPids.delete(turn.pid ?? -1);
    this.log({
      ts: iso(this.now()),
      kind: "turn-exit",
      teamId: this.opts.teamId,
      memberId,
      turnId: turn.turnId,
      landed,
      messageIds: turn.messageIds
    });
    if (!landed && turn.messageIds.length > 0) {
      this.lastLaunchFailureAt = this.now();
    }
    this.emitBoundary({
      memberId,
      turnId: turn.turnId,
      landedMessageIds: landed ? turn.messageIds : [],
      carriedMessageIds: turn.messageIds
    });
    return true;
  }
  /** lead 回执折叠：回执文件变化 → 边界事件（runtime → mailbox.observeDelivery → markDelivered）。 */
  foldLeadReceipts(force) {
    const paths = memberPaths(this.teamDir, this.opts.teamId);
    let mtimeMs = null;
    try {
      mtimeMs = fs18.statSync(paths.receiptsFile).mtimeMs;
    } catch {
      mtimeMs = null;
    }
    if (!force && mtimeMs === this.leadReceiptsMtimeMs) return;
    this.leadReceiptsMtimeMs = mtimeMs;
    if (mtimeMs === null) return;
    const ids = [...receiptMessageIds(paths)];
    if (ids.length === 0) return;
    this.emitBoundary({ memberId: this.opts.teamId, landedMessageIds: ids, carriedMessageIds: ids });
  }
  // ---------------------------------------------------------------- TeammateProvider
  async startContinuable(args) {
    if (args.teamId !== this.opts.teamId) {
      throw new Error(`provider serves team ${this.opts.teamId} but spawn targets ${args.teamId}`);
    }
    const paths = memberPaths(this.teamDir, args.memberId);
    const prompt = args.context === "fork" ? buildForkFirstPrompt(this.reader, this.opts.teamId, args.firstPrompt).prompt : args.firstPrompt;
    const inheritedSelection = this.sessionIsolation === "child" ? this.resolveLeadInheritance() : void 0;
    let bred = null;
    if (this.sessionIsolation === "child") {
      try {
        bred = await this.breeder.createChild({
          teamId: this.opts.teamId,
          workspacePath: this.cwd,
          ...inheritedSelection !== void 0 ? { modelSelection: inheritedSelection } : {}
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (inheritedSelection !== void 0 && /inherited model/.test(message)) {
          this.recordModelFailure(
            paths,
            args.memberId,
            new ModelInheritanceError(`\u6210\u5458\u6A21\u578B\u65E0\u6CD5\u7EE7\u627F\uFF1A${message}`, inheritedSelection),
            [],
            classifyApplyFailure(message)
          );
        }
        throw err;
      }
    }
    const spawnCwd = bred?.workspacePath ?? this.cwd;
    const origin = {
      teamId: this.opts.teamId,
      memberId: args.memberId,
      name: args.name,
      provider: args.context === "fork" ? "fork" : "spawn",
      mode: "continuable",
      context: args.context,
      createdAt: iso(this.now()),
      cwd: spawnCwd,
      firstPromptText: prompt,
      firstPromptSha256: sha256(prompt),
      sessionId: bred?.childSessionId ?? null,
      initialUserMessageAccepted: false,
      // 只记实际生效者（createChild 失败即抛，走到这里 appliedModel 与继承选择一致或 legacy 无）。
      ...bred?.appliedModel !== void 0 ? { modelSelection: bred.appliedModel, modelSource: "inherited" } : {},
      sessionIsolation: bred !== null ? "child" : "legacy",
      ...bred !== null ? {
        anchorSessionId: bred.anchorSessionId,
        logicalParentSessionId: this.opts.teamId,
        sessionKind: "selection_side_chat"
      } : { sessionKind: "interactive" }
    };
    writeOrigin(paths, origin);
    const spawnT0 = this.now();
    const turn = await this.launchTurn({
      paths,
      memberId: args.memberId,
      name: args.name,
      kind: "first",
      messageIds: [],
      promptText: prompt,
      sessionId: bred?.childSessionId ?? null,
      resume: bred !== null,
      cwd: spawnCwd,
      // createChild 刚把继承选择应用进子会话（0.4.1 验收：首轮不重复应用同一选择）。
      modelJustApplied: bred?.appliedModel
    });
    this.startWatcher();
    try {
      const sessionId = await this.awaitFirstAccept({
        paths,
        origin,
        turn,
        spawnT0,
        signal: args.signal
      });
      return { memberId: args.memberId, accepted: sessionId !== null };
    } catch (err) {
      if (args.signal?.aborted) throw err;
      this.log({ ts: iso(this.now()), kind: "first-probe-error", memberId: args.memberId, error: errText2(err) });
      return { memberId: args.memberId, accepted: false };
    }
  }
  /** 首轮持久接收探针：session id 认领（hook 领地优先，db 目录+首条用户文本兜底）+ 落库确认。 */
  async awaitFirstAccept(args) {
    const { paths, origin, turn, spawnT0 } = args;
    const deadline = spawnT0 + this.firstTurnTimeoutMs;
    let sessionId = origin.sessionId;
    for (; ; ) {
      if (args.signal?.aborted) throw args.signal.reason ?? new Error("aborted");
      sessionId ??= this.claimedSessionId(origin.memberId);
      if (sessionId === null) {
        const exclude = this.claimedSessionsExcluding(origin.memberId);
        const found = this.reader.findSessionByFirstPrompt({
          cwd: origin.cwd,
          firstPrompt: origin.firstPromptText,
          sinceMs: spawnT0,
          ...exclude.size > 0 ? { excludeSessionIds: exclude } : {}
        });
        if (found !== void 0) sessionId = found;
      }
      if (sessionId !== null) {
        const landed = this.reader.hasUserText(sessionId, origin.firstPromptText);
        if (landed) {
          const nextOrigin = {
            ...readOrigin(paths) ?? origin,
            sessionId,
            initialUserMessageAccepted: true
          };
          writeOrigin(paths, nextOrigin);
          const current = readTurn(paths.runDir, turn.turnId) ?? turn;
          writeTurn(paths.runDir, { ...current, sessionId, landed: true });
          this.writeTeammateMapping(sessionId, nextOrigin);
          this.log({
            ts: iso(this.now()),
            kind: "first-accepted",
            teamId: this.opts.teamId,
            memberId: origin.memberId,
            turnId: turn.turnId,
            sessionId,
            ms: this.now() - spawnT0
          });
          return sessionId;
        }
      }
      const turnNow = readTurn(paths.runDir, turn.turnId);
      const pid = turnNow?.pid ?? turn.pid;
      if (pid === null || !pidAlive(pid)) {
        this.log({
          ts: iso(this.now()),
          kind: "first-not-accepted",
          teamId: this.opts.teamId,
          memberId: origin.memberId,
          turnId: turn.turnId,
          sessionId
        });
        return null;
      }
      if (this.now() >= deadline) {
        await killProcessGroup(turnNow?.pgid ?? turn.pgid, this.termGraceMs).catch(() => void 0);
        this.log({
          ts: iso(this.now()),
          kind: "first-probe-timeout",
          teamId: this.opts.teamId,
          memberId: origin.memberId,
          turnId: turn.turnId
        });
        return null;
      }
      await this.sleep(150);
    }
  }
  async deliver(args) {
    const debug = process.env.TEAM_DEBUG_DELIVERY === "1";
    const paths = memberPaths(this.teamDir, args.memberId);
    const origin = readOrigin(paths);
    if (origin === void 0) {
      if (debug) this.log({ ts: iso(this.now()), kind: "deliver-deferred", memberId: args.memberId, reason: "no-origin" });
      return "queued";
    }
    if (this.containsMessage(args.memberId, args.messageId)) return "accepted";
    const current = this.currentRunningTurn(paths);
    if (current !== null) {
      if (debug) this.log({ ts: iso(this.now()), kind: "deliver-deferred", memberId: args.memberId, reason: "running", turnId: current.turnId });
      return "queued";
    }
    const sessionId = origin.sessionId ?? this.resolveSessionId(origin);
    if (sessionId === null) {
      if (debug) this.log({ ts: iso(this.now()), kind: "deliver-deferred", memberId: args.memberId, reason: "session-unsettled" });
      return "queued";
    }
    if (this.now() - this.lastLaunchFailureAt < this.relaunchBackoffMs && this.lastLaunchFailureAt > 0) {
      if (debug) this.log({ ts: iso(this.now()), kind: "deliver-deferred", memberId: args.memberId, reason: "launch-backoff" });
      return "queued";
    }
    const batchRaw = this.pendingLookup !== null ? this.pendingLookup(args.memberId) : [{ messageId: args.messageId, framedJson: args.framedMessage }];
    const batch = batchRaw.filter((item) => !this.containsMessage(args.memberId, item.messageId));
    if (batch.length === 0) return "accepted";
    const { promptText } = renderFramedBatch(batch);
    const turn = await this.launchTurn({
      paths,
      memberId: args.memberId,
      name: origin.name,
      kind: "deliver",
      messageIds: batch.map((item) => item.messageId),
      promptText,
      sessionId,
      resume: true,
      cwd: origin.cwd
    }).catch((err) => {
      if (err instanceof ModelSyncSuppressedError) {
        if (debug) {
          this.log({ ts: iso(this.now()), kind: "deliver-deferred", memberId: args.memberId, reason: "model-sync-suppressed" });
        }
        return null;
      }
      throw err;
    });
    if (turn === null) return "queued";
    this.startWatcher();
    const deadline = this.now() + this.deliverConfirmMs;
    for (; ; ) {
      if (this.reader.hasUserText(sessionId, promptText)) {
        const current2 = readTurn(paths.runDir, turn.turnId) ?? turn;
        writeTurn(paths.runDir, { ...current2, landed: true });
        this.log({
          ts: iso(this.now()),
          kind: "deliver-landed",
          teamId: this.opts.teamId,
          memberId: args.memberId,
          turnId: turn.turnId,
          messageIds: current2.messageIds
        });
        return "accepted";
      }
      const turnNow = readTurn(paths.runDir, turn.turnId);
      const pid = turnNow?.pid ?? turn.pid;
      if (pid === null || !pidAlive(pid)) {
        this.lastLaunchFailureAt = this.now();
        return "queued";
      }
      if (this.now() >= deadline) {
        return "queued";
      }
      await this.sleep(150);
    }
  }
  async interrupt(args) {
    const paths = memberPaths(this.teamDir, args.memberId);
    const current = this.currentRunningTurn(paths);
    const previousStatus = current !== null ? "running" : "inactive";
    if (current === null) return { previousStatus };
    writeTurn(paths.runDir, { ...current, interruptRequestedAt: iso(this.now()) });
    let dead;
    try {
      dead = await killProcessGroup(current.pgid, this.termGraceMs);
    } catch (err) {
      writeTurn(paths.runDir, { ...current });
      throw err;
    }
    if (!dead) {
      writeTurn(paths.runDir, { ...current });
      throw new Error(`interrupt failed: process group ${String(current.pgid)} is still alive`);
    }
    const finalTurn = readTurn(paths.runDir, current.turnId) ?? current;
    const landed = finalTurn.sessionId !== null && this.reader.hasUserText(finalTurn.sessionId, finalTurn.promptText);
    writeTurn(paths.runDir, { ...finalTurn, status: "interrupted", exitedAt: iso(this.now()), landed });
    this.log({
      ts: iso(this.now()),
      kind: "interrupt",
      teamId: this.opts.teamId,
      memberId: args.memberId,
      turnId: current.turnId,
      previousStatus,
      dead,
      landed
    });
    this.emitBoundary({
      memberId: args.memberId,
      turnId: current.turnId,
      landedMessageIds: landed ? current.messageIds : [],
      carriedMessageIds: current.messageIds
    });
    return { previousStatus };
  }
  async drain(args) {
    const memberIds = listMembers(this.teamDir);
    if (this.drainPolicy === "keep") {
      for (const memberId of memberIds) {
        const paths = memberPaths(this.teamDir, memberId);
        const current = readCurrentTurnId(paths);
        if (current === void 0) continue;
        writeJsonAtomic(paths.drainMarkerFile, { policy: "keep", requestedAt: iso(this.now()), turnId: current });
      }
      this.log({ ts: iso(this.now()), kind: "drain-keep", teamId: this.opts.teamId, members: memberIds.length });
      return;
    }
    const grace = Math.max(200, Math.min(this.termGraceMs, Math.floor(args.timeoutMs * 0.6)));
    const failures = [];
    for (const memberId of memberIds) {
      const paths = memberPaths(this.teamDir, memberId);
      const turnId = readCurrentTurnId(paths);
      if (turnId === void 0) continue;
      const turn = readTurn(paths.runDir, turnId);
      if (turn === void 0 || turn.status !== "running" && turn.status !== "starting") continue;
      const dead = await killProcessGroup(turn.pgid, grace);
      if (!dead) failures.push(`${memberId}/${turn.turnId}`);
      else {
        const landed = turn.sessionId !== null && this.reader.hasUserText(turn.sessionId, turn.promptText);
        writeTurn(paths.runDir, { ...turn, status: "exited", exitedAt: iso(this.now()), landed });
      }
    }
    this.log({ ts: iso(this.now()), kind: "drain-kill", teamId: this.opts.teamId, failures: failures.length });
    if (failures.length > 0) {
      throw new Error(`drain left ${failures.length} turn process(es) alive: ${failures.join(", ")}`);
    }
  }
  // ---------------------------------------------------------------- ReconciliationSource / TargetInspector / 呈现
  readProvisioningRecord(memberId) {
    const paths = memberPaths(this.teamDir, memberId);
    const origin = readOrigin(paths);
    if (origin === void 0) return void 0;
    let sessionId = origin.sessionId;
    if (sessionId === null) {
      sessionId = this.resolveSessionId(origin);
      if (sessionId !== null) {
        writeOrigin(paths, { ...origin, sessionId });
      }
    }
    if (sessionId === null) {
      return {
        rootSessionId: origin.teamId,
        descriptor: { provider: origin.provider, mode: origin.mode },
        initialUserMessageAccepted: false
      };
    }
    const session = this.reader.session(sessionId);
    if (session === void 0) {
      return {
        rootSessionId: origin.teamId,
        descriptor: { provider: origin.provider, mode: origin.mode },
        initialUserMessageAccepted: false
      };
    }
    const typeKnown = typeof session.task_type === "string" && session.task_type.length > 0;
    const structureOk = !typeKnown ? true : origin.sessionIsolation === "child" ? session.task_type === "selection_side_chat" && (origin.anchorSessionId === void 0 || session.parent_id === origin.anchorSessionId) : session.task_type === "interactive";
    const directoryOk = typeof session.directory !== "string" || session.directory.length === 0 ? true : session.directory === origin.cwd;
    const firstText = this.reader.firstRealUserText(sessionId);
    const accepted = structureOk && directoryOk && firstText !== void 0 && firstText === origin.firstPromptText;
    return {
      rootSessionId: origin.teamId,
      descriptor: { provider: origin.provider, mode: origin.mode },
      initialUserMessageAccepted: accepted
    };
  }
  isAlive(memberId) {
    const paths = memberPaths(this.teamDir, memberId);
    return this.currentRunningTurn(paths) !== null;
  }
  containsMessage(memberId, messageId) {
    if (memberId === this.opts.teamId) {
      return receiptMessageIds(memberPaths(this.teamDir, memberId)).has(messageId);
    }
    const paths = memberPaths(this.teamDir, memberId);
    for (const turn of listTurns(paths.runDir)) {
      if (!turn.messageIds.includes(messageId)) continue;
      if (turn.landed === true) return true;
      if (turn.sessionId !== null && this.reader.hasUserText(turn.sessionId, turn.promptText)) return true;
      return false;
    }
    return false;
  }
  readColdRecord(memberId, messageId) {
    const origin = readOrigin(memberPaths(this.teamDir, memberId));
    if (origin === void 0) return void 0;
    return { recorded: this.containsMessage(memberId, messageId) };
  }
  statusOf(memberId) {
    return this.isAlive(memberId) ? "running" : "inactive";
  }
  modelOf(memberId) {
    const origin = readOrigin(memberPaths(this.teamDir, memberId));
    if (origin === void 0) return void 0;
    const observed = origin.sessionId !== null ? this.reader.latestModel(origin.sessionId) : void 0;
    return observed ?? origin.modelSelection?.modelId ?? origin.model;
  }
  /** Lead 行模型（roster Lead 伪行）：Lead 会话最近消息实查 → model_usage 兜底。 */
  leadModelOf() {
    return this.reader.latestModel(this.opts.teamId) ?? this.reader.latestModelUsage(this.opts.teamId)?.modelId;
  }
  /** Lead 当前结构化选择（成员卡/roster 展示用；0.4.0 = 三源判定的可继承选择，可能 undefined）。 */
  leadModelSelectionOf() {
    return this.resolveLeadInheritance({ throwOnUnusable: false });
  }
  // 0.4.0 注销 setMemberModel：成员模型不存在独立配置通道（唯一路线 = 每轮跟随 Lead）。
  // ---------------------------------------------------------------- hook 回执（Lead 投递 landed 依据）
  /** hook 注入成功后落回执（hooks 进程与协调者双写者安全：O_APPEND+fsync）。 */
  recordLeadReceipts(messageIds, channel) {
    const paths = memberPaths(this.teamDir, this.opts.teamId);
    for (const messageId of messageIds) {
      appendReceipt(paths, { messageId, channel, ts: iso(this.now()) });
    }
    this.log({ ts: iso(this.now()), kind: "lead-receipt", teamId: this.opts.teamId, channel, messageIds: [...messageIds] });
  }
  /** Stop 预算（≤3 次/run；runKey 复位语义见 hooks）。 */
  consumeStopBudget(memberId, runKey) {
    const paths = memberPaths(this.teamDir, memberId);
    const current = readStopBudget(paths);
    const budget = current !== void 0 && current.runKey === runKey ? current : { runKey, blocks: 0 };
    if (budget.blocks >= 3) {
      writeStopBudget(paths, budget);
      return false;
    }
    writeStopBudget(paths, { runKey, blocks: budget.blocks + 1 });
    return true;
  }
  /**
   * 空闲 Lead 唤醒（灰度）：只在 TEAM_WAKE_LEAD=1、Lead 回合状态为 inactive 且空闲超阈值时
   * 拉起一个“处理收件箱”的 --resume 回合。返回 woke=false 时调用方必须保持 pending。
   */
  wakeLead() {
    if (!leadWakeEnabled()) return Promise.resolve({ woke: false, reason: "disabled" });
    return maybeWakeLead({
      teamDir: this.teamDir,
      leadSessionId: this.opts.teamId,
      cwd: this.cwd,
      zcode: this.zcode,
      minIdleMs: this.leadWakeMinIdleMs,
      now: this.now()
    });
  }
  close() {
    this.detach();
    this.reader.close();
  }
  // ---------------------------------------------------------------- 内部
  /** 孵化一轮（turn 记录先落盘 → spawn → 回填 pid/running）。 */
  async launchTurn(args) {
    const turnId = nextTurnId(args.paths.runDir);
    const stdoutFile = path17.join(args.paths.runDir, `${turnId}.out`);
    const turnCwd = args.cwd ?? this.cwd;
    await this.syncMemberModel(
      args.paths,
      args.memberId,
      args.sessionId,
      turnCwd,
      args.messageIds,
      args.modelJustApplied
    );
    const scriptArgs = [
      ...this.zcode.argvPrefix,
      "-p",
      args.promptText,
      "--json",
      "--mode",
      "yolo",
      "--surface",
      "terminal",
      "--disallowed-tools",
      "Task",
      // D6
      "--cwd",
      turnCwd,
      ...args.resume && args.sessionId !== null ? ["--resume", args.sessionId] : []
    ];
    const turn = {
      turnId,
      memberId: args.memberId,
      kind: args.kind,
      sessionId: args.sessionId,
      messageIds: args.messageIds,
      promptText: args.promptText,
      argv: scriptArgs,
      pid: null,
      pgid: null,
      status: "starting",
      startedAt: iso(this.now()),
      stdoutFile
    };
    writeTurn(args.paths.runDir, turn);
    setCurrentTurn(args.paths, turnId);
    const env = {
      ...process.env,
      TEAM_SPAWN_IDENTITY: JSON.stringify({
        teamId: this.opts.teamId,
        memberId: args.memberId,
        name: args.name
      })
    };
    if (this.opts.dbPath !== void 0) env.TEAM_DB_PATH = this.opts.dbPath;
    let spawned;
    try {
      spawned = await spawnDetached({
        command: this.zcode.command,
        argv: scriptArgs,
        // 真实 env 必须完整传给子进程（API key 等）；spec 只短暂存在（helper 读后立即删除，0600）。
        env,
        cwd: turnCwd,
        stdoutFile
      });
    } catch (err) {
      writeTurn(args.paths.runDir, { ...turn, status: "spawn-error", exitedAt: iso(this.now()), exitCode: null });
      this.lastLaunchFailureAt = this.now();
      this.log({ ts: iso(this.now()), kind: "spawn-error", teamId: this.opts.teamId, memberId: args.memberId, turnId, error: errText2(err) });
      throw err;
    }
    const running = { ...turn, pid: spawned.pid, pgid: spawned.pgid, status: "running" };
    writeTurn(args.paths.runDir, running);
    if (spawned.pid !== null) this.adoptedPids.add(spawned.pid);
    this.log({
      ts: iso(this.now()),
      kind: "turn-launch",
      teamId: this.opts.teamId,
      memberId: args.memberId,
      turnId,
      kindOfTurn: args.kind,
      pid: spawned.pid,
      messageIds: args.messageIds,
      resume: args.resume,
      // 只记 flag 名；prompt/session id/cwd 值不落 provider.jsonl（隐私/体积）。
      argv: [path17.basename(scriptArgs[0] ?? ""), ...scriptArgs.slice(1).map((a) => a.startsWith("--") ? a : "<redacted>")]
    });
    return running;
  }
  /** 当前「running 且进程存活」的轮次；无 → null。 */
  currentRunningTurn(paths) {
    const turnId = readCurrentTurnId(paths);
    if (turnId === void 0) return null;
    const turn = readTurn(paths.runDir, turnId);
    if (turn === void 0) return null;
    if (turn.status !== "running" && turn.status !== "starting") return null;
    if (turn.pid === null || !pidAlive(turn.pid)) return null;
    return turn;
  }
  /** 会话 id 认领：session-map（teammate SessionStart hook 经 TEAM_SPAWN_IDENTITY 落的映射）。 */
  claimedSessionId(memberId) {
    for (const entry of Object.values(readSessionRegistry(this.opts.dataRoot))) {
      if (entry.memberId === memberId && typeof entry.session_id === "string") return entry.session_id;
    }
    return null;
  }
  claimedSessionsExcluding(memberId) {
    const set = /* @__PURE__ */ new Set();
    for (const entry of Object.values(readSessionRegistry(this.opts.dataRoot))) {
      if (entry.memberId !== void 0 && entry.memberId !== memberId && typeof entry.session_id === "string") {
        set.add(entry.session_id);
      }
    }
    return set;
  }
  resolveSessionId(origin) {
    const claimed = this.claimedSessionId(origin.memberId);
    if (claimed !== null) return claimed;
    const createdAtMs = Date.parse(origin.createdAt);
    return this.reader.findSessionByFirstPrompt({
      cwd: origin.cwd,
      firstPrompt: origin.firstPromptText,
      sinceMs: Number.isNaN(createdAtMs) ? 0 : createdAtMs,
      excludeSessionIds: this.claimedSessionsExcluding(origin.memberId)
    }) ?? null;
  }
  /**
   * Lead 最新**已确认**模型选择（0.4.0 三源判定；成员跟随 Lead 的唯一解析入口）。
   *
   * 三源各带时间戳，取最新者（epoch ms）：
   *   1. real_user 提交快照 —— 宿主在保存用户消息时写入该次提交的 modelSelection，
   *      输入框切换在提交瞬间即体现在这里（issue #7 不影响本源：它不刷新 entry，但刷得动消息快照）；
   *   2. session_entry —— `/model` 命令等会话选模记录（time_updated 识别「提交后的修改」）；
   *   3. main_turn 实际调用 —— `query_source='main_turn'` 严格过滤，compact/标题/subagent/
   *      workflow 等辅助行绝不能当作 Lead 模型（本机实测取值域已核验）。
   *
   * 判出后按目录分类：官方套餐（`account:`/`builtin:` 前缀）或目录外（provider/model 不存在
   * 或被禁用）= 不可继承。`throwOnUnusable`（缺省 true）：
   *   - true：spawn/每轮同步入口 —— 不可继承或三源全空 → 抛 ModelInheritanceError（明确报告，
   *     绝不静默回退宿主缺省冒充继承成功）；
   *   - false：展示口径（Lead 伪行模型）—— 返回 undefined 交回退链处理。
   * 空目录守卫：目录不可读 = 无法分类 → 不过滤（照旧尝试，宿主 setModel 终审）。
   */
  resolveLeadInheritance(options) {
    const throwOnUnusable = options?.throwOnUnusable !== false;
    const sources = [
      this.reader.latestSubmissionSelection(this.opts.teamId),
      this.reader.latestModelSelectionTimed(this.opts.teamId),
      this.reader.latestMainTurnUsage(this.opts.teamId)
    ].filter((source) => source !== void 0);
    let latest;
    if (sources.length > 0) {
      const winner = sources.reduce((a, b) => b.at > a.at ? b : a);
      latest = winner.selection;
    }
    if (latest === void 0) {
      if (!throwOnUnusable) return void 0;
      throw new ModelInheritanceError(
        "\u65E0\u6CD5\u786E\u5B9A Lead \u5F53\u524D\u6A21\u578B\uFF08\u4F1A\u8BDD\u5E93\u4E2D\u6CA1\u6709\u63D0\u4EA4\u5FEB\u7167\u3001\u9009\u6A21\u8BB0\u5F55\u6216\u4E3B\u8F6E\u8C03\u7528\uFF09\uFF0C\u6210\u5458\u65E0\u6CD5\u7EE7\u627F\u3002"
      );
    }
    const model = `${latest.providerId}/${latest.modelId}`;
    const isOfficialPlan = latest.providerId.startsWith("account:") || latest.providerId.startsWith("builtin:");
    if (isOfficialPlan) {
      if (!throwOnUnusable) return void 0;
      throw new ModelInheritanceError(
        `Lead \u5F53\u524D\u4F7F\u7528\u5B98\u65B9\u5957\u9910\u6A21\u578B\uFF08${model}\uFF09\uFF0C\u6210\u5458\u65E0\u6CD5\u7EE7\u627F\uFF08CLI \u8FDB\u7A0B\u62FF\u4E0D\u5230\u8BA2\u9605\u5957\u9910\u51ED\u636E\uFF09\u3002\u8BF7\u5728 ZCode \u4E2D\u5207\u6362\u5230\u81EA\u914D\u7684\u7B2C\u4E09\u65B9\u6A21\u578B\u540E\u91CD\u8BD5\u3002`,
        latest
      );
    }
    const catalog = this.modelCatalog();
    if (catalog.providers.length > 0 && !catalogSupports(catalog, latest)) {
      if (!throwOnUnusable) return void 0;
      throw new ModelInheritanceError(
        `Lead \u6A21\u578B ${model} \u4E0D\u5728\u53EF\u7528\u6A21\u578B\u76EE\u5F55\uFF08Provider \u5DF2\u5220\u9664/\u7981\u7528\uFF0C\u6216\u6A21\u578B\u4E0D\u5B58\u5728\uFF09\uFF0C\u6210\u5458\u65E0\u6CD5\u7EE7\u627F\u3002`,
        latest
      );
    }
    return applyReasoningDefault(catalog, latest);
  }
  /**
   * 每轮执行前同步（0.4.0；0.4.1 修正一致性判断与重试控制）：
   * Lead 最新已确认选择 ≠ 成员**宿主实际**选择 → setModel 后再启动本轮。
   * - 一致性判断以宿主会话实际选模条目为准；历史调用不能证明下次恢复的选择。
   *   origin.modelSelection 只是辅助记录（setModel 成功后 origin 更新前崩溃 → 宿主为准，
   *   不能因 origin 相同就放行）。实际状态无法确认（首轮前无任何记录）→ 重新应用 Lead
   *   选择（宁多一次 setModel，不带着未确认的模型开跑）。
   * - 确认一致 → 清除旧失败记录（验证成功才清；不因 Lead 改了配置就清）+ 零 RPC。
   * - 应用失败 / Lead 不可继承：写统一失败记录（含类别/尝试次数/退避闸/Lead 指纹/消息 id）
   *   + 抛 ModelInheritanceError 阻止本轮 —— 绝不带着旧模型或宿主缺省悄悄开跑。
   * - legacy 隔离模式 / 会话未落定（首轮由 createChild 定模）：跳过。
   *
   * `trigger`：本轮携带的待投递消息 id（失败记录里做「新消息解锁重试」判定；首轮 = []）。
   */
  async syncMemberModel(paths, memberId, sessionId, workspacePath, triggerMessageIds = [], justApplied) {
    if (this.sessionIsolation !== "child" || sessionId === null) return;
    let lead;
    try {
      lead = this.resolveLeadInheritance();
    } catch (err) {
      if (err instanceof ModelInheritanceError) {
        const selection = err.selection;
        const gate2 = this.retryGate(paths, selection, triggerMessageIds);
        if (!gate2.allow) {
          throw new ModelSyncSuppressedError(err.message, selection);
        }
        this.recordModelFailure(paths, memberId, err, triggerMessageIds);
      }
      throw err;
    }
    if (lead === void 0) return;
    const observed = justApplied ?? this.reader.latestModelSelection(sessionId);
    if (observed !== void 0 && sameModelSelection(observed, lead)) {
      this.clearFailureIfVerified(paths);
      const originNow = readOrigin(paths);
      if (originNow !== void 0 && (originNow.modelSelection === void 0 || !sameModelSelection(originNow.modelSelection, lead))) {
        writeOrigin(paths, { ...originNow, modelSelection: lead, modelSource: "inherited" });
      }
      return;
    }
    const origin = readOrigin(paths);
    const gate = this.retryGate(paths, lead, triggerMessageIds);
    if (!gate.allow) {
      throw new ModelSyncSuppressedError(
        `\u6210\u5458 "${memberId}" \u4E0E Lead \u6A21\u578B\uFF08${lead.providerId}/${lead.modelId}\uFF09\u4E0D\u4E00\u81F4\uFF0C\u4E0A\u4E00\u6B21\u540C\u6B65\u5931\u8D25\u5C1A\u672A\u5230\u91CD\u8BD5\u65F6\u673A\uFF1A${gate.reason}`,
        lead
      );
    }
    const result = await this.applySelectionNow(sessionId, workspacePath, lead, memberId);
    if (!result.applied) {
      const reason = result.reason ?? "model was rejected by the host";
      const err = new ModelInheritanceError(
        `\u6210\u5458 "${memberId}" \u65E0\u6CD5\u540C\u6B65 Lead \u6A21\u578B\uFF08${lead.providerId}/${lead.modelId}\uFF09\uFF1A${reason}`,
        lead
      );
      this.recordModelFailure(paths, memberId, err, triggerMessageIds, classifyApplyFailure(reason), reason);
      throw err;
    }
    if (origin !== void 0) {
      writeOrigin(paths, { ...readOrigin(paths) ?? origin, modelSelection: lead, modelSource: "inherited" });
    }
    this.clearFailureIfVerified(paths);
    this.log({
      ts: iso(this.now()),
      kind: "model-synced",
      teamId: this.opts.teamId,
      memberId,
      providerId: lead.providerId,
      modelId: lead.modelId,
      reasoningLevel: lead.reasoningLevel ?? null
    });
  }
  /**
   * 自动重试闸（0.4.1）：读失败记录，判定本次同步尝试是否放行。
   * - 无记录 / Lead 选择已变（指纹不同）→ 放行（换模 = 重新尝试的显式信号）。
   * - 新消息解锁：trigger 里有记录 messageIds 之外的**新** id → 放行（用户再次明确发送）。
   * - deterministic（含 0.4.0 旧记录无 kind）→ 暂停相同选择的自动重试（拒绝）。
   * - transient → 未到 nextAttemptAt 拒绝；到期且 attempts ≤ 退避序列长度放行；
   *   序列耗尽 → 停止自动尝试（拒绝）。
   * `lead` 缺省 = 解析失败（三源全空，无选择指纹）——按记录的 leadSignature 缺省口径同目标。
   */
  retryGate(paths, lead, triggerMessageIds) {
    let record2;
    try {
      record2 = readModelFailed(paths);
    } catch {
      record2 = void 0;
    }
    if (record2 === void 0) return { allow: true, reason: "" };
    const signature = lead !== void 0 ? selectionSignature(lead) : void 0;
    if (record2.leadSignature !== signature) {
      return { allow: true, reason: "" };
    }
    const known = new Set(record2.messageIds ?? []);
    const hasNewMessage = triggerMessageIds.some((id) => !known.has(id));
    if (hasNewMessage) {
      return { allow: true, reason: "" };
    }
    const kind = record2.kind ?? "deterministic";
    if (kind === "deterministic") {
      return {
        allow: false,
        reason: `\u76F8\u540C\u9009\u62E9\u7684\u540C\u6B65\u5DF2\u88AB\u786E\u5B9A\u6027\u62D2\u7EDD\uFF08${record2.reason}\uFF09\uFF0C\u7B49\u5F85 Lead \u5207\u6362\u53EF\u7528\u6A21\u578B\u6216\u65B0\u6D88\u606F\u540E\u91CD\u8BD5`
      };
    }
    const attempts = record2.attempts ?? 1;
    const nextAt = record2.nextAttemptAt;
    if (nextAt !== void 0 && this.now() < nextAt) {
      return {
        allow: false,
        reason: `\u4E34\u65F6\u6545\u969C\u9000\u907F\u4E2D\uFF08\u7B2C ${attempts} \u6B21\u5C1D\u8BD5\u5DF2\u5931\u8D25\uFF09\uFF0C${Math.ceil((nextAt - this.now()) / 1e3)}s \u540E\u81EA\u52A8\u91CD\u8BD5`
      };
    }
    if (attempts > this.modelRetryBackoffMs.length) {
      return {
        allow: false,
        reason: `\u4E34\u65F6\u6545\u969C\u5DF2\u8FDE\u7EED\u5931\u8D25 ${attempts - 1} \u6B21\uFF08\u9000\u907F\u5E8F\u5217\u8017\u5C3D\uFF09\uFF0C\u505C\u6B62\u81EA\u52A8\u91CD\u8BD5\uFF1B\u7B49\u5F85 Lead \u5207\u6362\u6A21\u578B\u6216\u65B0\u6D88\u606F`
      };
    }
    return { allow: true, reason: "" };
  }
  /**
   * 统一失败记录路径（0.4.1）：解析失败（throwOnUnusable 抛出的 ModelInheritanceError）与
   * 宿主应用失败都落到这里——model-failed.json（成员行诊断）+ provider.jsonl + 展示刷新通知。
   * 记录携带重试控制所需全部字段（类别/次数/退避闸/Lead 指纹/触发消息 id）；不重建 pending 队列。
   */
  recordModelFailure(paths, memberId, err, triggerMessageIds, kindOverride, reasonOverride) {
    const now2 = this.now();
    let previous;
    try {
      previous = readModelFailed(paths);
    } catch {
      previous = void 0;
    }
    const selection = err.selection;
    const signature = selection !== void 0 ? selectionSignature(selection) : void 0;
    const sameTarget = previous !== void 0 && (previous.leadSignature ?? void 0) === signature;
    const kind = kindOverride ?? classifySelectionFailure(err.message);
    const attempts = sameTarget && kind === "transient" ? (previous?.attempts ?? 1) + 1 : 1;
    const backoff = kind === "transient" ? this.modelRetryBackoffMs[attempts - 1] : void 0;
    const messageIds = /* @__PURE__ */ new Set([
      ...sameTarget ? previous?.messageIds ?? [] : [],
      ...triggerMessageIds,
      ...this.pendingLookup !== null ? this.pendingLookup(memberId).map((item) => item.messageId) : []
    ]);
    const record2 = {
      ...selection !== void 0 ? { modelSelection: selection } : {},
      reason: compactReason(reasonOverride ?? err.message),
      failedAt: iso(now2),
      kind,
      attempts,
      ...backoff !== void 0 ? { nextAttemptAt: now2 + backoff } : {},
      ...signature !== void 0 ? { leadSignature: signature } : {},
      ...messageIds.size > 0 ? { messageIds: [...messageIds] } : {}
    };
    writeModelFailed(paths, record2);
    this.log({
      ts: iso(now2),
      kind: "model-sync-failed",
      teamId: this.opts.teamId,
      memberId,
      failureKind: kind,
      attempts,
      nextAttemptAt: record2.nextAttemptAt ?? null,
      providerId: selection?.providerId ?? null,
      modelId: selection?.modelId ?? null,
      reason: record2.reason
    });
    this.notifyModelFailureChanged();
  }
  /** 验证成功才清除（修复4）：失败记录存在 → 删除 + 展示刷新通知。调用点均已确认一致/应用成功。 */
  clearFailureIfVerified(paths) {
    let existed = false;
    try {
      existed = readModelFailed(paths) !== void 0;
    } catch {
      existed = true;
    }
    clearModelFailed(paths);
    if (existed) this.notifyModelFailureChanged();
  }
  /** 应用一次模型选择（每轮同步通道：临时实例 resume → setModel；失败返回原因不抛）。 */
  async applySelectionNow(sessionId, workspacePath, selection, memberId) {
    if (this.breeder.applyModelSelection === void 0) {
      this.log({ ts: iso(this.now()), kind: "model-apply-unsupported", memberId });
      return { applied: false, reason: "breeder does not support model application" };
    }
    try {
      const result = await this.breeder.applyModelSelection({ sessionId, workspacePath, selection });
      if (!result.applied) {
        this.log({
          ts: iso(this.now()),
          kind: "model-apply-failed",
          teamId: this.opts.teamId,
          memberId,
          reason: result.reason ?? "unknown"
        });
      }
      return result;
    } catch (err) {
      const reason = errText2(err);
      this.log({ ts: iso(this.now()), kind: "model-apply-failed", teamId: this.opts.teamId, memberId, reason });
      return { applied: false, reason };
    }
  }
  /**
   * 成员行诊断（GitHub #6 保留面）：读 model-failed.json → 一条可读诊断。
   * 无记录/损坏 → []（损坏不阻断 list_agents；失败信息已尽力而为）。
   * 0.4.1：记录可无 modelSelection（三源全空解析不出）；transient 附重试进度提示。
   */
  diagnosticsOf(memberId) {
    const paths = memberPaths(this.teamDir, memberId);
    let record2;
    try {
      record2 = readModelFailed(paths);
    } catch {
      return [];
    }
    if (record2 === void 0) return [];
    const reason = typeof record2.reason === "string" ? record2.reason : "";
    const selection = parseModelSelection(record2.modelSelection);
    const head = selection !== void 0 ? `\u6210\u5458\u6A21\u578B\u7EE7\u627F\u5931\u8D25\uFF1A${selection.providerId}/${selection.modelId}${reason.length > 0 ? `\uFF08${reason}\uFF09` : ""}` : `\u6210\u5458\u6A21\u578B\u7EE7\u627F\u5931\u8D25\uFF1A${reason}`;
    if ((record2.kind ?? "deterministic") === "transient" && (record2.attempts ?? 1) > 1) {
      return [`${head}\uFF08\u4E34\u65F6\u6545\u969C\uFF0C\u5DF2\u81EA\u52A8\u91CD\u8BD5 ${record2.attempts - 1} \u6B21\uFF09`];
    }
    return [head];
  }
  /** daemon 侧补写 teammate 映射（hook 未及写时的兜底；不覆盖已有 teammate 映射）。 */
  writeTeammateMapping(sessionId, origin) {
    const registry2 = readSessionRegistry(this.opts.dataRoot);
    const existing = registry2[sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128)];
    if (existing?.role === "teammate" && existing.memberId !== origin.memberId) return;
    upsertSessionEntry(this.opts.dataRoot, sessionId, {
      teamId: origin.teamId,
      role: "teammate",
      name: origin.name,
      memberId: origin.memberId
    });
  }
  /** drain 标记处置（触发点②兜底）：keep → 清标记（休眠态，轮次照旧纳管）；kill → 补杀。 */
  handleDrainMarker(paths) {
    const marker = readJson(paths.drainMarkerFile);
    if (marker === void 0) return;
    try {
      fs18.unlinkSync(paths.drainMarkerFile);
    } catch {
    }
    if (marker.policy === "kill" && marker.turnId !== void 0) {
      const turn = readTurn(paths.runDir, marker.turnId);
      if (turn !== void 0 && turn.pid !== null && pidAlive(turn.pid)) {
        void killProcessGroup(turn.pgid, this.termGraceMs).then((dead) => {
          writeTurn(paths.runDir, { ...turn, status: dead ? "exited" : turn.status, exitedAt: iso(this.now()) });
        }).catch(() => void 0);
      }
    }
  }
};
function listMembers(teamDir) {
  const membersDir = path17.join(teamDir, "members");
  let names;
  try {
    names = fs18.readdirSync(membersDir);
  } catch {
    return [];
  }
  return names.filter((n) => !n.startsWith("."));
}
function safeDir(teamId) {
  return teamId.replace(/[^A-Za-z0-9._-]/g, (c) => "~" + c.codePointAt(0).toString(16));
}
function sha256(text) {
  return createHash2("sha256").update(text).digest("hex");
}
function iso(ms) {
  return new Date(ms).toISOString();
}
function errText2(err) {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
function compactReason(reason) {
  const firstLine = reason.split(/\n/)[0] ?? "";
  const firstSentence = firstLine.split(/(?<=[。！？.!?])\s*/)[0] ?? firstLine;
  return truncateReason(firstSentence.trim());
}
function truncateReason(text) {
  if (text.length === 0) return "";
  return text.length > 80 ? `${text.slice(0, 79)}\u2026` : text;
}
function sameModelSelection(a, b) {
  return a.providerId === b.providerId && a.modelId === b.modelId && (a.reasoningLevel ?? "") === (b.reasoningLevel ?? "");
}
function drainPolicyFromEnv() {
  return process.env.TEAM_DRAIN_ON_DISPOSE === "kill" ? "kill" : "keep";
}

// src/panel/view-service.ts
import fs19 from "node:fs";
import path18 from "node:path";

// src/ui-core/view.ts
var VIEW_STATE_VERSION = 4;
function emptyViewFrame(generatedAt, sessionId) {
  return {
    type: "view",
    stateVersion: VIEW_STATE_VERSION,
    team: null,
    members: [],
    tasks: [],
    meta: { generatedAt, revision: 0, ...sessionId !== void 0 ? { sessionId } : {} }
  };
}

// src/panel/view-service.ts
function snapshotFile(teamDir) {
  return path18.join(teamDir, "ui", "view-snapshot.json");
}
function resolveMemberSession(teamDir, dataRoot, memberId) {
  const origin = readOrigin(memberPaths(teamDir, memberId))?.sessionId;
  if (origin !== null && origin !== void 0) return origin;
  for (const entry of Object.values(readSessionRegistry(dataRoot))) {
    if (entry.memberId === memberId && typeof entry.session_id === "string") return entry.session_id;
  }
  return void 0;
}
function replayFingerprint(teamDir) {
  const parts = [];
  for (const f of [path18.join(teamDir, "events.jsonl"), path18.join(teamDir, "checkpoint.json")]) {
    try {
      const st = fs19.statSync(f);
      parts.push(`${st.mtimeMs}:${st.size}`);
    } catch {
      parts.push("missing");
    }
  }
  return parts.join("|");
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
var REPLAY_CACHE_MAX = 16;
var PanelViewService = class {
  constructor(deps) {
    this.deps = deps;
  }
  replayCache = /* @__PURE__ */ new Map();
  /**
   * 推帧判定键：仅覆盖面板**渲染面**（team.status/failure + members + tasks）。
   * 不含 seq/revision——mailbox-only 变化会推进 seq（team/message[/delivered] 事件），
   * 但 members/tasks/failure 不变 → 键不变 → 不推帧（F02「mailbox-only 不发帧」口径）。
   */
  contentKey(frame) {
    return JSON.stringify({
      // teamId 必须入键：切团队/会话后即便 members/tasks 形状巧合相同，也不得复用上一团队的键。
      teamId: frame.team?.teamId ?? null,
      status: frame.team?.status ?? null,
      failure: frame.team?.failure ?? null,
      members: frame.members,
      tasks: frame.tasks
    });
  }
  /**
   * 构建指定会话的团队视图帧。
   * 身份不可解析（无 _meta 且无 hook 映射）→ team:null 空帧（面板呈现加载/不可用，
   * 不向订阅者抛错）；团队无事件（隐式 Lead 未建团）→ team:null 空帧（不开 host）。
   */
  async buildFrame(meta, sessionIdHint) {
    const nowIso = ts();
    let identity;
    try {
      identity = resolveIdentity({
        dataRoot: this.deps.dataRoot,
        meta,
        bootTimeMs: this.deps.bootTimeMs
      });
    } catch (err) {
      this.deps.warn?.(`panel view: identity unresolved (${err instanceof Error ? err.message : String(err)})`);
      return emptyViewFrame(nowIso, sessionIdHint);
    }
    return this.buildFrameForIdentity(identity, nowIso);
  }
  /** 身份已解析的构帧（team_panel_call refresh 与订阅轮询共用）。 */
  async buildFrameForIdentity(identity, nowIso = ts()) {
    const teamId = identity.teamId;
    const paths = teamPaths(this.deps.dataRoot, teamId);
    if (!fs19.existsSync(paths.eventsFile)) {
      const snap = this.readSnapshot(teamId);
      if (snap === void 0) {
        return { ...emptyViewFrame(nowIso, identity.sessionId), team: null };
      }
      return { ...snap, meta: { ...snap.meta, generatedAt: nowIso, sessionId: identity.sessionId } };
    }
    const loaded = await this.replay(paths.teamDir, teamId);
    const state = loaded.state;
    let rows = [];
    try {
      rows = await this.deps.backend.listAgents(identity);
    } catch (err) {
      this.deps.warn?.(`panel view: listAgents failed (${err instanceof Error ? err.message : String(err)})`);
    }
    if (rows.length === 0) {
      return buildStaticFrame(loaded, teamId, nowIso, identity.sessionId, paths.teamDir, this.deps.dataRoot);
    }
    const members = rows.map((row) => {
      const snap = row.role === "lead" ? void 0 : state.members.find((m) => m.name === row.target);
      const id = row.role === "lead" ? teamId : snap?.id ?? row.target;
      const sessionId = row.role === "lead" ? teamId : resolveMemberSession(paths.teamDir, this.deps.dataRoot, id);
      return { ...row, id, ...sessionId !== void 0 ? { sessionId } : {} };
    });
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
        generatedAt: nowIso,
        revision: loaded.seq,
        sessionId: identity.sessionId
      }
    };
  }
  /** 重放（带指纹缓存；LRU：命中移到队尾，超限淘汰最久未用）。 */
  async replay(teamDir, teamId) {
    const fingerprint = replayFingerprint(teamDir);
    const cached2 = this.replayCache.get(teamId);
    if (cached2 !== void 0 && cached2.fingerprint === fingerprint) {
      this.replayCache.delete(teamId);
      this.replayCache.set(teamId, cached2);
      return cached2.loaded;
    }
    const loaded = await load(teamDir, teamId);
    this.replayCache.delete(teamId);
    this.replayCache.set(teamId, { fingerprint, loaded });
    while (this.replayCache.size > REPLAY_CACHE_MAX) {
      const oldest = this.replayCache.keys().next().value;
      if (oldest === void 0) break;
      this.replayCache.delete(oldest);
    }
    return loaded;
  }
  /** 帧落盘（teams/<id>/ui/view-snapshot.json；tmp+rename 原子替换；失败仅告警）。 */
  writeSnapshot(teamId, frame) {
    const file = snapshotFile(teamPaths(this.deps.dataRoot, teamId).teamDir);
    try {
      fs19.mkdirSync(path18.dirname(file), { recursive: true, mode: 448 });
      const tmp = `${file}.${process.pid}.tmp`;
      fs19.writeFileSync(tmp, JSON.stringify(frame), { mode: 384 });
      fs19.renameSync(tmp, file);
    } catch (err) {
      this.deps.warn?.(`panel view: snapshot write failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  /** 读快照（断线重连基线/daemon 冷启动首帧；无/损坏 → undefined）。 */
  readSnapshot(teamId) {
    const file = snapshotFile(teamPaths(this.deps.dataRoot, teamId).teamDir);
    try {
      const parsed = JSON.parse(fs19.readFileSync(file, "utf8"));
      return parsed.type === "view" && parsed.stateVersion === VIEW_STATE_VERSION ? parsed : void 0;
    } catch {
      return void 0;
    }
  }
  /** 重放态直读（detail 合成/team-ctl 共用；无缓存需求场景）。 */
  async loadState(teamId) {
    const { teamDir } = teamPaths(this.deps.dataRoot, teamId);
    const loaded = await this.replay(teamDir, teamId);
    return loaded.state;
  }
};

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

// src/panel/panel-call.ts
async function handlePanelCall(deps, args, meta) {
  const action = typeof args.action === "string" ? args.action : void 0;
  const label = typeof args.label === "string" ? args.label : null;
  if (action === void 0 || action === "heartbeat") {
    return { kind: "heartbeat", counter: deps.bumpCounter(), ts: now(deps), label };
  }
  try {
    if (action === "refresh") {
      const frame = await deps.view.buildFrame(meta);
      return { kind: "view", frame };
    }
    if (action === "detail") {
      if (typeof args.target !== "string" || args.target.length === 0) {
        throw new TeamError("TEAM_INVALID_ARGUMENT", 'param "target" must be a non-empty string');
      }
      return { kind: "detail", detail: await buildDetailCall(deps, args, meta) };
    }
    throw new TeamError("TEAM_INVALID_ARGUMENT", `unknown panel action "${String(action)}"`);
  } catch (err) {
    if (err instanceof TeamError) {
      const reason = err instanceof SessionNotSettledError ? "session-not-settled" : void 0;
      return { kind: "error", code: err.code, message: err.message, ...reason !== void 0 ? { reason } : {} };
    }
    const message = err instanceof Error ? err.message : String(err);
    deps.warn?.(`panel call failed: ${message}`);
    return { kind: "error", code: "", message };
  }
}
async function buildDetailCall(deps, args, meta) {
  const identity = resolveIdentity({
    dataRoot: deps.dataRoot,
    meta,
    bootTimeMs: deps.bootTimeMs
  });
  const paths = teamPaths(deps.dataRoot, identity.teamId);
  const loaded = await load(paths.teamDir, identity.teamId);
  requireMembership(() => {
    if (loaded.state.failure !== void 0) throw new Error(loaded.state.failure);
    return loaded.state;
  }, identity.agentId);
  const reader = deps.reader ?? new TranscriptReader();
  const cursor = typeof args.cursor === "number" ? args.cursor : void 0;
  const limit = typeof args.limit === "number" ? args.limit : void 0;
  return buildDetail(
    { teamDir: paths.teamDir, teamId: identity.teamId, state: loaded.state, reader },
    {
      target: args.target,
      ...cursor !== void 0 ? { cursor } : {},
      ...limit !== void 0 ? { limit } : {}
    },
    (memberId) => resolveMemberSession(paths.teamDir, deps.dataRoot, memberId)
  );
}
function now(deps) {
  return deps.now !== void 0 ? deps.now() : (/* @__PURE__ */ new Date()).toISOString();
}

// src/panel/companion-server.ts
import crypto3 from "node:crypto";
import fs20 from "node:fs";
import http from "node:http";
import path19 from "node:path";
var COMPANION_REGISTRY_RELPATH = "logs/panel-http.json";
var SSE_POLL_MS = 500;
function companionRegistryFile(dataRoot) {
  const root = path19.resolve(dataRoot);
  const file = path19.join(root, COMPANION_REGISTRY_RELPATH);
  if (file !== path19.join(root, "logs", "panel-http.json")) {
    throw new Error("companion registry path escapes dataRoot");
  }
  return file;
}
async function startCompanionServer(deps) {
  const token = crypto3.randomBytes(16).toString("hex");
  const registryFile = companionRegistryFile(deps.dataRoot);
  const sseClients = /* @__PURE__ */ new Set();
  const backpressured = /* @__PURE__ */ new Set();
  let lastKey = "";
  let lastAnchor = null;
  let pushInFlight = null;
  let pushDirty = false;
  let pollTimer = null;
  let closed = false;
  const server2 = http.createServer((req, res) => {
    void route(req, res);
  });
  async function route(req, res) {
    const remote = req.socket.remoteAddress;
    if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("forbidden");
      return;
    }
    const url2 = new URL(req.url ?? "/", "http://127.0.0.1");
    const reqToken = url2.searchParams.get("token") ?? headerToken(req);
    if (reqToken === null || !timingSafeEqualStr(reqToken, token)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("forbidden");
      return;
    }
    if ((url2.pathname === "/" || url2.pathname === "/panel") && (req.method === "GET" || req.method === "HEAD")) {
      servePage(res);
      return;
    }
    if (url2.pathname === "/events" && req.method === "GET") {
      serveSse(req, res);
      return;
    }
    if (url2.pathname === "/api/call" && req.method === "POST") {
      await serveApiCall(req, res);
      return;
    }
    if (url2.pathname === "/healthz" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
  function headerToken(req) {
    const h = req.headers["x-team-token"];
    return typeof h === "string" ? h : null;
  }
  function servePage(res) {
    try {
      const html = fs20.readFileSync(deps.pageFile, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`companion page unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  function serveSse(req, res) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive"
    });
    res.write(`event: hello
data: ${JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString() })}

`);
    sseClients.add(res);
    res.on("drain", () => backpressured.delete(res));
    req.on("close", () => {
      sseClients.delete(res);
      backpressured.delete(res);
      if (sseClients.size === 0 && pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    });
    ensurePolling();
    void pushFrame2(true);
  }
  function ensurePolling() {
    if (pollTimer !== null || closed) return;
    pollTimer = setInterval(() => void pushFrame2(false), SSE_POLL_MS);
    pollTimer.unref?.();
  }
  async function pushFrame2(force) {
    if (closed) return;
    if (pushInFlight !== null) {
      pushDirty = true;
      return pushInFlight;
    }
    pushInFlight = (async () => {
      try {
        do {
          pushDirty = false;
          await pushOnce(force);
          force = false;
        } while (pushDirty && !closed);
      } catch (err) {
        deps.warn?.(`companion sse push failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        pushInFlight = null;
      }
    })();
    return pushInFlight;
  }
  async function pushOnce(force) {
    if (closed) return;
    const sessionId = deps.anchoredSession();
    if (sessionId === null) {
      lastAnchor = null;
      return;
    }
    if (sseClients.size === 0) return;
    const frame = await deps.view.buildFrame({ session_id: sessionId });
    if (deps.anchoredSession() !== sessionId) {
      pushDirty = true;
      return;
    }
    const key = deps.view.contentKey(frame);
    const anchorChanged = lastAnchor !== sessionId;
    if (!force && !anchorChanged && key === lastKey) return;
    lastAnchor = sessionId;
    lastKey = key;
    const payload = `event: view
data: ${JSON.stringify(frame)}

`;
    for (const client of [...sseClients]) {
      if (client.writableEnded || backpressured.has(client)) continue;
      if (!client.write(payload)) backpressured.add(client);
    }
  }
  async function serveApiCall(req, res) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      total += chunk.length;
      if (total > 8192) {
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: { message: "request body too large" } }));
        return;
      }
      chunks.push(chunk);
    }
    let args = {};
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (typeof parsed === "object" && parsed !== null) args = parsed;
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: { message: "invalid json body" } }));
      return;
    }
    const sessionId = deps.anchoredSession();
    const meta = sessionId !== null ? { session_id: sessionId } : void 0;
    const result = await handlePanelCall(
      { ...deps.panelCall, view: deps.view, dataRoot: deps.dataRoot },
      args,
      meta
    );
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  }
  await new Promise((resolve, reject) => {
    server2.once("error", reject);
    server2.listen(0, "127.0.0.1", () => {
      server2.off("error", reject);
      resolve();
    });
  });
  const addr = server2.address();
  const url = `http://127.0.0.1:${addr.port}/panel?token=${token}`;
  try {
    fs20.mkdirSync(path19.dirname(registryFile), { recursive: true });
    const tmp = `${registryFile}.${process.pid}.tmp`;
    fs20.writeFileSync(
      tmp,
      JSON.stringify({ port: addr.port, token, pid: process.pid, startedAt: (/* @__PURE__ */ new Date()).toISOString() }),
      { mode: 384 }
    );
    fs20.renameSync(tmp, registryFile);
  } catch (err) {
    deps.warn?.(`companion registry write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return {
    url: () => url,
    port: () => addr.port,
    close: async () => {
      if (closed) return;
      closed = true;
      if (pollTimer !== null) clearInterval(pollTimer);
      for (const client of sseClients) client.end();
      sseClients.clear();
      try {
        const current = JSON.parse(fs20.readFileSync(registryFile, "utf8"));
        if (current.pid === process.pid) fs20.unlinkSync(registryFile);
      } catch {
      }
      await new Promise((resolve) => server2.close(() => resolve()));
    }
  };
}
function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto3.timingSafeEqual(ba, bb);
}

// src/daemon.ts
var __dirname = path20.dirname(fileURLToPath3(import.meta.url));
var VIEW_URI = "team://view";
var PANEL_URI = "ui://agent-team/team-panel.html";
var NODE_MIN = 22;
var BOOT_TIME_MS = Date.now();
var nodeMajor = Number(process.versions.node.split(".")[0]);
var nodeWarn = nodeMajor < NODE_MIN ? `agent-team daemon \u9700\u8981 Node >= ${NODE_MIN}\uFF08\u5F53\u524D ${process.versions.node}\uFF09\uFF0C\u9762\u677F\u4E0E\u5DE5\u5177\u53EF\u80FD\u4E0D\u53EF\u7528\u3002\u8BF7\u5B89\u88C5 Node 22+\u3002` : null;
var DATA = dataDir();
ensurePrivateDir(DATA);
ensurePrivateDir(path20.join(DATA, "logs"));
ensurePrivateDir(path20.join(DATA, "meta"));
ensurePrivateDir(path20.join(DATA, "session-map"));
var staleSpecs = cleanupStaleSpecs(DATA);
var prunedMeta = pruneMetaFiles(DATA);
appendJsonl(path20.join(DATA, "logs", "daemon-lifecycle.jsonl"), {
  event: "startup",
  ts: ts(),
  pid: process.pid,
  node: process.versions.node,
  execPath: process.execPath,
  nodeWarn,
  staleSpecsRemoved: staleSpecs,
  metaFilesPruned: prunedMeta,
  cwd: process.cwd(),
  teamEnv: {
    TEAM_PLUGIN_DATA: process.env.TEAM_PLUGIN_DATA,
    TEAM_PROJECT_DIR: process.env.TEAM_PROJECT_DIR,
    TEAM_PLUGIN_ROOT: process.env.TEAM_PLUGIN_ROOT,
    ZCODE_SESSION_ID: process.env.ZCODE_SESSION_ID,
    // 预期 undefined：env 不注入会话 id（已定案）
    TEAM_MAX_MEMBERS: process.env.TEAM_MAX_MEMBERS
  }
});
if (nodeWarn) logErr("daemon", nodeWarn);
var config2 = loadConfig();
if (!config2.ok) {
  logErr("daemon", config2.error);
  appendJsonl(path20.join(DATA, "logs", "daemon-lifecycle.jsonl"), {
    event: "invalid-config",
    ts: ts(),
    error: config2.error
  });
}
var interruptEnabled = (process.env.TEAM_INTERRUPT ?? "true") !== "false";
var leadModeRaw = process.env.TEAM_LEAD_MODE;
var leadMode = validateLeadMode(leadModeRaw);
if (leadModeRaw !== void 0 && leadModeRaw !== "orchestrator" && leadModeRaw !== "collaborator") {
  logErr("daemon", `invalid TEAM_LEAD_MODE ${JSON.stringify(leadModeRaw)} \u2014 falling back to "${leadMode}"`);
}
if (config2.ok) {
  writeRuntimeConfig({ interrupt: interruptEnabled, leadMode, limits: config2.values });
}
var sessionIsolation = isolationModeFromEnv();
var providerLog = (record2) => appendJsonl(path20.join(DATA, "logs", "provider.jsonl"), record2);
var backend = new TeamToolBackend({
  dataRoot: DATA,
  limits: config2.ok ? config2.values : DEFAULT_HOST_LIMITS,
  interrupt: interruptEnabled,
  providerFactory: (teamId) => new ResumePerTurnProvider({
    dataRoot: DATA,
    teamId,
    cwd: process.env.TEAM_PROJECT_DIR,
    sessionIsolation,
    log: providerLog
  }),
  warn: (m) => logErr("backend", m)
});
appendJsonl(path20.join(DATA, "logs", "provider.jsonl"), {
  event: "session-isolation-mode",
  mode: sessionIsolation,
  ts: ts(),
  pid: process.pid
});
var signalTestMode = fs21.existsSync(path20.join(DATA, "signal-test"));
var signalLog = path20.join(DATA, "logs", "signals.jsonl");
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    appendJsonl(signalLog, { sig, ts: ts(), pid: process.pid, mode: signalTestMode ? "observe" : "graceful" });
    logErr("daemon", `signal ${sig} received`);
    if (signalTestMode) return;
    const deadline = setTimeout(() => {
      appendJsonl(path20.join(DATA, "logs", "daemon-lifecycle.jsonl"), {
        event: "dispose-timeout",
        ts: ts(),
        sig,
        pid: process.pid
      });
      process.exit(0);
    }, 200);
    backend.close().then(() => companion !== null ? companion.close() : void 0).then(() => {
      appendJsonl(path20.join(DATA, "logs", "daemon-lifecycle.jsonl"), {
        event: "dispose-ok",
        ts: ts(),
        sig,
        pid: process.pid
      });
    }).catch((err) => {
      appendJsonl(path20.join(DATA, "logs", "daemon-lifecycle.jsonl"), {
        event: "dispose-failed",
        ts: ts(),
        sig,
        pid: process.pid,
        error: err instanceof AggregateError ? `${err.message}: ${err.errors.map((e) => String(e)).join("; ")}` : String(err)
      });
    }).finally(() => {
      clearTimeout(deadline);
      process.exit(0);
    });
  });
}
process.on("exit", (code) => {
  appendJsonl(path20.join(DATA, "logs", "daemon-lifecycle.jsonl"), { event: "exit", ts: ts(), code, pid: process.pid });
});
var panelView = new PanelViewService({
  dataRoot: DATA,
  bootTimeMs: BOOT_TIME_MS,
  backend,
  warn: (m) => logErr("panel-view", m)
});
var view = {
  counter: 0,
  /** resources/subscribe 是连接级布尔订阅（同一客户端重复 subscribe 不叠加计数）。 */
  subscribed: false,
  /** 会话锚点代际：切会话即 +1；跨代构帧结果丢弃，避免旧会话帧覆盖新会话。 */
  epoch: 0,
  lastFrameTs: null,
  /** 最近活跃会话 id（team://view 的团队解析键；callTool _meta 每调更新）。 */
  lastSessionId: null,
  lastFrame: null,
  lastContentKey: ""
};
var frameTimer = null;
var pollInFlight = null;
var pollDirty = false;
function setViewSession(sessionId) {
  if (view.lastSessionId === sessionId) return;
  view.lastSessionId = sessionId;
  view.epoch += 1;
  view.lastContentKey = "";
  pollDirty = true;
}
async function pollOnce() {
  const sessionId = view.lastSessionId;
  const epoch = view.epoch;
  if (sessionId === null) return;
  const frame = await panelView.buildFrame({ session_id: sessionId });
  if (view.epoch !== epoch || view.lastSessionId !== sessionId) {
    pollDirty = true;
    return;
  }
  const key = panelView.contentKey(frame);
  if (key === view.lastContentKey) return;
  view.lastContentKey = key;
  view.lastFrame = frame;
  view.lastFrameTs = ts();
  if (frame.team !== null) panelView.writeSnapshot(frame.team.teamId, frame);
  if (view.subscribed) pushFrame(VIEW_URI);
}
async function pollView() {
  if (pollInFlight !== null) {
    pollDirty = true;
    return pollInFlight;
  }
  pollInFlight = (async () => {
    try {
      do {
        pollDirty = false;
        await pollOnce();
      } while (pollDirty);
    } catch (err) {
      logErr("panel-view", `poll failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      pollInFlight = null;
    }
  })();
  return pollInFlight;
}
var panelCallDeps = {
  bootTimeMs: BOOT_TIME_MS,
  reader: new TranscriptReader(),
  bumpCounter: () => view.counter += 1,
  now: ts,
  warn: (m) => logErr("panel-call", m)
};
var companion = null;
if ((process.env.TEAM_COMPANION ?? "") === "1") {
  void startCompanionServer({
    dataRoot: DATA,
    view: panelView,
    panelCall: panelCallDeps,
    pageFile: path20.join(__dirname, "ui", "team-companion.html"),
    anchoredSession: () => view.lastSessionId,
    warn: (m) => logErr("companion", m)
  }).then(
    (srv) => {
      companion = srv;
      appendJsonl(path20.join(DATA, "logs", "daemon-lifecycle.jsonl"), {
        event: "companion-started",
        ts: ts(),
        pid: process.pid,
        port: srv.port()
      });
      logErr("companion", `companion panel listening: ${srv.url()}`);
    },
    (err) => logErr("companion", `start failed: ${err instanceof Error ? err.message : String(err)}`)
  );
}
var server = new Server(
  {
    name: "team-daemon",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {},
      resources: { subscribe: true, listChanged: false }
    }
  }
);
var TOOL_PING_DESC = "\u56E2\u961F\u5FC3\u8DF3\u63A2\u9488\uFF08\u8BCA\u65AD\u7528\uFF09\u3002\u8FD4\u56DE daemon \u5B58\u6D3B\u72B6\u6001\u3001\u5F53\u524D\u4F1A\u8BDD\u8EAB\u4EFD\uFF08\u6765\u81EA\u8C03\u7528\u4E0A\u4E0B\u6587\u7684 session_id\uFF09\u4E0E\u914D\u7F6E\u6458\u8981\u3002";
var TOOLS = [
  {
    name: "team_ping",
    description: TOOL_PING_DESC,
    inputSchema: {
      type: "object",
      properties: {
        echo: { type: "string", description: "\u53EF\u9009\u56DE\u663E\u6587\u672C" }
      }
    }
  },
  {
    name: "team_panel_call",
    description: "\u9762\u677F\u56DE\u73AF\u5DE5\u5177\uFF08app \u4E13\u7528\uFF09\uFF1A\u9762\u677F\u7ECF callServerTool \u8C03\u7528\u3002label-only = \u5FC3\u8DF3/\u8BA1\u6570\uFF08H12 \u4FDD\u6D3B\u8F7D\u4F53\uFF09\uFF1Baction=refresh = \u5168\u91CF\u89C6\u56FE\u5E27\uFF1Baction=detail + target = \u6210\u5458\u4F1A\u8BDD\u67E5\u770B\u89C6\u56FE\uFF08T5.7\uFF0Ccursor/limit \u5206\u9875\uFF09\u3002detail \u6309\u8F6E\u6458\u8981\uFF08\u4EC5\u7B80\u6D01\u4E00\u79CD\u5F62\u6001\uFF1A\u7528\u6237\u6307\u4EE4 + \u52A8\u4F5C\u7EC4 + \u6BCF\u8F6E\u7ED3\u8BBA\uFF09\u3002",
    visibility: ["app"],
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "\u8C03\u7528\u6765\u6E90\u6807\u6CE8\uFF08\u5982 heartbeat / manual\uFF09" },
        action: {
          type: "string",
          enum: ["refresh", "detail"],
          description: "refresh = \u5168\u91CF\u89C6\u56FE\u5E27\uFF1Bdetail = \u6210\u5458\u4F1A\u8BDD\u67E5\u770B\u89C6\u56FE\uFF08\u9700 target\uFF09"
        },
        target: { type: "string", description: "detail \u76EE\u6807\u6210\u5458 id\uFF08\u6216\u6210\u5458\u540D\uFF1Blead \u4EA6\u53EF\uFF09" },
        cursor: { type: "number", description: "detail seq \u6E38\u6807\uFF08\u8FD4\u56DE seq < cursor \u7684\u6700\u8FD1\u4E00\u9875\uFF1B\u7F3A\u7701 = \u672B\u9875/\u6700\u8FD1\u4E0A\u4E0B\u6587\uFF09" },
        limit: { type: "number", description: "detail \u9875\u5927\u5C0F\uFF08\u9ED8\u8BA4 100\uFF0C\u4E0A\u9650 200\uFF09" }
      }
    }
  }
];
var RESOURCES = [
  { uri: PANEL_URI, name: "agent-team-panel", mimeType: "text/html", description: "\u667A\u80FD\u4F53\u56E2\u961F\u4F1A\u8BDD\u9762\u677F\uFF08\u56E2\u961F\u89C6\u56FE + \u6210\u5458\u4F1A\u8BDD\u4E0B\u94BB\uFF09" },
  { uri: VIEW_URI, name: "agent-team-view", mimeType: "application/json", description: "\u56E2\u961F\u89C6\u56FE\u5E27\uFF08\u8BA2\u9605\u63A8\u9001\u6E90\uFF09" }
  // 0.4.0 注销 team://models 资源：成员模型没有配置通道（目录仅 provider 层分类内部使用）。
];
server.setRequestHandler(ListToolsRequestSchema, async () => {
  appendJsonl(path20.join(DATA, "logs", "requests.jsonl"), { ts: ts(), method: "tools/list" });
  const debugTools = process.env.TEAM_DEBUG_TOOLS === "1";
  const supportTools = debugTools ? TOOLS : TOOLS.filter((t) => t.name !== "team_ping");
  return { tools: [...supportTools, ...listTeamTools({ interrupt: backend.interruptEnabled })] };
});
server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
  const { name, arguments: args, _meta } = req.params;
  const record2 = {
    ts: ts(),
    tool: sanitizeToolName(name),
    params_meta: _meta ?? null,
    // H1 证据：每次调用的 _meta 全量
    arguments: redactToolArguments(args ?? null),
    sessionIdEnv: process.env.ZCODE_SESSION_ID ?? null
  };
  appendJsonl(path20.join(DATA, "logs", "meta-log.jsonl"), record2);
  const perCallFile = metaFilePath(DATA, name);
  if (perCallFile !== null) {
    try {
      fs21.writeFileSync(perCallFile, JSON.stringify(record2, null, 2), { mode: 384 });
    } catch (err) {
      logErr("daemon", "meta per-call write failed", err instanceof Error ? err.message : String(err));
    }
  }
  const callSid = _meta?.session_id;
  if (typeof callSid === "string" && callSid.length > 0) setViewSession(callSid);
  if (!config2.ok) {
    return {
      isError: true,
      content: [{ type: "text", text: config2.error }]
    };
  }
  if (name === "team_ping") {
    view.counter += 1;
    const sid = _meta?.session_id;
    const body = {
      pong: true,
      probe: null,
      identity: {
        session_id: sid ?? null,
        // 预期 sess_ 前缀；与所在会话一致（F03 断言）
        turn_id: _meta?.turn_id ?? null,
        trace_id: _meta?.trace_id ?? null,
        workspace_path: _meta?.workspace_path ?? null,
        client_mode: _meta?.client_mode ?? null,
        delivery_kind: _meta?.delivery_kind ?? null,
        meta_keys: _meta ? Object.keys(_meta) : []
      },
      runtime: { node: process.versions.node, pid: process.pid, nodeWarn },
      config: config2.values,
      echo: args?.echo ?? null
    };
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  }
  if (name === "team_panel_call") {
    const sid = _meta?.session_id;
    if (typeof sid === "string" && sid.length > 0) view.lastSessionId = sid;
    const result = await handlePanelCall(
      {
        view: panelView,
        dataRoot: DATA,
        ...panelCallDeps
      },
      args ?? {},
      _meta
    );
    view.lastFrameTs = ts();
    let body;
    switch (result.kind) {
      case "heartbeat":
        body = { ok: true, counter: result.counter, ts: result.ts, label: result.label };
        break;
      case "view":
        view.lastFrame = result.frame;
        view.lastContentKey = panelView.contentKey(result.frame);
        if (result.frame.team !== null) {
          panelView.writeSnapshot(result.frame.team.teamId, result.frame);
        }
        body = { ok: true, frame: result.frame };
        break;
      case "detail":
        body = { ok: true, detail: result.detail };
        break;
      // 0.4.0 注销 modelOptions / modelSet 两 case（面板模型通道整体下线）。
      case "error":
        body = {
          ok: false,
          error: {
            ...result.code !== "" ? { code: result.code } : {},
            message: result.message,
            ...result.reason !== void 0 ? { reason: result.reason } : {}
          }
        };
        break;
    }
    return {
      // 错误也走正常应答（isError 不置位）：面板经 body.error 呈现可读原因并可重试（F14①）；
      // 通道级失败（daemon 回收）由面板 callServerTool rejection 路径处理。
      content: [{ type: "text", text: JSON.stringify(body) }]
    };
  }
  if (isTeamTool(name)) {
    const meta = _meta;
    return callTeamTool(
      {
        backend,
        dataRoot: DATA,
        bootTimeMs: BOOT_TIME_MS,
        name,
        args: args ?? {},
        meta,
        signal: extra.signal
      },
      // progress 保活：仅 wait_agent + 宿主 progressToken 在场时发（registry 内判定）；
      // 经 extra.sendNotification（SDK 关联 requestId 的标准路径）。
      // F11 实录：每次发射落 logs/progress.jsonl（报文级证据）。
      {
        sendNotification: (notification) => {
          appendJsonl(path20.join(DATA, "logs", "progress.jsonl"), { ts: ts(), notification });
          return extra.sendNotification(
            notification
          );
        }
      }
    );
  }
  throw new Error(`TEAM_UNKNOWN_TOOL: ${name}`);
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));
server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const { uri } = req.params;
  if (uri === PANEL_URI) {
    const html = fs21.readFileSync(path20.join(__dirname, "ui", "team-panel.html"), "utf8");
    return { contents: [{ uri, mimeType: "text/html", text: html }] };
  }
  if (uri === VIEW_URI) {
    let frame = null;
    if (view.lastSessionId !== null) {
      try {
        frame = await panelView.buildFrame({ session_id: view.lastSessionId });
      } catch (err) {
        logErr("panel-view", `view read failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    frame ??= view.lastFrame ?? (view.lastSessionId !== null ? panelView.readSnapshot(view.lastSessionId) ?? null : null);
    frame ??= emptyViewFrame(ts(), view.lastSessionId ?? void 0);
    view.lastFrame = frame;
    return {
      contents: [
        { uri, mimeType: "application/json", text: JSON.stringify(frame) }
      ]
    };
  }
  throw new Error(`TEAM_UNKNOWN_RESOURCE: ${uri}`);
});
function pushFrame(uri) {
  view.lastFrameTs = ts();
  server.notification({ method: "notifications/resources/updated", params: { uri } }).catch((e) => logErr("daemon", "pushFrame failed", String(e)));
}
server.setRequestHandler(SubscribeRequestSchema, async (req) => {
  const { uri } = req.params;
  appendJsonl(path20.join(DATA, "logs", "requests.jsonl"), { ts: ts(), method: "resources/subscribe", uri });
  if (uri === VIEW_URI) {
    view.subscribed = true;
    if (!frameTimer) {
      frameTimer = setInterval(() => void pollView(), 500);
      frameTimer.unref?.();
    }
    await pollView();
  }
  return {};
});
server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
  const { uri } = req.params;
  appendJsonl(path20.join(DATA, "logs", "requests.jsonl"), { ts: ts(), method: "resources/unsubscribe", uri });
  if (uri === VIEW_URI) {
    view.subscribed = false;
    if (frameTimer) {
      clearInterval(frameTimer);
      frameTimer = null;
    }
  }
  return {};
});
var transport = new StdioServerTransport();
transport.onclose = () => {
  view.subscribed = false;
  if (frameTimer) {
    clearInterval(frameTimer);
    frameTimer = null;
  }
};
await server.connect(transport);
logErr("daemon", `agent-team daemon ready (pid=${process.pid}, node=${process.versions.node}, data=${DATA}, config=${config2.ok ? "ok" : "INVALID"})`);
